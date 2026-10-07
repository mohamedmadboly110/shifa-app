'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { registerSchema, loginSchema, updateProfileSchema } = require('../validators/auth.validator');
const { env } = require('../config/env');

const router = express.Router();

/** Extra throttling on credential endpoints to slow brute-force attempts. */
const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.isProduction ? env.RATE_LIMIT_MAX : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
    error: { code: 'TOO_MANY_REQUESTS' },
  },
});

// Public
router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login', authLimiter, validate(loginSchema), controller.login);

// Authenticated
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate(updateProfileSchema), controller.updateMe);

module.exports = router;