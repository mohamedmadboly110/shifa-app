'use strict';

const { logger } = require('../config/logger');

/**
 * Uniform success envelope.
 * @param {object} res Express response.
 * @param {{message?: string, data?: any, statusCode?: number, meta?: object}} payload
 */
const sendSuccess = (res, { message = 'OK', data = null, statusCode = 200, meta } = {}) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

const created = (res, message, data, meta) =>
  sendSuccess(res, { message, data, statusCode: 201, meta });

const ok = (res, message, data, meta) => sendSuccess(res, { message, data, statusCode: 200, meta });

/** Wrap an async route handler so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Build a pagination meta object from a mongoose page result. */
const buildPaginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

const loggerMeta = (meta) => (meta ? { meta } : {});

/** Small helper so services can log with a consistent prefix. */
const logInfo = (message, meta) => logger.info(message, loggerMeta(meta));
const logWarn = (message, meta) => logger.warn(message, loggerMeta(meta));
const logError = (message, meta) => logger.error(message, loggerMeta(meta));

module.exports = {
  sendSuccess,
  created,
  ok,
  asyncHandler,
  buildPaginationMeta,
  logInfo,
  logWarn,
  logError,
};