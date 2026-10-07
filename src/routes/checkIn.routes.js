'use strict';

const express = require('express');

const controller = require('../controllers/checkIn.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requirePatient, requireRole } = require('../middlewares/authorize.middleware');
const { checkInSchema } = require('../validators/appointment.validator');

const router = express.Router();

router.use(authenticate);

/**
 * Reception submits the scanned QR ticket.
 * Patients may also use this endpoint with their own ticket (self check-in).
 */
router.post('/', requireRole('patient', 'staff', 'admin'), validate(checkInSchema), controller.staffCheckIn);

/** Explicit patient self check-in with their own ticket. */
router.post('/self', requirePatient, validate(checkInSchema), controller.selfCheckIn);

module.exports = router;
