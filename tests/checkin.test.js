'use strict';

const {
  api,
  authHeader,
  login,
  createClinic,
  createDoctor,
  createStaff,
  createPatient,
  bookAppointment,
  bookAndPay,
  createAppointmentFixture,
  futureDate,
  futureSlotOn,
  todayKey,
  Appointment,
} = require('./helpers');

/**
 * Check-in is only valid on the appointment day, so these fixtures are written
 * straight to MongoDB with today's date. That keeps the suite independent of the
 * time of day it happens to run.
 */
describe('QR check-in', () => {
  let clinic;
  let doctor;
  let staff;
  let patient;
  let patientToken;
  let staffToken;

  beforeEach(async () => {
    clinic = await createClinic({ name: 'Check-in Clinic' });
    ({ doctor } = await createDoctor(clinic, { name: 'Dr. Checkin', consultationFee: 300 }));
    staff = await createStaff(clinic, { name: 'Front Desk' });
    patient = await createPatient();
    ({ token: patientToken } = await login(patient.email));
    ({ token: staffToken } = await login(staff.email));
  });

  /** A paid, confirmed appointment for today, with a valid QR ticket. */
  const paidToday = (overrides = {}) =>
    createAppointmentFixture({ patient, doctor, date: todayKey(), ...overrides });

  it('checks a patient in with a valid ticket and puts them in the queue', async () => {
    const { ticket } = await paidToday();

    const response = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('WAITING');
    expect(response.body.data.checkInStatus).toBe('CHECKED_IN');
    expect(response.body.data.checkInMethod).toBe('staff');
    expect(response.body.data.checkedInAt).toEqual(expect.any(String));
  });

  it('supports patient self check-in', async () => {
    const { ticket } = await paidToday();

    const response = await api().post('/api/v1/check-ins/self').set(authHeader(patientToken)).send({ token: ticket });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('WAITING');
    expect(response.body.data.checkInMethod).toBe('self');
  });

  it('rejects a forged token', async () => {
    const response = await api()
      .post('/api/v1/check-ins')
      .set(authHeader(staffToken))
      .send({ token: `${'a'.repeat(40)}.${'b'.repeat(43)}` });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CHECK_IN_TOKEN');
  });

  it('rejects a tampered signature', async () => {
    const { ticket } = await paidToday();
    const [payload, signature] = ticket.split('.');
    const tampered = `${payload}.${signature.slice(0, -2)}xy`;

    const response = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: tampered });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CHECK_IN_TOKEN');
  });

  it('rejects a missing or malformed token', async () => {
    const missing = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({});
    expect(missing.status).toBe(422);

    const garbage = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: 'short' });
    expect(garbage.status).toBe(422);
  });

  it('rejects a duplicate check-in', async () => {
    const { ticket } = await paidToday();

    const first = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });
    expect(first.status).toBe(200);

    const second = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('rejects concurrent check-ins and admits exactly one', async () => {
    const { ticket } = await paidToday();

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket })),
    );

    expect(attempts.filter((response) => response.status === 200)).toHaveLength(1);
    attempts
      .filter((response) => response.status !== 200)
      .forEach((response) => expect(response.body.error.code).toBe('ALREADY_CHECKED_IN'));
  });

  it('rejects a valid ticket when the payment is not settled', async () => {
    const { appointment } = await paidToday({
      paymentStatus: 'PENDING',
      status: 'PENDING_PAYMENT',
    });

    const { issueCheckInTicket } = require('../src/services/checkInTicket.service');
    const { token: ticket } = await issueCheckInTicket(appointment);

    const response = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('rejects check-in for a cancelled appointment', async () => {
    const { appointment, ticket } = await paidToday();
    await Appointment.findByIdAndUpdate(appointment._id, { $set: { status: 'CANCELLED', slotHeld: false } });

    const response = await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_ELIGIBLE_FOR_CHECK_IN');
  });

  it('rejects check-in on the wrong day', async () => {
    const date = futureDate(3);
    const { ticket } = await bookAndPay({
      token: patientToken,
      doctorId: doctor._id.toString(),
      date,
      startTime: futureSlotOn(date, 2),
    });

    const response = await api()
      .post('/api/v1/check-ins')
      .set(authHeader(staffToken))
      .send({ token: ticket.token });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_APPOINTMENT_DAY');
  });

  it('rejects a superseded ticket', async () => {
    const { appointment } = await paidToday();

    const first = await api()
      .get(`/api/v1/appointments/mine/${appointment._id}/ticket`)
      .set(authHeader(patientToken));
    const second = await api()
      .get(`/api/v1/appointments/mine/${appointment._id}/ticket`)
      .set(authHeader(patientToken));

    expect(first.body.data.token).not.toBe(second.body.data.token);

    const response = await api()
      .post('/api/v1/check-ins')
      .set(authHeader(staffToken))
      .send({ token: first.body.data.token });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CHECK_IN_TOKEN');
  });

  it('blocks a patient from checking in with someone else ticket', async () => {
    const { ticket } = await paidToday();

    const intruder = await createPatient();
    const { token: intruderToken } = await login(intruder.email);

    const response = await api().post('/api/v1/check-ins/self').set(authHeader(intruderToken)).send({ token: ticket });

    expect(response.body.success).toBe(false);
    expect([400, 401, 409]).toContain(response.status);
  });

  it('blocks staff from another clinic', async () => {
    const { ticket } = await paidToday();

    const otherClinic = await createClinic({ name: 'Rival Clinic' });
    const rivalStaff = await createStaff(otherClinic, { name: 'Rival Desk' });
    const { token: rivalToken } = await login(rivalStaff.email);

    const response = await api().post('/api/v1/check-ins').set(authHeader(rivalToken)).send({ token: ticket });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CLINIC_ACCESS_DENIED');
  });

  it('requires authentication', async () => {
    const response = await api().post('/api/v1/check-ins').send({ token: 'x'.repeat(40) });
    expect(response.status).toBe(401);
  });

  it('lets the patient fetch their own ticket but not staff', async () => {
    const { appointment } = await paidToday();

    const own = await api()
      .get(`/api/v1/appointments/mine/${appointment._id}/ticket`)
      .set(authHeader(patientToken));
    expect(own.status).toBe(200);
    expect(own.body.data.token).toEqual(expect.any(String));
    expect(own.body.data.bookingReference).toBe(appointment.bookingReference);

    const asStaff = await api()
      .get(`/api/v1/appointments/mine/${appointment._id}/ticket`)
      .set(authHeader(staffToken));
    expect(asStaff.status).toBe(403);
  });

  it('reports the queue position to the patient', async () => {
    const { appointment, ticket } = await paidToday();
    await api().post('/api/v1/check-ins').set(authHeader(staffToken)).send({ token: ticket });

    const response = await api()
      .get(`/api/v1/appointments/mine/${appointment._id}/status`)
      .set(authHeader(patientToken));

    expect(response.status).toBe(200);
    expect(response.body.data.queue.status).toBe('WAITING');
    expect(response.body.data.queue.yourPosition).toBe(1);
  });

  it('does not hand out a ticket for an unpaid appointment', async () => {
    const booking = await bookAppointment({
      token: patientToken,
      doctorId: doctor._id.toString(),
      date: futureDate(1),
      startTime: futureSlotOn(futureDate(1), 2),
    });

    const response = await api()
      .get(`/api/v1/appointments/mine/${booking.body.data.id}/ticket`)
      .set(authHeader(patientToken));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_REQUIRED');
  });
});
