'use strict';

const {
  api,
  authHeader,
  registerPatient,
  login,
  createPatient,
  createAdmin,
  PASSWORD,
} = require('./helpers');

describe('Authentication', () => {
  describe('POST /api/v1/auth/register', () => {
    it('registers a patient and returns a JWT', async () => {
      const { response } = await registerPatient();

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toEqual(expect.any(String));
      expect(response.body.data.user.role).toBe('patient');
      expect(response.body.data.user.email).toContain('@shifa.test');
    });

    it('never returns the password', async () => {
      const { response } = await registerPatient();
      expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
      expect(response.body.data.user.password).toBeUndefined();
    });

    it('rejects a duplicate email with 409', async () => {
      const { payload } = await registerPatient();
      const second = await registerPatient({ email: payload.email });

      expect(second.response.status).toBe(409);
      expect(second.response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('rejects a weak password with 422', async () => {
      const { response } = await registerPatient({ password: 'short' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details[0].field).toBe('password');
    });

    it('rejects invalid and missing fields', async () => {
      const response = await api().post('/api/v1/auth/register').send({ email: 'not-an-email' });

      expect(response.status).toBe(422);
      const fields = response.body.error.details.map((detail) => detail.field);
      expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });

    it('never lets a client self-assign a privileged role', async () => {
      const { response } = await registerPatient({ role: 'admin' });
      expect(response.body.data.user.role).toBe('patient');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in a valid patient and embeds role in the token', async () => {
      const patient = await createPatient();
      const { response, token } = await login(patient.email);

      expect(response.status).toBe(200);
      expect(token.split('.')).toHaveLength(3);

      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.role).toBe('patient');
      expect(payload.sub).toBe(patient._id.toString());
    });

    it('rejects a wrong password with the same message as an unknown user', async () => {
      const patient = await createPatient();
      const wrongPassword = await api()
        .post('/api/v1/auth/login')
        .send({ email: patient.email, password: 'Wr0ng!pass' });
      const unknownUser = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@shifa.test', password: 'Wr0ng!pass' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownUser.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('blocks a deactivated account', async () => {
      const admin = await createAdmin();
      const { token } = await login(admin.email);
      const patient = await createPatient();

      await api()
        .patch(`/api/v1/admin/users/${patient._id}/status`)
        .set(authHeader(token))
        .send({ isActive: false });

      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: patient.email, password: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('stops an admin from deactivating their own account', async () => {
      const admin = await createAdmin();
      const { token } = await login(admin.email);

      const response = await api()
        .patch(`/api/v1/admin/users/${admin._id}/status`)
        .set(authHeader(token))
        .send({ isActive: false });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('SELF_DEACTIVATION');
    });
  });

  describe('protected routes', () => {
    it('rejects a request with no Authorization header', async () => {
      const response = await api().get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('rejects a malformed header', async () => {
      const response = await api().get('/api/v1/auth/me').set({ Authorization: 'Basic abc123' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('rejects a tampered token', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);
      const tampered = `${token.slice(0, -4)}aaaa`;

      const response = await api().get('/api/v1/auth/me').set(authHeader(tampered));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns the profile for a valid token', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);

      const response = await api().get('/api/v1/auth/me').set(authHeader(token));

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe(patient.email);
    });

    it('enforces role based access', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);

      const response = await api().get('/api/v1/admin/users').set(authHeader(token));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_ROLE');
    });
  });

  describe('PATCH /api/v1/auth/me', () => {
    it('lets a patient update their own contact details', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);

      const response = await api()
        .patch('/api/v1/auth/me')
        .set(authHeader(token))
        .send({ name: 'Updated Name', phone: '+20 199 999 9999' });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Name');
    });

    it('requires the current password to set a new one', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);

      const withoutCurrent = await api()
        .patch('/api/v1/auth/me')
        .set(authHeader(token))
        .send({ newPassword: 'N3wPassword!' });
      expect(withoutCurrent.status).toBe(422);

      const wrongCurrent = await api()
        .patch('/api/v1/auth/me')
        .set(authHeader(token))
        .send({ currentPassword: 'Wr0ng!pass', newPassword: 'N3wPassword!' });
      expect(wrongCurrent.status).toBe(401);

      const response = await api()
        .patch('/api/v1/auth/me')
        .set(authHeader(token))
        .send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!' });
      expect(response.status).toBe(200);

      const relogin = await api().post('/api/v1/auth/login').send({ email: patient.email, password: 'N3wPassword!' });
      expect(relogin.status).toBe(200);
    });
  });

  describe('unknown routes', () => {
    it('returns a structured 404', async () => {
      const response = await api().get('/api/v1/does-not-exist');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });
  });
});
