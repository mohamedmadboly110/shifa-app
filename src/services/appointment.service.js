'use strict';

const { Appointment, DoctorProfile, User } = require('../models');
const {
  APPOINTMENT_STATUS,
  PAYMENT_STATUS,
  CHECK_IN_STATUS,
  CANCELLABLE_STATUSES,
  APPOINTMENT_TRANSITIONS,
  ROLES,
} = require('../constants');
const { env } = require('../config/env');
const {
  notFound,
  badRequest,
  forbidden,
  slotUnavailable,
  outsideWorkingHours,
  appointmentInPast,
  doctorInactive,
  appointmentConflict,
  invalidStatusTransition,
  cancellationNotAllowed,
  clinicAccessDenied,
  conflict,
} = require('../errors');
const {
  toMinutes,
  fromMinutes,
  getWeekDay,
  minutesUntil,
  isValidDateKey,
  isValidTime,
  rangesOverlap,
} = require('../utils/dateTime');
const { buildAvailability } = require('./availability.service');
const { issueCheckInTicket, buildTicketResponse, assertTicketEligible } = require('./checkInTicket.service');
const { generateBookingReference } = require('../utils/tokens');
const { logInfo, logWarn } = require('../utils/ApiResponse');

const APPOINTMENT_POPULATE = [
  { path: 'doctor', select: 'specialty consultationFee currency clinic user', populate: { path: 'user', select: 'name' } },
  { path: 'clinic', select: 'name address phone' },
];

/** Read an id from either a raw ObjectId or a populated sub-document. */
const idOf = (value) => (value?._id ?? value)?.toString?.() ?? null;

/** Retry the (astronomically unlikely) booking-reference collision. */
const buildUniqueBookingReference = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bookingReference = generateBookingReference();
    // eslint-disable-next-line no-await-in-loop
    const exists = await Appointment.exists({ bookingReference });
    if (!exists) return bookingReference;
  }
  throw conflict('Could not allocate a booking reference, please retry', 'BOOKING_REFERENCE_EXHAUSTED');
};

/**
 * Validate every booking rule server side.
 * Fee, clinic, doctor state and availability are never taken from the client.
 */
const assertSlotIsBookable = async ({ doctor, patientId, date, time, now = new Date() }) => {
  if (!doctor.isActive) throw doctorInactive();

  const duration = doctor.effectiveSlotDuration || env.SLOT_DURATION_MINUTES;
  const startMinutes = toMinutes(time);
  const endMinutes = startMinutes + duration;
  const endTime = fromMinutes(endMinutes);

  // 1. Not in the past / past the booking cutoff
  if (minutesUntil(date, time, now) <= env.BOOKING_CUTOFF_MINUTES) throw appointmentInPast();

  // 2. Inside the doctor's working hours for that weekday
  const ranges = doctor.rangesFor(getWeekDay(date));
  if (!ranges.length) throw outsideWorkingHours();

  const fitsWorkingHours = ranges.some(
    (range) => startMinutes >= range.startMinutes && endMinutes <= range.endMinutes,
  );
  if (!fitsWorkingHours) throw outsideWorkingHours();

  // 3. Slot not already taken.
  //    This pre-check exists for a friendly error message only - the unique
  //    partial index is what actually guarantees correctness under concurrency.
  //    The patient's own bookings are excluded here: their conflict is reported
  //    more precisely in step 4 as PATIENT_APPOINTMENT_CONFLICT.
  const conflicting = await Appointment.findOne({
    doctor: doctor._id,
    appointmentDate: date,
    slotHeld: true,
    patient: { $ne: patientId },
  })
    .select('startTime endTime')
    .lean();

  if (
    conflicting &&
    rangesOverlap(startMinutes, endMinutes, toMinutes(conflicting.startTime), toMinutes(conflicting.endTime))
  ) {
    throw slotUnavailable();
  }

  // 4. One visit per patient per doctor per day. Any held appointment for the
  //    same doctor on the same date - even an adjacent slot - means this patient
  //    already has that consultation booked; a second one would be a duplicate.
  //    (Stricter than a pure range-overlap check, and simpler to reason about.)
  const patientAppointment = await Appointment.exists({
    patient: patientId,
    doctor: doctor._id,
    appointmentDate: date,
    slotHeld: true,
  });
  if (patientAppointment) throw appointmentConflict();

  return { endTime, duration };
};

/**
 * Book an appointment for a patient.
 *
 * Concurrency: the unique partial index on (doctor, appointmentDate,
 * startTime) where slotHeld = true is the source of truth. When two requests
 * race, MongoDB commits exactly one insert; the loser receives E11000 which we
 * translate into 409 APPOINTMENT_SLOT_UNAVAILABLE.
 */
const createAppointment = async ({ patientId, doctorId, date, startTime, note }, options = {}) => {
  if (!isValidDateKey(date)) throw badRequest('Invalid appointment date', 'INVALID_DATE');
  if (!isValidTime(startTime)) throw badRequest('Invalid appointment time', 'INVALID_TIME');

  const now = options.now ?? new Date();

  const [doctor, patient] = await Promise.all([
    DoctorProfile.findById(doctorId),
    User.findById(patientId).select('role isActive'),
  ]);

  if (!doctor) throw notFound('Doctor not found', 'DOCTOR_NOT_FOUND');
  if (!patient) throw notFound('Patient not found', 'PATIENT_NOT_FOUND');
  if (patient.role !== ROLES.PATIENT) throw forbidden('Only patients can book appointments', 'NOT_A_PATIENT');
  if (!patient.isActive) throw forbidden('Your account is not active', 'ACCOUNT_INACTIVE');

  const { endTime } = await assertSlotIsBookable({ doctor, patientId, date, time: startTime, now });
  const bookingReference = await buildUniqueBookingReference();

  try {
    const appointment = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      clinic: doctor.clinic,
      appointmentDate: date,
      startTime,
      endTime,
      status: APPOINTMENT_STATUS.PENDING_PAYMENT,
      paymentStatus: PAYMENT_STATUS.PENDING,
      checkInStatus: CHECK_IN_STATUS.NOT_CHECKED_IN,
      fee: doctor.consultationFee,
      currency: doctor.currency,
      bookingReference,
      patientNote: note ?? null,
      slotHeld: true,
    });

    logInfo('Appointment created', {
      appointmentId: appointment._id.toString(),
      bookingReference,
      doctorId: doctor._id.toString(),
      clinicId: doctor.clinic.toString(),
      patientId: patient._id.toString(),
      date,
      startTime,
    });

    return appointment.populate(APPOINTMENT_POPULATE);
  } catch (error) {
    if (error?.code === 11000) {
      logWarn('Double booking blocked by unique slot index', {
        doctorId: doctorId.toString(),
        date,
        startTime,
      });
      throw slotUnavailable();
    }
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* Access control                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ownership / tenancy rules applied to every appointment read and write.
 *  - admin : full access
 *  - doctor: own appointments inside own clinic
 *  - staff : own clinic only
 *  - patient: own appointments only
 */
const assertActorMayAccess = (appointment, actor) => {
  if (actor.role === ROLES.ADMIN) return true;

  const clinicId = idOf(appointment.clinic);

  if (actor.role === ROLES.PATIENT) {
    if (idOf(appointment.patient) !== actor.userId) {
      throw forbidden('You can only access your own appointments', 'NOT_APPOINTMENT_OWNER');
    }
    return true;
  }

  if (actor.role === ROLES.DOCTOR) {
    if (clinicId !== actor.clinicId) throw clinicAccessDenied();
    if (idOf(appointment.doctor) !== actor.doctorId) {
      throw forbidden('This appointment belongs to another doctor', 'NOT_APPOINTMENT_DOCTOR');
    }
    return true;
  }

  if (actor.role === ROLES.STAFF) {
    if (clinicId !== actor.clinicId) throw clinicAccessDenied();
    return true;
  }

  throw forbidden('You do not have access to this appointment');
};

/** Load an appointment and assert access in one step. */
const loadAppointmentForActor = async (appointmentId, actor, { populate = APPOINTMENT_POPULATE } = {}) => {
  const query = Appointment.findById(appointmentId);
  if (populate) query.populate(populate);

  const appointment = await query;
  if (!appointment) throw notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');

  assertActorMayAccess(appointment, actor);
  return appointment;
};

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

const listPatientAppointments = async (patientId, { status, page = 1, limit = 20 } = {}) => {
  const query = { patient: patientId };
  if (status) query.status = status;

  const [appointments, total] = await Promise.all([
    Appointment.find(query)
      .sort({ appointmentDate: -1, startTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(APPOINTMENT_POPULATE),
    Appointment.countDocuments(query),
  ]);

  return { appointments, total };
};

/** Doctor / staff / admin list, always constrained by tenant. */
const listAppointmentsForClinic = async (actor, { date, doctorId, status, patientId, page = 1, limit = 50 } = {}) => {
  const query = {};
  if (!actor.isAdmin) query.clinic = actor.clinicId;
  if (date) query.appointmentDate = date;
  if (doctorId) query.doctor = doctorId;
  if (patientId) query.patient = patientId;
  if (status) query.status = status;

  const [appointments, total] = await Promise.all([
    Appointment.find(query)
      .sort({ appointmentDate: 1, startTime: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([...APPOINTMENT_POPULATE, { path: 'patient', select: 'name phone email' }]),
    Appointment.countDocuments(query),
  ]);

  return { appointments, total };
};

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

const assertTransitionAllowed = (from, to) => {
  const allowed = APPOINTMENT_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) throw invalidStatusTransition(from, to);
};

/**
 * Cancellation.
 * Allowed while the slot has not started (CANCELLATION_CUTOFF_MINUTES) and the
 * appointment is not completed / in consultation / already cancelled.
 * Paid appointments are refunded before the status is changed, so a failing
 * gateway can never cancel a paid visit.
 */
const cancelAppointment = async (appointmentId, actor, { reason } = {}) => {
  if (actor.role === ROLES.DOCTOR) {
    throw forbidden('Doctors cannot cancel appointments, contact clinic staff', 'CANCELLATION_NOT_ALLOWED');
  }

  const appointment = await loadAppointmentForActor(appointmentId, actor);

  if (!CANCELLABLE_STATUSES.includes(appointment.status)) {
    throw cancellationNotAllowed(`An appointment with status ${appointment.status} can no longer be cancelled`);
  }

  const minutesToStart = minutesUntil(appointment.appointmentDate, appointment.startTime);
  if (minutesToStart <= env.CANCELLATION_CUTOFF_MINUTES) {
    throw cancellationNotAllowed(
      `Appointments can only be cancelled at least ${env.CANCELLATION_CUTOFF_MINUTES} minutes before the start time`,
    );
  }

  let refunded = false;
  if (appointment.paymentStatus === PAYMENT_STATUS.PAID) {
    // Lazy require: payment.service depends on this module, not the other way round.
    // eslint-disable-next-line global-require
    const { refundPayment } = require('./payment/payment.service');
    await refundPayment({ appointment, actor });
    // Keep the object we return in sync with the DB (refundPayment writes
    // directly via updateOne, which does not refresh this in-memory document).
    appointment.paymentStatus = PAYMENT_STATUS.REFUNDED;
    refunded = true;
  }

  appointment.status = APPOINTMENT_STATUS.CANCELLED;
  appointment.slotHeld = false; // frees the slot so it can be booked again
  appointment.cancelledAt = new Date();
  appointment.cancelledBy = actor.userId;
  appointment.cancellationReason = reason ? String(reason).slice(0, 300) : null;
  await appointment.save();

  logInfo('Appointment cancelled', {
    appointmentId: appointment._id.toString(),
    byRole: actor.role,
    refunded,
  });

  return appointment;
};

/**
 * Patient's QR ticket (re-issued on demand so the patient always has a valid one).
 */
const getCheckInTicket = async (appointmentId, actor) => {
  if (![ROLES.PATIENT, ROLES.STAFF, ROLES.ADMIN].includes(actor.role)) {
    throw forbidden('Only the patient or clinic staff can request a ticket', 'TICKET_ACCESS_DENIED');
  }

  const appointment = await loadAppointmentForActor(appointmentId, actor);
  assertTicketEligible(appointment);

  const ticket = await issueCheckInTicket(appointment);
  logInfo('Check-in ticket issued', { appointmentId: appointment._id.toString(), role: actor.role });

  return { appointment, ticket: buildTicketResponse(ticket, appointment) };
};

module.exports = {
  APPOINTMENT_POPULATE,
  idOf,
  assertSlotIsBookable,
  createAppointment,
  assertActorMayAccess,
  assertTransitionAllowed,
  loadAppointmentForActor,
  listPatientAppointments,
  listAppointmentsForClinic,
  cancelAppointment,
  getCheckInTicket,
  buildAvailability,
};