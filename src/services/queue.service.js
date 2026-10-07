'use strict';

const { Appointment, DoctorProfile } = require('../models');
const {
  APPOINTMENT_STATUS,
  CHECK_IN_STATUS,
  QUEUE_ACTIVE_STATUSES,
  ROLES,
} = require('../constants');
const {
  notFound,
  forbidden,
  queueBusy,
  conflict,
  clinicAccessDenied,
  invalidStatusTransition,
} = require('../errors');
const { todayKey, minutesUntil } = require('../utils/dateTime');
const { logInfo, logWarn } = require('../utils/ApiResponse');
const { idOf, assertTransitionAllowed } = require('./appointment.service');

/**
 * Clinic queue.
 *
 * The queue is *derived* from appointment data - there is no separate Queue
 * collection, so it can never drift out of sync with the appointments.
 *
 *   CONFIRMED --(QR check-in)--> WAITING --(doctor starts)--> IN_CONSULTATION
 *                                              --(doctor completes)--> COMPLETED
 *
 * Ordering rule: by `checkedInAt` (whoever arrived first is served first).
 */

const QUEUE_POPULATE = [
  { path: 'doctor', select: 'specialty user', populate: { path: 'user', select: 'name' } },
  { path: 'clinic', select: 'name' },
  { path: 'patient', select: 'name phone' },
];

/**
 * Restrict queries to the actor's clinic; doctors are limited to their own list.
 * Patients have no clinic of their own, so they are never clinic-scoped here -
 * their only queue read is the snapshot for their own appointment (which also
 * pins the doctor), so the clinic filter would only hide the very row we want.
 */
const buildScopeQuery = (actor, base = {}) => {
  const query = { ...base };
  if (!actor.isAdmin && actor.role !== ROLES.PATIENT) query.clinic = actor.clinicId;
  return query;
};

/**
 * The live queue for one doctor (or the whole clinic for staff).
 * @returns {Promise<{current: object|null, waiting: object[], completed: object[], stats: object}>}
 */
const getQueue = async (actor, { doctorId, date = todayKey() } = {}) => {
  const query = buildScopeQuery(actor, { appointmentDate: date });
  if (doctorId) query.doctor = doctorId;
  else if (actor.role === ROLES.DOCTOR) query.doctor = actor.doctorId;

  const appointments = await Appointment.find(query)
    .populate(QUEUE_POPULATE)
    .sort({ checkedInAt: 1, startTime: 1 })
    .lean();

  const queued = appointments.filter((appointment) =>
    QUEUE_ACTIVE_STATUSES.includes(appointment.status),
  );

  const current = queued.find((item) => item.status === APPOINTMENT_STATUS.IN_CONSULTATION) || null;
  const waiting = queued
    .filter((item) => item.status === APPOINTMENT_STATUS.WAITING)
    .map((item, index) => ({ ...item, queuePosition: index + 1 }));
  const completed = appointments.filter((item) => item.status === APPOINTMENT_STATUS.COMPLETED);

  return {
    date,
    doctorId: doctorId || (actor.role === ROLES.DOCTOR ? actor.doctorId : null),
    current,
    waiting,
    completed,
    stats: {
      total: appointments.length,
      waiting: waiting.length,
      inConsultation: current ? 1 : 0,
      completed: completed.length,
      checkedIn: appointments.filter((item) => item.checkInStatus === CHECK_IN_STATUS.CHECKED_IN).length,
    },
  };
};

/** Compact queue view for the patient's own appointment screen. */
const buildQueueSnapshot = async (actor, appointment) => {
  const queue = await getQueue(actor, {
    doctorId: idOf(appointment.doctor),
    date: appointment.appointmentDate,
  });

  const position = queue.waiting.findIndex(
    (item) => item._id.toString() === appointment._id.toString(),
  );

  return {
    date: queue.date,
    yourPosition: position >= 0 ? position + 1 : null,
    peopleAhead: position > 0 ? position : 0,
    currentPatient: queue.current
      ? { patientName: queue.current.patient?.name, since: queue.current.startedAt }
      : null,
    inConsultation: Boolean(queue.current),
    status: appointment.status,
  };
};

/** Load an appointment and assert the actor may manage the queue for it. */
const loadQueueAppointment = async (appointmentId, actor) => {
  const appointment = await Appointment.findById(appointmentId).populate(QUEUE_POPULATE);
  if (!appointment) throw notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');

  if (actor.role === ROLES.DOCTOR) {
    if (idOf(appointment.clinic) !== actor.clinicId) throw clinicAccessDenied();
    if (idOf(appointment.doctor) !== actor.doctorId) {
      throw forbidden('You can only manage your own consultation queue', 'NOT_APPOINTMENT_DOCTOR');
    }
  } else if (actor.role === ROLES.STAFF) {
    if (idOf(appointment.clinic) !== actor.clinicId) throw clinicAccessDenied();
  } else if (actor.role !== ROLES.ADMIN) {
    throw forbidden('Only doctors and clinic staff can manage the queue', 'QUEUE_ACCESS_DENIED');
  }

  return appointment;
};

/**
 * Start a consultation.
 *
 * Guards:
 *  - the patient must have checked in (WAITING only),
 *  - no other consultation may be in progress for that doctor (one patient at a time),
 *  - the transition is a conditional atomic update.
 */
const startConsultation = async (appointmentId, actor) => {
  const appointment = await loadQueueAppointment(appointmentId, actor);

  if (appointment.checkInStatus !== CHECK_IN_STATUS.CHECKED_IN) {
    throw conflict('The patient must check in before the consultation can start', 'CHECK_IN_REQUIRED');
  }
  if (appointment.status !== APPOINTMENT_STATUS.WAITING) {
    throw invalidStatusTransition(appointment.status, APPOINTMENT_STATUS.IN_CONSULTATION);
  }
  assertTransitionAllowed(appointment.status, APPOINTMENT_STATUS.IN_CONSULTATION);

  // One consultation at a time per doctor.
  const inProgress = await Appointment.findOne({
    doctor: appointment.doctor._id ?? appointment.doctor,
    status: APPOINTMENT_STATUS.IN_CONSULTATION,
    _id: { $ne: appointment._id },
  })
    .select('_id patient')
    .populate('patient', 'name')
    .lean();

  if (inProgress) {
    logWarn('Consultation start blocked, doctor is busy', {
      doctorId: idOf(appointment.doctor),
      busyAppointmentId: inProgress._id.toString(),
    });
    throw queueBusy('This doctor is already consulting with another patient');
  }

  const updated = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: APPOINTMENT_STATUS.WAITING },
    { $set: { status: APPOINTMENT_STATUS.IN_CONSULTATION, startedAt: new Date() } },
    { new: true },
  );

  if (!updated) throw conflict('The queue changed, please refresh and try again', 'QUEUE_CHANGED');

  logInfo('Consultation started', {
    appointmentId: updated._id.toString(),
    doctorId: idOf(updated.doctor),
    byRole: actor.role,
  });

  return updated.populate(QUEUE_POPULATE);
};

/** Complete a consultation. */
const completeConsultation = async (appointmentId, actor) => {
  const appointment = await loadQueueAppointment(appointmentId, actor);

  if (appointment.status !== APPOINTMENT_STATUS.IN_CONSULTATION) {
    throw invalidStatusTransition(appointment.status, APPOINTMENT_STATUS.COMPLETED);
  }
  assertTransitionAllowed(appointment.status, APPOINTMENT_STATUS.COMPLETED);

  const updated = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: APPOINTMENT_STATUS.IN_CONSULTATION },
    { $set: { status: APPOINTMENT_STATUS.COMPLETED, completedAt: new Date() } },
    { new: true },
  );

  if (!updated) throw conflict('The consultation was already completed', 'QUEUE_CHANGED');

  logInfo('Consultation completed', { appointmentId: updated._id.toString(), byRole: actor.role });

  return updated.populate(QUEUE_POPULATE);
};

/** Mark a checked-in patient as a no-show (staff/doctor only). */
const markNoShow = async (appointmentId, actor) => {
  const appointment = await loadQueueAppointment(appointmentId, actor);

  assertTransitionAllowed(appointment.status, APPOINTMENT_STATUS.NO_SHOW);
  if (
    ![APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.WAITING, APPOINTMENT_STATUS.CHECKED_IN].includes(
      appointment.status,
    )
  ) {
    throw invalidStatusTransition(appointment.status, APPOINTMENT_STATUS.NO_SHOW);
  }

  const updated = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: appointment.status },
    { $set: { status: APPOINTMENT_STATUS.NO_SHOW, completedAt: new Date() } },
    { new: true },
  );

  if (!updated) throw conflict('The appointment changed, please refresh', 'QUEUE_CHANGED');

  logInfo('Appointment marked as no show', { appointmentId: updated._id.toString(), byRole: actor.role });

  return updated.populate(QUEUE_POPULATE);
};

/**
 * Doctor/staff dashboard for a day: schedule + queue in one call.
 */
const getClinicDayView = async (actor, { date = todayKey(), doctorId } = {}) => {
  if (actor.role === ROLES.DOCTOR && doctorId && doctorId !== actor.doctorId) {
    throw forbidden('You can only view your own day', 'NOT_APPOINTMENT_DOCTOR');
  }

  const scopeDoctorId = actor.role === ROLES.DOCTOR ? actor.doctorId : doctorId;
  const query = buildScopeQuery(actor, { appointmentDate: date });
  if (scopeDoctorId) query.doctor = scopeDoctorId;

  const appointments = await Appointment.find(query)
    .populate(QUEUE_POPULATE)
    .sort({ startTime: 1 })
    .lean();

  const [queue, doctors] = await Promise.all([
    getQueue(actor, { doctorId: scopeDoctorId, date }),
    DoctorProfile.find(buildScopeQuery(actor)).select('user specialty').populate('user', 'name').lean(),
  ]);

  return {
    date,
    appointments,
    queue,
    doctors: doctors.map((doctor) => ({
      id: doctor._id.toString(),
      name: doctor.user?.name,
      specialty: doctor.specialty,
    })),
    summary: {
      total: appointments.length,
      confirmed: appointments.filter((a) => a.status === APPOINTMENT_STATUS.CONFIRMED).length,
      waiting: appointments.filter((a) => a.status === APPOINTMENT_STATUS.WAITING).length,
      completed: appointments.filter((a) => a.status === APPOINTMENT_STATUS.COMPLETED).length,
      cancelled: appointments.filter((a) => a.status === APPOINTMENT_STATUS.CANCELLED).length,
      noShow: appointments.filter((a) => a.status === APPOINTMENT_STATUS.NO_SHOW).length,
      expectedRevenue: appointments
        .filter((a) => a.paymentStatus === 'PAID')
        .reduce((sum, a) => sum + (a.fee || 0), 0),
    },
  };
};

/** Doctor's own available slots for the coming days (schedule management UI). */
const getDoctorSchedule = async (actor, { days = 7 } = {}) => {
  // eslint-disable-next-line global-require
  const { getDoctorWorkingDays } = require('./availability.service');
  const profile = await DoctorProfile.findById(actor.doctorId);
  if (!profile) throw notFound('Doctor profile not found', 'DOCTOR_PROFILE_NOT_FOUND');

  return {
    workingSchedule: profile.getWorkingSchedule(),
    slotDurationMinutes: profile.effectiveSlotDuration,
    days: await getDoctorWorkingDays(profile, { days: Math.min(Number(days) || 7, 31) }),
  };
};

/** Convenience helper: minutes until a waiting patient is expected to be seen. */
const estimateWaitMinutes = (appointment, ahead = 0) => {
  const base = minutesUntil(appointment.appointmentDate, appointment.startTime);
  return Math.max(0, base - ahead * 15);
};

module.exports = {
  QUEUE_POPULATE,
  getQueue,
  buildQueueSnapshot,
  startConsultation,
  completeConsultation,
  markNoShow,
  getClinicDayView,
  getDoctorSchedule,
  estimateWaitMinutes,
};