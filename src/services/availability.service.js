'use strict';

const { Appointment, DoctorProfile } = require('../models');
const { env } = require('../config/env');
const {
  getWeekDay,
  toMinutes,
  fromMinutes,
  minutesUntil,
  isValidDateKey,
  rangesOverlap,
  addDays,
  todayKey,
} = require('../utils/dateTime');
const { notFound, badRequest, doctorInactive } = require('../errors');

/**
 * Slot generation engine.
 *
 * Rules:
 *  1. only inside the doctor's working hours for that weekday,
 *  2. fixed length slots (doctor override -> SLOT_DURATION_MINUTES),
 *  3. anything overlapping an existing active appointment is removed,
 *  4. slots closer than BOOKING_CUTOFF_MINUTES are not offered.
 */

/** Pure slot maths for one working day - no database access, easily testable. */
const buildSlotsForRanges = (ranges, slotDurationMinutes) => {
  const slots = [];
  for (const range of ranges) {
    const rangeStart = toMinutes(range.start);
    const rangeEnd = toMinutes(range.end);

    // Drop a trailing slot that does not fit entirely inside the working range.
    for (let cursor = rangeStart; cursor + slotDurationMinutes <= rangeEnd; cursor += slotDurationMinutes) {
      slots.push({
        startTime: fromMinutes(cursor),
        endTime: fromMinutes(cursor + slotDurationMinutes),
        startMinutes: cursor,
        endMinutes: cursor + slotDurationMinutes,
      });
    }
  }

  return slots.sort((a, b) => a.startMinutes - b.startMinutes);
};

/** Slots that are still bookable (not past the cutoff, not overlapping a booking). */
const filterBookableSlots = (slots, takenSlots, { now = new Date(), cutoffMinutes = env.BOOKING_CUTOFF_MINUTES } = {}) =>
  slots.filter((slot) => {
    if (minutesUntil(slot.dateKey, slot.startTime, now) <= cutoffMinutes) return false;
    return !takenSlots.some((taken) => rangesOverlap(slot.startMinutes, slot.endMinutes, taken.startMinutes, taken.endMinutes));
  });

/**
 * Full availability picture for one doctor on one date.
 *
 * @param {import('mongoose').Document} doctor DoctorProfile document
 * @param {string} dateKey YYYY-MM-DD
 * @param {{excludeAppointmentId?: string, now?: Date}} [options]
 */
const buildAvailability = async (doctor, dateKey, options = {}) => {
  const now = options.now ?? new Date();
  if (!isValidDateKey(dateKey)) {
    throw badRequest(`Invalid date "${dateKey}". Expected YYYY-MM-DD`, 'INVALID_DATE');
  }

  const weekDay = getWeekDay(dateKey);
  const ranges = doctor.rangesFor(weekDay);
  const slotDurationMinutes = doctor.effectiveSlotDuration || env.SLOT_DURATION_MINUTES;

  const takenQuery = {
    doctor: doctor._id,
    appointmentDate: dateKey,
    slotHeld: true,
  };
  if (options.excludeAppointmentId) {
    takenQuery._id = { $ne: options.excludeAppointmentId };
  }

  const takenAppointments = await Appointment.find(takenQuery)
    .select('startTime endTime status')
    .lean();

  const takenSlots = takenAppointments.map((appointment) => ({
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    appointmentId: appointment._id.toString(),
    startMinutes: toMinutes(appointment.startTime),
    endMinutes: toMinutes(appointment.endTime),
  }));

  const slots = buildSlotsForRanges(ranges, slotDurationMinutes).map((slot) => ({ ...slot, dateKey }));
  const available = filterBookableSlots(slots, takenSlots, { now });

  return {
    doctorId: doctor._id.toString(),
    date: dateKey,
    weekday: weekDay,
    isWorkingDay: ranges.length > 0,
    workingHours: ranges.map(({ start, end }) => ({ start, end })),
    slotDurationMinutes,
    totalSlots: slots.length,
    bookedSlots: takenSlots.length,
    availableSlots: available.map(({ startTime, endTime }) => ({ startTime, endTime })),
    slots: available.map(({ startTime, endTime }) => ({ startTime, endTime })),
    taken: takenSlots
      .map(({ startTime, endTime, status, appointmentId }) => ({ startTime, endTime, status, appointmentId }))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)),
  };
};

/** Public endpoint: available slots for a doctor on a date. */
const getDoctorAvailability = async (doctorId, dateKey, options = {}) => {
  const doctor = await DoctorProfile.findById(doctorId);
  if (!doctor) throw notFound('Doctor not found', 'DOCTOR_NOT_FOUND');
  if (!doctor.isActive && !options.includeInactive) throw doctorInactive();

  return buildAvailability(doctor, dateKey, options);
};

/** Doctor's own calendar: slots with their booking state, for the next N days. */
const getDoctorWorkingDays = async (doctor, { days = 7, now = new Date() } = {}) => {
  const start = todayKey(now);
  const result = [];

  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = addDays(start, offset);
    const availability = await buildAvailability(doctor, dateKey, { now });
    if (availability.isWorkingDay) result.push(availability);
  }

  return result;
};

module.exports = {
  buildSlotsForRanges,
  filterBookableSlots,
  buildAvailability,
  getDoctorAvailability,
  getDoctorWorkingDays,
};