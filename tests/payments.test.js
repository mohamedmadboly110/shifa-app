'use strict';

const {
  api,
  authHeader,
  login,
  createClinic,
  createDoctor,
  createPatient,
  bookAppointment,
  payAppointment,
  bookAndPay,
  futureDate,
  futureSlotOn,
  Payment,
  Appointment,
} = require('./helpers');

describe('Payments (simulated gateway)', () => {
  let clinic;
  let doctor;
  let patient;
  let token;
  let date;

  beforeEach(async () => {
    clinic = await createClinic({ name: 'Payment Clinic' });
    ({ doctor } = await createDoctor(clinic, { name: 'Dr. Fee', consultationFee: 750, currency: 'EGP' }));
    patient = await createPatient();
    ({ token } = await login(patient.email));
    date = futureDate(1);
  });

  const newBooking = async (slotIndex = 2) => {
    const response = await bookAppointment({
      token,
      doctorId: doctor._id.toString(),
      date,
      startTime: futureSlotOn(date, slotIndex),
    });
    return response.body.data;
  };

  it('confirms the appointment and issues a QR ticket', async () => {
    const appointment = await newBooking();

    const response = await payAppointment({ token, appointmentId: appointment.id });

    expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('PAID');
    expect(response.body.data.payment.amount).toBe(750);
    expect(response.body.data.payment.currency).toBe('EGP');
    expect(response.body.data.payment.transactionReference).toMatch(/^SIMPAY_/);
    expect(response.body.data.payment.provider).toBe('simulated');

    expect(response.body.data.appointment.status).toBe('CONFIRMED');
    expect(response.body.data.appointment.paymentStatus).toBe('PAID');
  });

  it('returns a ticket that leaks no patient data', async () => {
    const appointment = await newBooking();
    const response = await payAppointment({ token, appointmentId: appointment.id });
    const { ticket } = response.body.data;

    expect(ticket.token).toEqual(expect.any(String));
    expect(ticket.bookingReference).toBe(appointment.bookingReference);

    const encodedPayload = ticket.token.split('.')[0];
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');

    expect(decoded).not.toContain(patient.email);
    expect(decoded).not.toContain(patient.name);
    expect(JSON.parse(decoded)).toMatchObject({
      aid: appointment.id,
      pid: patient._id.toString(),
      cid: clinic._id.toString(),
    });
    // No contact details (phone) or payment data may ride along in the ticket.
    expect(decoded).not.toContain('phone');
  });

  it('never stores the raw ticket on the appointment', async () => {
    const { appointmentId, token: ticketToken } = await bookAndPay({
      token,
      doctorId: doctor._id.toString(),
      date,
      startTime: futureSlotOn(date, 2),
    });

    const stored = await Appointment.findById(appointmentId);
    expect(stored.checkInTokenId).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toContain(ticketToken);
  });

  it('uses the fee snapshot, not the current doctor price', async () => {
    const appointment = await newBooking(3);

    doctor.consultationFee = 5000;
    await doctor.save();

    const response = await payAppointment({ token, appointmentId: appointment.id });

    expect(response.body.data.payment.amount).toBe(750);
    const storedPayment = await Payment.findOne({ appointment: appointment.id });
    expect(storedPayment.amount).toBe(750);
  });

  it('rejects payment from a different patient', async () => {
    const appointment = await newBooking(4);

    const intruder = await createPatient();
    const { token: intruderToken } = await login(intruder.email);

    const response = await payAppointment({ token: intruderToken, appointmentId: appointment.id });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_APPOINTMENT_OWNER');
  });

  it('rejects payment from a doctor or staff account', async () => {
    const appointment = await newBooking(5);
    const { user: doctorUser } = await createDoctor(clinic, { name: 'Dr. Other' });
    const { token: doctorToken } = await login(doctorUser.email);

    const response = await api()
      .post(`/api/v1/payments/${appointment.id}/pay`)
      .set(authHeader(doctorToken))
      .send({});

    expect(response.status).toBe(403);
  });

  it('records a failed payment and keeps the appointment payable', async () => {
    const appointment = await newBooking(6);

    const declined = await payAppointment({ token, appointmentId: appointment.id, simulate: 'failure' });

    expect(declined.status).toBe(409);
    expect(declined.body.error.code).toBe('PAYMENT_FAILED');

    const failed = await Payment.findOne({ appointment: appointment.id });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toEqual(expect.any(String));

    const storedAppointment = await Appointment.findById(appointment.id);
    expect(storedAppointment.status).toBe('PENDING_PAYMENT');

    // A retry succeeds and reuses the same payment record.
    const retried = await payAppointment({ token, appointmentId: appointment.id });
    expect(retried.status).toBe(200);

    const payments = await Payment.find({ appointment: appointment.id });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('PAID');
  });

  it('refuses a second successful payment', async () => {
    const appointment = await newBooking(7);
    await payAppointment({ token, appointmentId: appointment.id });

    const second = await payAppointment({ token, appointmentId: appointment.id });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_PAID');
  });

  it('refuses payment for a cancelled appointment', async () => {
    const appointment = await newBooking(8);
    await api().patch(`/api/v1/appointments/${appointment.id}/cancel`).set(authHeader(token)).send({});

    const response = await payAppointment({ token, appointmentId: appointment.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('APPOINTMENT_CANCELLED');
  });

  it('lets the patient list their payment history', async () => {
    await bookAndPay({ token, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 9) });

    const response = await api().get('/api/v1/payments/mine').set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].amount).toBe(750);
    expect(response.body.data[0].appointment.bookingReference).toEqual(expect.any(String));
  });

  it('requires authentication', async () => {
    const appointment = await newBooking(10);
    const response = await api().post(`/api/v1/payments/${appointment.id}/pay`).send({});

    expect(response.status).toBe(401);
  });
});
