'use strict';

const { z } = require('zod');
const { isValidDateKey, isValidTime } = require('../utils/dateTime');

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                           */
/* -------------------------------------------------------------------------- */

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier')
  .describe('MongoDB ObjectId');

const dateKey = z
  .string()
  .refine(isValidDateKey, 'Must be a valid date in YYYY-MM-DD format')
  .describe('Calendar date, YYYY-MM-DD');

const timeString = z.string().refine(isValidTime, 'Must be a valid time in HH:mm format');

const email = z.string().trim().toLowerCase().email('Must be a valid email address').max(160);

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{6,20}$/, 'Must be a valid phone number')
  .max(30)
  .optional()
  .or(z.literal('').transform(() => undefined));

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const mongoIdParam = z.object({ id: objectId });

/**
 * Routes that address an appointment with a descriptive param name use this
 * instead of `mongoIdParam`, so the route, the validator and the controller all
 * agree on the same key.
 */
const appointmentIdParam = z.object({ appointmentId: objectId });

/** Sorting helper: comma separated list of `field:direction`. */
const sortList = (allowed) =>
  z
    .string()
    .trim()
    .transform((value) =>
      value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
          const [field, direction = 'asc'] = token.split(':');
          return { field: field.trim(), direction: direction === '-1' || direction === 'desc' ? -1 : 1 };
        })
        .filter((sort) => allowed.includes(sort.field)),
    )
    .refine((value) => value.length > 0, `Sort must be one of: ${allowed.join(', ')}`)
    .optional();

module.exports = {
  z,
  objectId,
  dateKey,
  timeString,
  email,
  password,
  phone,
  name,
  pagination,
  mongoIdParam,
  appointmentIdParam,
  sortList,
};