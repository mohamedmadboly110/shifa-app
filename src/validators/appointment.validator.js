'use strict';

const { z, objectId, dateKey, timeString, pagination, mongoIdParam, appointmentIdParam } = require('./common.validator');
const { APPOINTMENT_STATUSES, PAYMENT_STATUSES } = require('../constants');

/* ------------------------------- appointments ------------------------------ */

const createAppointmentSchema = {
  body: z
    .object({
      doctorId: objectId.describe('DoctorProfile id'),
      date: dateKey,
      startTime: timeString,
      note: z.string().trim().max(300).optional(),
    })
    .strict(),
};

const listMyAppointmentsQuery = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  ...pagination,
});

const listClinicAppointmentsQuery = z.object({
  date: dateKey.optional(),
  doctorId: objectId.optional(),
  patientId: objectId.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  ...pagination,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const cancelAppointmentSchema = {
  params: mongoIdParam,
  body: z
    .object({
      reason: z.string().trim().max(300).optional(),
    })
    .default({}),
};

/* --------------------------------- payments -------------------------------- */

const paySchema = {
  params: appointmentIdParam,
  body: z
    .object({
      /**
       * Accepted for backwards compatibility with card forms but NEVER used:
       * the charge amount always comes from the doctor's consultation fee.
       * Stripping it here documents the intent in one place.
       */
      amount: z.never().optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      paymentMethod: z.enum(['card', 'wallet', 'cash']).default('card'),
    })
    .default({}),
};

const listPaymentsQuery = z.object({ ...pagination });

/* -------------------------------- check-ins -------------------------------- */

const checkInSchema = {
  body: z.object({
    token: z.string().trim().min(20, 'A check-in ticket is required').max(2000),
  }),
};

const checkInParams = mongoIdParam;

/* ---------------------------------- queue ---------------------------------- */

const queueQuery = z.object({
  doctorId: objectId.optional(),
  date: dateKey.optional(),
});

const queueAppointmentParams = mongoIdParam;

const noShowSchema = {
  params: mongoIdParam,
  body: z.object({ reason: z.string().trim().max(300).optional() }).default({}),
};

module.exports = {
  createAppointmentSchema,
  listMyAppointmentsQuery,
  listClinicAppointmentsQuery,
  cancelAppointmentSchema,
  paySchema,
  listPaymentsQuery,
  checkInSchema,
  checkInParams,
  queueQuery,
  queueAppointmentParams,
  noShowSchema,
  PAYMENT_STATUSES,
};