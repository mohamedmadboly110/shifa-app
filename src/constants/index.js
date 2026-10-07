'use strict';

/**
 * Shared enums / constants.
 * Kept in one place so models, services and validators never drift apart.
 */

const ROLES = Object.freeze({
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  STAFF: 'staff',
  ADMIN: 'admin',
});

const USER_ROLES = Object.freeze(Object.values(ROLES));

/** Roles that are bound to a single clinic (tenant scoped). */
const TENANT_ROLES = Object.freeze([ROLES.DOCTOR, ROLES.STAFF]);

const APPOINTMENT_STATUS = Object.freeze({
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  CHECKED_IN: 'CHECKED_IN',
  WAITING: 'WAITING',
  IN_CONSULTATION: 'IN_CONSULTATION',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
});

const APPOINTMENT_STATUSES = Object.freeze(Object.values(APPOINTMENT_STATUS));

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

const PAYMENT_STATUSES = Object.freeze(Object.values(PAYMENT_STATUS));

const CHECK_IN_STATUS = Object.freeze({
  NOT_CHECKED_IN: 'NOT_CHECKED_IN',
  CHECKED_IN: 'CHECKED_IN',
});

const CHECK_IN_STATUSES = Object.freeze(Object.values(CHECK_IN_STATUS));

/** Statuses that still occupy the doctor's slot (drives the unique slot index). */
const SLOT_HOLDING_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.PENDING_PAYMENT,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.CHECKED_IN,
  APPOINTMENT_STATUS.WAITING,
  APPOINTMENT_STATUS.IN_CONSULTATION,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.NO_SHOW,
]);

/** Allowed appointment state machine. Used by the status transition guard. */
const APPOINTMENT_TRANSITIONS = Object.freeze({
  [APPOINTMENT_STATUS.PENDING_PAYMENT]: [
    APPOINTMENT_STATUS.CONFIRMED,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.CONFIRMED]: [
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.WAITING,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.CHECKED_IN]: [
    APPOINTMENT_STATUS.WAITING,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.WAITING]: [
    APPOINTMENT_STATUS.IN_CONSULTATION,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.IN_CONSULTATION]: [APPOINTMENT_STATUS.COMPLETED],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
  [APPOINTMENT_STATUS.NO_SHOW]: [],
});

/** Statuses a patient is allowed to cancel. */
const CANCELLABLE_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.PENDING_PAYMENT,
  APPOINTMENT_STATUS.CONFIRMED,
]);

/** Statuses that make an appointment part of the live clinic queue. */
const QUEUE_ACTIVE_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.CHECKED_IN,
  APPOINTMENT_STATUS.WAITING,
  APPOINTMENT_STATUS.IN_CONSULTATION,
]);

/** Statuses that block a patient from checking in. */
const CHECK_IN_BLOCKING_STATUSES = Object.freeze([
  APPOINTMENT_STATUS.PENDING_PAYMENT,
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.IN_CONSULTATION,
  APPOINTMENT_STATUS.NO_SHOW,
  APPOINTMENT_STATUS.WAITING,
  APPOINTMENT_STATUS.CHECKED_IN,
]);

const WEEK_DAYS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

/** Short day codes accepted in a doctor's working schedule. */
const WEEK_DAY_CODES = Object.freeze({
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sunday: 'sunday',
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
});

const PAYMENT_PROVIDER = Object.freeze({
  SIMULATED: 'simulated',
});

module.exports = {
  ROLES,
  USER_ROLES,
  TENANT_ROLES,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  CHECK_IN_STATUS,
  CHECK_IN_STATUSES,
  SLOT_HOLDING_STATUSES,
  APPOINTMENT_TRANSITIONS,
  CANCELLABLE_STATUSES,
  QUEUE_ACTIVE_STATUSES,
  CHECK_IN_BLOCKING_STATUSES,
  WEEK_DAYS,
  WEEK_DAY_CODES,
  PAYMENT_PROVIDER,
};