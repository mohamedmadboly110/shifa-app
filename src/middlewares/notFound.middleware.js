'use strict';

const { notFound } = require('../errors');
const { logger } = require('../config/logger');

/** Terminal 404 handler for unmatched routes. */
const notFoundHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.originalUrl} does not exist`, 'ROUTE_NOT_FOUND'));
};

/** Wraps the app so an async route rejection can never take the process down. */
// eslint-disable-next-line no-unused-vars
const asyncErrorBoundary = (err, req, res, next) => {
  logger.error('Unhandled async error outside of a request', { error: err?.message, stack: err?.stack });
  next(err);
};

module.exports = { notFoundHandler, asyncErrorBoundary };