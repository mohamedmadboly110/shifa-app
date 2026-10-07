'use strict';

const {
  api,
  authHeader,
  login,
  createClinic,
  createDoctor,
  createStaff,
  createPatient,
  createAppointmentFixture,
  todayKey,
  Appointment,
} = require('./helpers');

describe('Clinic queue management', () => {
  let clinic;
  let doctor;
  let doctorUser;
  let staff;
  let doctorToken;
  let staffToken;

  beforeEach(async () => {
    clinic = await createClinic({ name: 'Queue Clinic' });
    ({ doctor, user: doctorUser } = await createDoctor(clinic, { name: 'Dr. Queue' }));
    staff = await createStaff(clinic, { name: 'Queue Desk' });
    ({ token: doctorToken } = await login(doctorUser.email));
    ({ token: staffToken } = await login(staff.email));
  });

  const waitingPatient = async (slotIndex, checkedInAt) => {
    const patient = await createPatient();
    const { appointment } = await createAppointmentFixture({
      patient,
      doctor,
      date: todayKey(),
      startTime: `${String(8 + slotIndex).padStart(2, '0')}:00`,
      status: 'WAITING',
      checkInStatus: 'CHECKED_IN',
      checkedInAt: checkedInAt || new Date(Date.now() + slotIndex * 60_000),
    });
    return { patient, appointment };
  };

  describe('queue membership', () => {
    it('only contains checked-in patients', async () => {
      const confirmed = await createPatient();
      await createAppointmentFixture({ patient: confirmed, doctor, date: todayKey(), startTime: '12:00', status: 'CONFIRMED' });
      await waitingPatient(1);

      const response = await api().get('/api/v1/queue').set(authHeader(staffToken));

      expect(response.status).toBe(200);
      expect(response.body.data.waiting).toHaveLength(1);
      expect(response.body.data.current).toBeNull();
      expect(response.body.data.stats.waiting).toBe(1);
    });

    it('a patient cannot enter the queue without checking in', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);
      const { appointment } = await createAppointmentFixture({
        patient,
        doctor,
        date: todayKey(),
        status: 'CONFIRMED',
        checkInStatus: 'NOT_CHECKED_IN',
      });

      const queue = await api().get('/api/v1/queue').set(authHeader(staffToken));
      expect(queue.body.data.waiting).toHaveLength(0);

      // Trying to start a consultation for a patient who never checked in fails.
      const start = await api().post(`/api/v1/queue/${appointment._id}/start`).set(authHeader(doctorToken)).send({});
      expect(start.status).toBe(409);
      expect(start.body.error.code).toBe('CHECK_IN_REQUIRED');
    });

    it('orders the waiting list by check-in time', async () => {
      const first = await waitingPatient(1, new Date('2030-01-01T08:00:00Z'));
      const second = await waitingPatient(2, new Date('2030-01-01T08:05:00Z'));

      const response = await api().get('/api/v1/queue').set(authHeader(staffToken));

      expect(response.body.data.waiting.map((entry) => entry._id)).toEqual([
        first.appointment._id.toString(),
        second.appointment._id.toString(),
      ]);
      expect(response.body.data.waiting[0].queuePosition).toBe(1);
      expect(response.body.data.waiting[1].queuePosition).toBe(2);
    });
  });

  describe('POST /api/v1/queue/:appointmentId/start', () => {
    it('lets the doctor start the next consultation', async () => {
      const { appointment } = await waitingPatient(1);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('IN_CONSULTATION');
      expect(response.body.data.startedAt).toEqual(expect.any(String));
    });

    it('lets clinic staff start a consultation', async () => {
      const { appointment } = await waitingPatient(1);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(staffToken))
        .send({});

      expect(response.status).toBe(200);
    });

    it('allows only one consultation at a time', async () => {
      const first = await waitingPatient(1);
      const second = await waitingPatient(2);

      const started = await api()
        .post(`/api/v1/queue/${first.appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});
      expect(started.status).toBe(200);

      const blocked = await api()
        .post(`/api/v1/queue/${second.appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});

      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('QUEUE_BUSY');
    });

    it('refuses to start a confirmed but not checked-in appointment', async () => {
      const patient = await createPatient();
      const { appointment } = await createAppointmentFixture({
        patient,
        doctor,
        date: todayKey(),
        status: 'CONFIRMED',
        checkInStatus: 'NOT_CHECKED_IN',
      });

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHECK_IN_REQUIRED');
    });

    it('refuses an invalid transition', async () => {
      const patient = await createPatient();
      const { appointment } = await createAppointmentFixture({
        patient,
        doctor,
        date: todayKey(),
        status: 'COMPLETED',
        checkInStatus: 'CHECKED_IN',
      });

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('blocks a doctor from another clinic', async () => {
      const { appointment } = await waitingPatient(1);

      const otherClinic = await createClinic({ name: 'Other Clinic' });
      const { user: otherDoctor } = await createDoctor(otherClinic, { name: 'Dr. Outsider' });
      const { token: otherToken } = await login(otherDoctor.email);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(otherToken))
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CLINIC_ACCESS_DENIED');
    });

    it('blocks a doctor from managing a colleague appointment in the same clinic', async () => {
      const { appointment } = await waitingPatient(1);

      const { user: colleague } = await createDoctor(clinic, { name: 'Dr. Colleague', specialty: 'Neurology' });
      const { token: colleagueToken } = await login(colleague.email);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(colleagueToken))
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('NOT_APPOINTMENT_DOCTOR');
    });

    it('blocks a patient', async () => {
      const { appointment } = await waitingPatient(1);
      const patient = await createPatient();
      const { token: patientToken } = await login(patient.email);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/start`)
        .set(authHeader(patientToken))
        .send({});

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/v1/queue/:appointmentId/complete', () => {
    it('completes a running consultation', async () => {
      const { appointment } = await waitingPatient(1);
      await api().post(`/api/v1/queue/${appointment._id}/start`).set(authHeader(doctorToken)).send({});

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/complete`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(response.body.data.completedAt).toEqual(expect.any(String));
    });

    it('frees the doctor for the next patient', async () => {
      const first = await waitingPatient(1);
      const second = await waitingPatient(2);

      await api().post(`/api/v1/queue/${first.appointment._id}/start`).set(authHeader(doctorToken)).send({});
      await api().post(`/api/v1/queue/${first.appointment._id}/complete`).set(authHeader(doctorToken)).send({});

      const next = await api()
        .post(`/api/v1/queue/${second.appointment._id}/start`)
        .set(authHeader(doctorToken))
        .send({});

      expect(next.status).toBe(200);
    });

    it('refuses to complete an appointment that never started', async () => {
      const { appointment } = await waitingPatient(1);

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/complete`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('refuses a second completion', async () => {
      const { appointment } = await waitingPatient(1);
      await api().post(`/api/v1/queue/${appointment._id}/start`).set(authHeader(doctorToken)).send({});
      await api().post(`/api/v1/queue/${appointment._id}/complete`).set(authHeader(doctorToken)).send({});

      const response = await api()
        .post(`/api/v1/queue/${appointment._id}/complete`)
        .set(authHeader(doctorToken))
        .send({});

      expect(response.status).toBe(409);
    });
  });

  describe('GET /api/v1/queue/today', () => {
    it('returns the day view with a summary for the doctor', async () => {
      await createAppointmentFixture({
        patient: await createPatient(),
        doctor,
        date: todayKey(),
        startTime: '12:00',
        status: 'CONFIRMED',
      });
      await waitingPatient(1);

      const response = await api().get('/api/v1/queue/today').set(authHeader(doctorToken));

      expect(response.status).toBe(200);
      expect(response.body.data.date).toBe(todayKey());
      expect(response.body.data.appointments.length).toBeGreaterThanOrEqual(2);
      expect(response.body.data.summary.total).toBeGreaterThanOrEqual(2);
      expect(response.body.data.summary.waiting).toBe(1);
      expect(response.body.data.doctors[0].name).toBe('Dr. Queue');
    });

    it('blocks a patient', async () => {
      const patient = await createPatient();
      const { token } = await login(patient.email);

      const response = await api().get('/api/v1/queue/today').set(authHeader(token));

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/queue/my-schedule', () => {
    it('returns the doctor working schedule and generated slots', async () => {
      const response = await api().get('/api/v1/queue/my-schedule').query({ days: 5 }).set(authHeader(doctorToken));

      expect(response.status).toBe(200);
      expect(response.body.data.workingSchedule.monday).toEqual([{ start: '08:00', end: '18:00' }]);
      expect(response.body.data.days.length).toBeGreaterThan(0);
      expect(response.body.data.days[0].availableSlots.length).toBeGreaterThan(0);
    });

    it('rejects staff', async () => {
      const response = await api().get('/api/v1/queue/my-schedule').set(authHeader(staffToken));
      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/queue/:appointmentId/no-show', () => {
    it('marks a waiting patient as a no show', async () => {
      const { appointment } = await waitingPatient(1);

      const response = await api()
        .patch(`/api/v1/queue/${appointment._id}/no-show`)
        .set(authHeader(staffToken))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('NO_SHOW');
    });
  });

  describe('state machine integrity', () => {
    it('keeps the appointment document as the single source of truth', async () => {
      const { appointment } = await waitingPatient(1);
      await api().post(`/api/v1/queue/${appointment._id}/start`).set(authHeader(doctorToken)).send({});
      await api().post(`/api/v1/queue/${appointment._id}/complete`).set(authHeader(doctorToken)).send({});

      const stored = await Appointment.findById(appointment._id);
      expect(stored.status).toBe('COMPLETED');
      expect(stored.checkInStatus).toBe('CHECKED_IN');
      expect(stored.checkedInAt).toBeTruthy();
      expect(stored.startedAt).toBeTruthy();
      expect(stored.completedAt).toBeTruthy();
    });
  });
});
