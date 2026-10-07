'use strict';

const express = require('express');
const { env } = require('../config/env');
const { getDatabaseState } = require('../config/database');

const router = express.Router();

const API_PREFIX = '/api/v1';

/* ------------------------------- health ---------------------------------- */
const healthHandler = (_req, res) =>
  res.status(200).json({
    success: true,
    message: 'Shifa API is running',
    data: {
      service: 'shifa-api',
      version: '1.0.0',
      environment: env.NODE_ENV,
      database: getDatabaseState(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });

router.get('/health', healthHandler);

/* --------------------------------- v1 ------------------------------------ */
router.use(`${API_PREFIX}/auth`, require('./auth.routes'));
router.use(`${API_PREFIX}/doctors`, require('./doctor.routes'));
router.use(`${API_PREFIX}/clinics`, require('./clinic.routes'));
router.use(`${API_PREFIX}/appointments`, require('./appointment.routes'));
router.use(`${API_PREFIX}/payments`, require('./payment.routes'));
router.use(`${API_PREFIX}/check-ins`, require('./checkIn.routes'));
router.use(`${API_PREFIX}/queue`, require('./queue.routes'));
router.use(`${API_PREFIX}/admin`, require('./admin.routes'));

/* ------------------------------ API index -------------------------------- */
router.get(API_PREFIX, (_req, res) =>
  res.status(200).json({
    success: true,
    message: 'Shifa API v1',
    data: {
      resources: {
        auth: `${API_PREFIX}/auth`,
        doctors: `${API_PREFIX}/doctors`,
        clinics: `${API_PREFIX}/clinics`,
        appointments: `${API_PREFIX}/appointments`,
        payments: `${API_PREFIX}/payments`,
        checkIns: `${API_PREFIX}/check-ins`,
        queue: `${API_PREFIX}/queue`,
        admin: `${API_PREFIX}/admin`,
      },
    },
  }),
);

module.exports = router;
module.exports.API_PREFIX = API_PREFIX;
