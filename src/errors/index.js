'use strict';

/**
 * Base application error.
 * Every error that reaches the client is built from this class so the global
 * handler has a single, predictable shape to work with.
 */
class AppError extends Error {
  /**
   * @param {string} message    Human readable, safe to show to the client.
   * @param {number} statusCode HTTP status code.
   * @param {string} code       Stable machine readable error code.
   * @param {object} [options]
   * @param {boolean} [options.isOperational=true] Expected errors are logged as warn, not error.
   * @param {object} [options.details] Extra safe-to-expose context (e.g. field errors).
   * @param {Error}  [options.cause]  Original error, logged but never serialised.
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = options.isOperational ?? statusCode < 500;
    this.details = options.details;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      message: this.message,
      error: {
        code: this.code,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 4xx - client errors                                                         */
/* -------------------------------------------------------------------------- */

const badRequest = (message = 'Bad request', code = 'BAD_REQUEST', details) =>
  new AppError(message, 400, code, { details });

const validationError = (message = 'Validation failed', details) =>
  new AppError(message, 422, 'VALIDATION_ERROR', { details });

const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(message, 401, code);

const invalidCredentials = () =>
  new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');

const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(message, 403, code);

const notFound = (message = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(message, 404, code);

const conflict = (message = 'Resource conflict', code = 'CONFLICT', details) =>
  new AppError(message, 409, code, { details });

const unprocessable = (message = 'Request cannot be processed', code = 'UNPROCESSABLE') =>
  new AppError(message, 422, code);

/* -------------------------------------------------------------------------- */
/* Domain specific errors                                                      */
/* -------------------------------------------------------------------------- */

const slotUnavailable = () =>
  new AppError(
    'This appointment slot has just been taken. Please pick another time.',
    409,
    'APPOINTMENT_SLOT_UNAVAILABLE',
  );

const outsideWorkingHours = () =>
  new AppError('The selected time is outside the doctor working hours', 422, 'OUTSIDE_WORKING_HOURS');

const appointmentInPast = () =>
  new AppError('Appointments cannot be booked in the past', 422, 'APPOINTMENT_IN_PAST');

const doctorInactive = () => new AppError('This doctor is not accepting bookings', 422, 'DOCTOR_INACTIVE');

const appointmentConflict = () =>
  new AppError('You already have an appointment at this time', 409, 'PATIENT_APPOINTMENT_CONFLICT');

const invalidStatusTransition = (from, to) =>
  new AppError(
    `Appointment cannot move from ${from} to ${to}`,
    409,
    'INVALID_STATUS_TRANSITION',
    { details: { from, to } },
  );

const invalidCheckInToken = (message = 'The check-in ticket is invalid or has expired') =>
  new AppError(message, 401, 'INVALID_CHECK_IN_TOKEN');

const alreadyCheckedIn = () =>
  new AppError('This appointment has already been checked in', 409, 'ALREADY_CHECKED_IN');

const notEligibleForCheckIn = (message = 'This appointment is not eligible for check-in') =>
  new AppError(message, 409, 'NOT_ELIGIBLE_FOR_CHECK_IN');

const paymentRequired = (message = 'Payment must be completed before check-in') =>
  new AppError(message, 409, 'PAYMENT_REQUIRED');

const queueBusy = (message = 'Another consultation is already in progress') =>
  new AppError(message, 409, 'QUEUE_BUSY');

const cancellationNotAllowed = (message = 'This appointment can no longer be cancelled') =>
  new AppError(message, 409, 'CANCELLATION_NOT_ALLOWED');

const clinicAccessDenied = () =>
  new AppError('You do not have access to this clinic', 403, 'CLINIC_ACCESS_DENIED');

/* -------------------------------------------------------------------------- */
/* 5xx - unexpected errors                                                     */
/* -------------------------------------------------------------------------- */

const internal = (message = 'Something went wrong', cause) =>
  new AppError(message, 500, 'INTERNAL_ERROR', { isOperational: false, cause });

const databaseError = (message = 'Database error', cause) =>
  new AppError(message, 500, 'DATABASE_ERROR', { isOperational: false, cause });

module.exports = {
  AppError,
  // generic
  badRequest,
  validationError,
  unauthorized,
  invalidCredentials,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  // domain
  slotUnavailable,
  outsideWorkingHours,
  appointmentInPast,
  doctorInactive,
  appointmentConflict,
  invalidStatusTransition,
  invalidCheckInToken,
  alreadyCheckedIn,
  notEligibleForCheckIn,
  paymentRequired,
  queueBusy,
  cancellationNotAllowed,
  clinicAccessDenied,
  // unexpected
  internal,
  databaseError,
};