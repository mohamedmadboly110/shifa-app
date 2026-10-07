'use strict';

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const { env } = require('./config/env');
const { httpLogger, logger } = require('./config/logger');
const routes = require('./routes');
const { notFoundHandler } = require('./middlewares/notFound.middleware');
const { errorHandler } = require('./middlewares/error.middleware');

const createApp = () => {
  const app = express();

  // Behind a load balancer / reverse proxy in production.
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  /* ----------------------------- security ------------------------------- */
  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowAllOrigins = env.CORS_ORIGIN.includes('*');
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server calls have no Origin header.
        if (!origin || allowAllOrigins || env.CORS_ORIGIN.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Simulate-Payment'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  /* ------------------------------ plumbing ------------------------------ */
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(httpLogger({ ignore: (req) => req.path === '/health' || req.path === '/api/v1/health' }));

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.isProduction ? env.RATE_LIMIT_MAX * 4 : 100000,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/health' || req.path === '/api/v1/health',
    }),
  );

  /* ------------------------------- routes ------------------------------- */
  app.use(routes);

  app.get('/', (_req, res) =>
    res.status(200).json({
      success: true,
      message: 'Shifa API - medical appointment booking and clinic check-in',
      data: { documentation: '/api/v1', health: '/health' },
    }),
  );

  /* ------------------------------- errors ------------------------------- */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

/** Translate common Mongoose errors that can escape outside a request lifecycle. */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message, stack: reason?.stack });
});

module.exports = { createApp, mongoose };
