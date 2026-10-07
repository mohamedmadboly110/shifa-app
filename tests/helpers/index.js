'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { Clinic, User, DoctorProfile, Appointment, Payment } = require('../../src/models');
const { ROLES, APPOINTMENT_STATUS, PAYMENT_STATUS, CHECK_IN_STATUS } = require('../../src/constants');
const { addDays, todayKey, toMinutes, fromMinutes, getWeekDay } = require('../../src/utils/dateTime');

const app = createApp();
const api = () => request(app);

const PASSWORD = 'Passw0rd!23';

/** Working 08:00 - 18:00, seven days a week, for deterministic slot maths. */
const FULL_WEEK = (() => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days.reduce((schedule, day) => {
    schedule[day] = [{ start: '08:00', end: '18:00' }];
    return schedule;
  }, {});
})();

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

const createClinic = async (overrides = {}) =>
  Clinic.create({
    name: overrides.name || `Clinic ${Math.random().toString(36).slice(2, 8)}`,
    address: overrides.address || '1 Test Street',
    phone: overrides.phone || '+20 100 000 0000',
    ...overrides,
  });

const createStaff = async (clinic, overrides = {}) =>
  User.create({
    name: 'Reception',
    email: `staff.${Math.random().toString(36).slice(2, 10)}@shifa.test`,
    password: PASSWORD,
    role: ROLES.STAFF,
    clinic: clinic._id,
    ...overrides,
  });

const createPatient = async (overrides = {}) =>
  User.create({
    name: 'Test Patient',
    email: `patient.${Math.random().toString(36).slice(2, 10)}@shifa.test`,
    password: PASSWORD,
    role: ROLES.PATIENT,
    ...overrides,
  });

const createDoctor = async (clinic, overrides = {}) => {
  const user = await User.create({
    name: overrides.name || 'Dr. Test',
    email: `doctor.${Math.random().toString(36).slice(2, 10)}@shifa.test`,
    password: PASSWORD,
    role: ROLES.DOCTOR,
    clinic: clinic._id,
  });

  const doctor = await DoctorProfile.create({
    user: user._id,
    clinic: clinic._id,
    specialty: overrides.specialty || 'Cardiology',
    bio: 'Test doctor',
    consultationFee: overrides.consultationFee ?? 400,
    currency: 'EGP',
    slotDurationMinutes: overrides.slotDurationMinutes ?? null,
    workingSchedule: overrides.workingSchedule || FULL_WEEK,
    isActive: overrides.isActive ?? true,
  });

  return { doctor, user };
};

const createAdmin = async (overrides = {}) =>
  User.create({
    name: 'Admin',
    email: `admin.${Math.random().toString(36).slice(2, 10)}@shifa.test`,
    password: PASSWORD,
    role: ROLES.ADMIN,
    ...overrides,
  });

/* -------------------------------------------------------------------------- */
/* Auth helpers                                                                */
/* -------------------------------------------------------------------------- */

const login = async (email, password = PASSWORD) => {
  const response = await api().post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { token: response.body.data.token, user: response.body.data.user, response };
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

const registerPatient = async (overrides = {}) => {
  const payload = {
    name: 'New Patient',
    email: `new.${Math.random().toString(36).slice(2, 10)}@shifa.test`,
    password: PASSWORD,
    phone: '+20 122 222 2222',
    ...overrides,
  };
  const response = await api().post('/api/v1/auth/register').send(payload);
  return { response, payload, token: response.body?.data?.token, user: response.body?.data?.user };
};

/* -------------------------------------------------------------------------- */
/* Booking helpers                                                             */
/* -------------------------------------------------------------------------- */

const futureDate = (daysAhead = 1) => addDays(todayKey(), daysAhead);

/** First slot on `date` that is comfortably in the future. */
const futureSlotOn = (date, slotIndex = 2) => {
  const ranges = FULL_WEEK[getWeekDay(date)];
  const startMinutes = toMinutes(ranges[0].start) + slotIndex * 30;
  return fromMinutes(startMinutes);
};

const bookAppointment = async ({ token, doctorId, date = futureDate(1), startTime }) => {
  const response = await api()
    .post('/api/v1/appointments')
    .set(authHeader(token))
    .send({ doctorId, date, startTime: startTime || futureSlotOn(date) });

  return response;
};

const payAppointment = async ({ token, appointmentId, simulate }) => {
  const requestBuilder = api().post(`/api/v1/payments/${appointmentId}/pay`).set(authHeader(token));
  if (simulate) requestBuilder.set('X-Simulate-Payment', simulate);
  return requestBuilder.send({ paymentMethod: 'card' });
};

/** Book + pay in one step, returning ids, token and the QR ticket. */
const bookAndPay = async ({ token, doctorId, date = futureDate(1), startTime, simulate }) => {
  const booking = await bookAppointment({ token, doctorId, date, startTime });
  if (booking.status !== 201) {
    throw new Error(`Booking failed: ${booking.status} ${JSON.stringify(booking.body)}`);
  }

  const appointmentId = booking.body.data.id;
  const payment = await payAppointment({ token, appointmentId, simulate });
  if (payment.status !== 200) {
    throw new Error(`Payment failed: ${payment.status} ${JSON.stringify(payment.body)}`);
  }

  return {
    appointmentId,
    bookingResponse: booking,
    paymentResponse: payment,
    ticket: payment.body.data.ticket,
    token: payment.body.data.ticket.token,
  };
};

/** Move an appointment straight to a given state (queue test setup). */
const setAppointmentState = async (appointmentId, { status, checkInStatus, checkedInAt } = {}) => {
  const update = {};
  if (status) update.status = status;
  if (checkInStatus) update.checkInStatus = checkInStatus;
  if (checkedInAt) update.checkedInAt = checkedInAt;
  return Appointment.findByIdAndUpdate(appointmentId, { $set: update }, { new: true });
};

/**
 * Create an appointment (and optionally its payment/ticket) directly in MongoDB.
 *
 * Needed for queue and check-in tests: those features are only valid on the
 * appointment day, which would make the suite fail if it runs late at night.
 * Using the model directly keeps those tests independent of the current hour.
 */
const createAppointmentFixture = async ({
  patient,
  doctor,
  date = todayKey(),
  startTime = '09:00',
  status = APPOINTMENT_STATUS.CONFIRMED,
  paymentStatus = PAYMENT_STATUS.PAID,
  checkInStatus = CHECK_IN_STATUS.NOT_CHECKED_IN,
  checkedInAt = null,
}) => {
  const appointment = await Appointment.create({
    patient: patient._id,
    doctor: doctor._id,
    clinic: doctor.clinic,
    appointmentDate: date,
    startTime,
    endTime: fromMinutes(toMinutes(startTime) + (doctor.slotDurationMinutes || 30)),
    status,
    paymentStatus,
    checkInStatus,
    fee: doctor.consultationFee,
    currency: doctor.currency || 'EGP',
    bookingReference: `SHF-TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    slotHeld: true,
    checkedInAt,
  });

  let ticket = null;

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    await Payment.create({
      appointment: appointment._id,
      patient: patient._id,
      clinic: doctor.clinic,
      amount: doctor.consultationFee,
      currency: doctor.currency || 'EGP',
      status: PAYMENT_STATUS.PAID,
      transactionReference: `SIMPAY_test${Math.random().toString(36).slice(2, 10)}`,
      provider: 'simulated',
      paidAt: new Date(),
    });

    // eslint-disable-next-line global-require
    const { issueCheckInTicket } = require('../../src/services/checkInTicket.service');
    ticket = (await issueCheckInTicket(appointment)).token;
  }

  return { appointment, ticket };
};

const models = { Clinic, User, DoctorProfile, Appointment, Payment };

module.exports = {
  app,
  api,
  request,
  PASSWORD,
  FULL_WEEK,
  models,
  // Also exposed flat: most suites assert on the stored document directly.
  Clinic,
  User,
  DoctorProfile,
  Appointment,
  Payment,
  // factories
  createClinic,
  createStaff,
  createPatient,
  createDoctor,
  createAdmin,
  // auth
  login,
  authHeader,
  registerPatient,
  // booking
  bookAppointment,
  payAppointment,
  bookAndPay,
  setAppointmentState,
  createAppointmentFixture,
  futureDate,
  futureSlotOn,
  todayKey,
  addDays,
  getWeekDay,
  toMinutes,
  fromMinutes,
};
