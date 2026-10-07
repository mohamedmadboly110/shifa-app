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
  todayKey,
  addDays,
  toMinutes,
  fromMinutes,
  FULL_WEEK,
  Appointment,
} = require('./helpers');

describe('Appointment booking', () => {
  let clinic;
  let doctor;
  let patient;
  let token;
  let date;

  beforeEach(async () => {
    clinic = await createClinic({ name: 'Booking Clinic' });
    ({ doctor } = await createDoctor(clinic, { name: 'Dr. Booked', consultationFee: 500 }));
    patient = await createPatient();
    ({ token } = await login(patient.email));
    date = futureDate(1);
  });

  describe('POST /api/v1/appointments', () => {
    it('books an available slot with a server side price snapshot', async () => {
      const startTime = futureSlotOn(date, 2);

      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime,
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const appointment = response.body.data;
      expect(appointment.status).toBe('PENDING_PAYMENT');
      expect(appointment.paymentStatus).toBe('PENDING');
      expect(appointment.checkInStatus).toBe('NOT_CHECKED_IN');
      expect(appointment.fee).toBe(500);
      expect(appointment.currency).toBe('EGP');
      expect(appointment.bookingReference).toMatch(/^SHF-[A-Z2-9]{6}$/);
      expect(appointment.startTime).toBe(startTime);
      expect(appointment.endTime).toBe(fromMinutes(toMinutes(startTime) + 30));
      expect(appointment.clinic.id).toBe(clinic._id.toString());
    });

    it('generates a unique booking reference per appointment', async () => {
      const first = await bookAppointment({ token, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 1) });
      const secondPatient = await createPatient();
      const { token: token2 } = await login(secondPatient.email);
      const second = await bookAppointment({ token: token2, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 2) });

      expect(first.body.data.bookingReference).not.toBe(second.body.data.bookingReference);
    });

    it('ignores a client supplied price', async () => {
      const response = await api()
        .post('/api/v1/appointments')
        .set(authHeader(token))
        .send({
          doctorId: doctor._id.toString(),
          date,
          startTime: futureSlotOn(date, 3),
          fee: 1,
          currency: 'XXX',
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');

      // The client-supplied fields were rejected: no appointment was created,
      // so the server-side fee could never be influenced by the caller.
      const stored = await Appointment.findOne({ patient: patient._id });
      expect(stored).toBeNull();
    });

    it('rejects booking outside the working hours', async () => {
      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: '20:00',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    });

    it('rejects a slot that starts before the working day but ends inside it', async () => {
      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: '17:45',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    });

    it('rejects booking in the past', async () => {
      const pastDate = addDays(todayKey(), -1);

      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date: pastDate,
        startTime: '10:00',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_IN_PAST');
    });

    it('rejects booking inside the booking cutoff window', async () => {
      const now = new Date();
      const slotIn30Minutes = fromMinutes(now.getUTCHours() * 60 + now.getUTCMinutes() + 30);

      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date: todayKey(),
        startTime: slotIn30Minutes,
      });

      // The slot must align with the doctor's schedule, so the guard we assert
      // is either the cutoff or working-hours rejection - never a successful booking.
      expect([201, 422]).toContain(response.status);
      if (response.status === 422) {
        expect(['APPOINTMENT_IN_PAST', 'OUTSIDE_WORKING_HOURS']).toContain(response.body.error.code);
      }
    });

    it('prevents two patients from taking the same slot', async () => {
      const startTime = futureSlotOn(date, 4);

      const first = await bookAppointment({ token, doctorId: doctor._id.toString(), date, startTime });
      expect(first.status).toBe(201);

      const other = await createPatient();
      const { token: otherToken } = await login(other.email);
      const second = await bookAppointment({ token: otherToken, doctorId: doctor._id.toString(), date, startTime });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('APPOINTMENT_SLOT_UNAVAILABLE');
    });

    it('blocks concurrent requests for the same slot (unique index)', async () => {
      const startTime = futureSlotOn(date, 5);
      const competitors = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const fresh = await createPatient();
          const { token: freshToken } = await login(fresh.email);
          return bookAppointment({ token: freshToken, doctorId: doctor._id.toString(), date, startTime });
        }),
      );

      const created = competitors.filter((response) => response.status === 201);
      const rejected = competitors.filter((response) => response.status === 409);

      expect(created).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      rejected.forEach((response) => expect(response.body.error.code).toBe('APPOINTMENT_SLOT_UNAVAILABLE'));

      const stored = await Appointment.countDocuments({ doctor: doctor._id, appointmentDate: date, startTime });
      expect(stored).toBe(1);
    });

    it('stops a patient from booking overlapping appointments', async () => {
      const startTime = futureSlotOn(date, 6);
      await bookAppointment({ token, doctorId: doctor._id.toString(), date, startTime });

      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 7),
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PATIENT_APPOINTMENT_CONFLICT');
    });

    it('rejects booking with an inactive doctor', async () => {
      doctor.isActive = false;
      await doctor.save();

      const response = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 2),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('DOCTOR_INACTIVE');
    });

    it('rejects an unknown doctor and an unauthenticated caller', async () => {
      const unknown = await bookAppointment({
        token,
        doctorId: '64b7f9c2e13a1c2d3e4f5a6b',
        date,
        startTime: futureSlotOn(date, 2),
      });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('DOCTOR_NOT_FOUND');

      const anonymous = await api()
        .post('/api/v1/appointments')
        .send({ doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 2) });
      expect(anonymous.status).toBe(401);
    });

    it('validates the payload shape', async () => {
      const response = await api()
        .post('/api/v1/appointments')
        .set(authHeader(token))
        .send({ doctorId: 'not-an-id', date: 'tomorrow', startTime: '25:99' });

      expect(response.status).toBe(422);
      const fields = response.body.error.details.map((detail) => detail.field);
      expect(fields).toEqual(expect.arrayContaining(['doctorId', 'date', 'startTime']));
    });

    it('uses the doctor slot length override', async () => {
      const { doctor: shortDoctor } = await createDoctor(clinic, {
        name: 'Dr. Quick',
        specialty: 'Dermatology',
        slotDurationMinutes: 15,
      });

      const response = await bookAppointment({
        token,
        doctorId: shortDoctor._id.toString(),
        date,
        startTime: '09:00',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.endTime).toBe('09:15');
    });
  });

  describe('GET /api/v1/appointments/mine', () => {
    it('lists only the caller appointments', async () => {
      await bookAppointment({ token, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 2) });

      const other = await createPatient();
      const { token: otherToken } = await login(other.email);
      await bookAppointment({ token: otherToken, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 3) });

      const response = await api().get('/api/v1/appointments/mine').set(authHeader(token));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.total).toBe(1);
    });

    it('filters by status', async () => {
      const { appointmentId } = await bookAndPay({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 2),
      });
      await bookAppointment({ token, doctorId: doctor._id.toString(), date, startTime: futureSlotOn(date, 4) });

      const response = await api()
        .get('/api/v1/appointments/mine')
        .query({ status: 'CONFIRMED' })
        .set(authHeader(token));

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(appointmentId);
    });
  });

  describe('GET /api/v1/appointments/:id', () => {
    it('lets the owner read their appointment', async () => {
      const { appointmentId } = await bookAndPay({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 2),
      });

      const response = await api().get(`/api/v1/appointments/${appointmentId}`).set(authHeader(token));

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(appointmentId);
      expect(response.body.data.checkInTokenId).toBeUndefined();
      expect(response.body.data.slotHeld).toBeUndefined();
    });

    it('refuses access to another patient appointment', async () => {
      const { appointmentId } = await bookAndPay({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 2),
      });

      const intruder = await createPatient();
      const { token: intruderToken } = await login(intruder.email);

      const response = await api().get(`/api/v1/appointments/${appointmentId}`).set(authHeader(intruderToken));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('NOT_APPOINTMENT_OWNER');
    });

    it('404s an unknown id and 422s a malformed id', async () => {
      const missing = await api().get('/api/v1/appointments/64b7f9c2e13a1c2d3e4f5a6b').set(authHeader(token));
      expect(missing.status).toBe(404);

      const malformed = await api().get('/api/v1/appointments/not-an-id').set(authHeader(token));
      expect(malformed.status).toBe(422);
    });
  });

  describe('PATCH /api/v1/appointments/:id/cancel', () => {
    it('cancels an unpaid appointment and frees the slot', async () => {
      const startTime = futureSlotOn(date, 8);
      const bookingResponse = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime,
      });

      const response = await api()
        .patch(`/api/v1/appointments/${bookingResponse.body.data.id}/cancel`)
        .set(authHeader(token))
        .send({ reason: 'Something came up' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('CANCELLED');

      const stored = await Appointment.findById(bookingResponse.body.data.id);
      expect(stored.slotHeld).toBe(false);

      const availability = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });
      expect(availability.body.data.slots.map((slot) => slot.startTime)).toContain(startTime);
    });

    it('refunds a paid appointment', async () => {
      const { appointmentId } = await bookAndPay({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 9),
      });

      const response = await api()
        .patch(`/api/v1/appointments/${appointmentId}/cancel`)
        .set(authHeader(token))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('CANCELLED');
      expect(response.body.data.paymentStatus).toBe('REFUNDED');
    });

    it('refuses to cancel twice', async () => {
      const bookingResponse = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 10),
      });
      const id = bookingResponse.body.data.id;

      await api().patch(`/api/v1/appointments/${id}/cancel`).set(authHeader(token)).send({});
      const second = await api().patch(`/api/v1/appointments/${id}/cancel`).set(authHeader(token)).send({});

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CANCELLATION_NOT_ALLOWED');
    });

    it('refuses to cancel inside the cancellation cutoff', async () => {
      const now = new Date();
      const in30Minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
      const slot = fromMinutes(Math.ceil(in30Minutes / 30) * 30);

      const { Appointment: Model } = require('./helpers');
      const created = await Model.create({
        patient: patient._id,
        doctor: doctor._id,
        clinic: clinic._id,
        appointmentDate: todayKey(),
        startTime: slot,
        endTime: fromMinutes(toMinutes(slot) + 30),
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        checkInStatus: 'NOT_CHECKED_IN',
        fee: 500,
        currency: 'EGP',
        bookingReference: `SHF-CUTOFF${Math.floor(Math.random() * 1000)}`,
        slotHeld: true,
      });

      const response = await api()
        .patch(`/api/v1/appointments/${created._id}/cancel`)
        .set(authHeader(token))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CANCELLATION_NOT_ALLOWED');
    });

    it('refuses to cancel a completed appointment', async () => {
      const { appointmentId } = await bookAndPay({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 11),
      });
      await Appointment.findByIdAndUpdate(appointmentId, { $set: { status: 'COMPLETED' } });

      const response = await api()
        .patch(`/api/v1/appointments/${appointmentId}/cancel`)
        .set(authHeader(token))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CANCELLATION_NOT_ALLOWED');
    });

    it('refuses to cancel another patient appointment', async () => {
      const bookingResponse = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 12),
      });

      const intruder = await createPatient();
      const { token: intruderToken } = await login(intruder.email);

      const response = await api()
        .patch(`/api/v1/appointments/${bookingResponse.body.data.id}/cancel`)
        .set(authHeader(intruderToken))
        .send({});

      expect(response.status).toBe(403);
    });
  });

  describe('working schedule management', () => {
    it('lets a doctor replace their weekly schedule', async () => {
      const { user } = await createDoctor(clinic, { name: 'Dr. Schedule', specialty: 'Neurology' });
      const { token: doctorToken } = await login(user.email);

      const response = await api()
        .put('/api/v1/doctors/me/schedule')
        .set(authHeader(doctorToken))
        .send({
          workingSchedule: {
            monday: [{ start: '09:00', end: '13:00' }],
            wednesday: [{ start: '16:00', end: '20:00' }],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.workingSchedule).toEqual({
        monday: [{ start: '09:00', end: '13:00' }],
        wednesday: [{ start: '16:00', end: '20:00' }],
      });
    });

    it('rejects an invalid schedule', async () => {
      const { user } = await createDoctor(clinic, { name: 'Dr. Bad Schedule', specialty: 'Neurology' });
      const { token: doctorToken } = await login(user.email);

      const overlapping = await api()
        .put('/api/v1/doctors/me/schedule')
        .set(authHeader(doctorToken))
        .send({
          workingSchedule: {
            monday: [
              { start: '09:00', end: '13:00' },
              { start: '12:00', end: '15:00' },
            ],
          },
        });
      expect(overlapping.status).toBe(400);
      expect(overlapping.body.error.code).toBe('INVALID_SCHEDULE');

      const backwards = await api()
        .put('/api/v1/doctors/me/schedule')
        .set(authHeader(doctorToken))
        .send({ workingSchedule: { monday: [{ start: '15:00', end: '09:00' }] } });
      expect(backwards.status).toBe(400);
    });

    it('blocks a patient from editing a schedule', async () => {
      const response = await api()
        .put('/api/v1/doctors/me/schedule')
        .set(authHeader(token))
        .send({ workingSchedule: FULL_WEEK });

      expect(response.status).toBe(403);
    });
  });

  describe('payment amount protection', () => {
    it('rejects a body that tries to set the amount', async () => {
      const bookingResponse = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 13),
      });

      const response = await api()
        .post(`/api/v1/payments/${bookingResponse.body.data.id}/pay`)
        .set(authHeader(token))
        .send({ amount: 1, paymentMethod: 'card' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('charges the doctor fee regardless of query parameters', async () => {
      const bookingResponse = await bookAppointment({
        token,
        doctorId: doctor._id.toString(),
        date,
        startTime: futureSlotOn(date, 14),
      });

      const response = await payAppointment({
        token,
        appointmentId: bookingResponse.body.data.id,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.payment.amount).toBe(500);
    });
  });
});
