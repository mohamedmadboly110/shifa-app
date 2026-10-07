'use strict';

const { Appointment } = require('../models');
const {
  APPOINTMENT_STATUS,
  PAYMENT_STATUS,
  CHECK_IN_STATUS,
  ROLES,
} = require('../constants');
const { verifyCheckInToken } = require('../utils/tokens');
const {
  invalidCheckInToken,
  alreadyCheckedIn,
  notEligibleForCheckIn,
  paymentRequired,
  notFound,
  conflict,
  badRequest,
  clinicAccessDenied,
} = require('../errors');
const { todayKey, addDays, isValidDateKey } = require('../utils/dateTime');
const { logInfo, logWarn } = require('../utils/ApiResponse');
const { idOf } = require('./appointment.service');

/** How many days before/after the appointment day a patient may check in. */
const CHECK_IN_WINDOW = { daysBefore: 0, daysAfter: 1 };

const POPULATE = [
  { path: 'doctor', select: 'specialty user', populate: { path: 'user', select: 'name' } },
  { path: 'clinic', select: 'name address phone' },
];

/**
 * Check a patient in with their QR ticket.
 *
 * The ticket is an HMAC-signed opaque string: it carries internal ids only, so a
 * shared screenshot leaks nothing, and the signature is compared in constant time.
 *
 * Flow: CONFIRMED -> CHECKED_IN -> WAITING (the patient joins the clinic queue).
 *
 * @param {{token: string, actor: object, method?: 'self'|'staff', now?: Date}} input
 */
const checkIn = async ({ token, actor, method, now = new Date() }) => {
  if (typeof token !== 'string' || token.trim().length < 10) {
    throw invalidCheckInToken('A check-in ticket is required');
  }

  const payload = verifyCheckInToken(token.trim());

  const appointment = await Appointment.findById(payload.aid).populate(POPULATE);
  if (!appointment) throw notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');

  /* --- 1. ticket integrity: was it minted for this appointment? --- */
  if (!appointment.checkInTokenId) {
    throw invalidCheckInToken('No active ticket exists for this appointment');
  }
  if (appointment.checkInTokenId !== payload.jti) {
    throw invalidCheckInToken('This ticket has been superseded, ask the patient for a fresh one');
  }
  if (idOf(appointment.patient) !== payload.pid || idOf(appointment.clinic) !== payload.cid) {
    throw invalidCheckInToken('Ticket does not match this appointment');
  }

  /* --- 2. clinic tenancy: staff may only check in their own clinic --- */
  if (method === 'staff' && actor.role === ROLES.STAFF && idOf(appointment.clinic) !== actor.clinicId) {
    throw clinicAccessDenied();
  }

  /* --- 3. the appointment must be for today (or yesterday, grace window) --- */
  const today = todayKey(now);
  const earliest = addDays(appointment.appointmentDate, -CHECK_IN_WINDOW.daysBefore);
  const latest = addDays(appointment.appointmentDate, CHECK_IN_WINDOW.daysAfter);
  if (
    !isValidDateKey(appointment.appointmentDate) ||
    today < earliest ||
    today > latest
  ) {
    throw conflict(
      `Check-in is only allowed on ${appointment.appointmentDate} (or the following day)`,
      'NOT_APPOINTMENT_DAY',
    );
  }

  /* --- 4. payment must be settled --- */
  if (appointment.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw paymentRequired('This appointment has not been paid yet');
  }

  /* --- 5. state guards --- */
  if (appointment.checkInStatus === CHECK_IN_STATUS.CHECKED_IN) throw alreadyCheckedIn();
  if ([APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.NO_SHOW].includes(appointment.status)) {
    throw notEligibleForCheckIn(`A ${appointment.status.toLowerCase()} appointment cannot be checked in`);
  }
  if (appointment.status === APPOINTMENT_STATUS.PENDING_PAYMENT) {
    throw paymentRequired('Payment has not been completed for this appointment');
  }
  if ([APPOINTMENT_STATUS.WAITING, APPOINTMENT_STATUS.IN_CONSULTATION, APPOINTMENT_STATUS.CHECKED_IN].includes(appointment.status)) {
    throw alreadyCheckedIn();
  }

  /* --- 6. atomic check-in: the conditional update prevents duplicate check-ins --- */
  const updated = await Appointment.findOneAndUpdate(
    {
      _id: appointment._id,
      checkInStatus: CHECK_IN_STATUS.NOT_CHECKED_IN,
      status: APPOINTMENT_STATUS.CONFIRMED,
    },
    {
      $set: {
        checkInStatus: CHECK_IN_STATUS.CHECKED_IN,
        status: APPOINTMENT_STATUS.WAITING,
        checkedInAt: now,
        checkedInBy: actor.userId,
        checkInMethod: method,
      },
    },
    { new: true },
  );

  if (!updated) {
    // Lost the race: someone checked in between our read and our write.
    throw alreadyCheckedIn();
  }

  logInfo('Patient checked in', {
    appointmentId: updated._id.toString(),
    bookingReference: updated.bookingReference,
    clinicId: idOf(updated.clinic),
    byRole: actor.role,
    method,
  });

  return updated.populate(POPULATE);
};

/**
 * Patient self check-in: uses the ticket instead of a scanned code.
 * Identical rules - the ticket is the credential either way.
 */
const selfCheckIn = async ({ token, actor, now = new Date() }) => {
  const appointment = await checkIn({ token, actor, method: 'self', now });

  if (idOf(appointment.patient) !== actor.userId) {
    throw invalidCheckInToken('This ticket does not belong to the signed in patient');
  }

  return appointment;
};

/**
 * Staff assisted check-in.
 * Staff authenticate and submit the token; the appointment must belong to their clinic.
 */
const staffCheckIn = async ({ token, actor, now = new Date() }) => {
  if (actor.role === ROLES.PATIENT) throw badRequest('Staff credentials are required for assisted check-in', 'STAFF_REQUIRED');
  return checkIn({ token, actor, method: 'staff', now });
};

/** Queue position / status snapshot for the patient's own ticket. */
const getCheckInStatus = async (appointmentId, actor) => {
  const appointment = await Appointment.findById(appointmentId).populate(POPULATE);
  if (!appointment) throw notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');

  const isOwner = idOf(appointment.patient) === actor.userId;
  const isSameClinic = actor.clinicId && idOf(appointment.clinic) === actor.clinicId;
  if (!actor.isAdmin && !isOwner && !isSameClinic) throw clinicAccessDenied();

  // eslint-disable-next-line global-require
  const { buildQueueSnapshot } = require('./queue.service');
  const queue = await buildQueueSnapshot(actor, appointment);

  return { appointment, queue };
};

module.exports = { checkIn, selfCheckIn, staffCheckIn, getCheckInStatus, CHECK_IN_WINDOW };