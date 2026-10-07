'use strict';

const mongoose = require('mongoose');
const { ZodError } = require('zod');
const { AppError, validationError, badRequest, conflict, notFound, unauthorized } = require('../errors');
const { env } = require('../config/env');
const { logger } = require('../config/logger');

/** Duplicate-key detection for the doctor slot guard. */
const DUPLICATE_SLOT_INDEXES = ['unique_active_doctor_slot'];

/**
 * Translate a driver/framework error into an AppError.
 * Anything unrecognised becomes an opaque 500 so internals never leak.
 */
const normalizeError = (err) => {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return validationError(
      'Invalid request',
      err.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((issue) => ({
      field: issue.path,
      message: issue.message,
      code: issue.kind,
    }));
    return validationError('The submitted data is not valid', details);
  }

  if (err instanceof mongoose.Error.CastError) {
    return badRequest(`Invalid value for "${err.path}"`, 'INVALID_IDENTIFIER');
  }

  if (err instanceof mongoose.Error.DocumentNotFoundError) {
    return notFound('Resource not found', 'NOT_FOUND');
  }

  if (err?.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    if (fields.some((field) => DUPLICATE_SLOT_INDEXES.includes(field))) {
      return conflict('This appointment slot has just been taken', 'APPOINTMENT_SLOT_UNAVAILABLE');
    }
    if (fields.includes('email')) {
      return conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
    }
    if (fields.includes('bookingReference')) {
      return conflict('Booking reference collision, please retry', 'BOOKING_REFERENCE_COLLISION');
    }
    return conflict('A record with these values already exists', 'DUPLICATE_KEY', { fields });
  }

  if (err?.name === 'JsonWebTokenError') return unauthorized('Invalid authentication token', 'INVALID_TOKEN');
  if (err?.name === 'TokenExpiredError') return unauthorized('Session expired', 'TOKEN_EXPIRED');

  // body-parser failures
  if (err?.type === 'entity.parse.failed') return badRequest('Request body is not valid JSON', 'INVALID_JSON');
  if (err?.type === 'entity.too.large') {
    const error = badRequest('Request body is too large', 'PAYLOAD_TOO_LARGE');
    error.statusCode = 413;
    return error;
  }

  const error = new AppError('An unexpected error occurred', 500, 'INTERNAL_ERROR', {
    isOperational: false,
    cause: err,
  });
  return error;
};

/**
 * Centralised error middleware. Must be registered last.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  const error = normalizeError(err);

  const logPayload = {
    error: err?.message,
    code: error.code,
    statusCode: error.statusCode,
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
    userId: req.user?.id,
    role: req.user?.role,
    stack: err?.stack,
    cause: error.cause?.message,
  };

  if (error.statusCode >= 500) logger.error('Request failed', logPayload);
  else logger.warn('Request rejected', logPayload);

  const body = error.toJSON();
  body.meta = { requestId: req.id };

  if (!env.isProduction && (error.statusCode >= 500 || process.env.EXPOSE_STACK === 'true')) {
    body.error.stack = err?.stack?.split('\n').slice(0, 5);
  }

  return res.status(error.statusCode).json(body);
};

module.exports = { errorHandler, normalizeError };