'use strict';

const express = require('express');

const controller = require('../controllers/payment.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requirePatient } = require('../middlewares/authorize.middleware');
const { mongoIdParam } = require('../validators/common.validator');
const { paySchema, listPaymentsQuery } = require('../validators/appointment.validator');

const router = express.Router();

router.use(authenticate);

/** Simulated payment for an appointment the patient owns. */
router.post('/:appointmentId/pay', requirePatient, validate(paySchema), controller.pay);

/** Patient payment history. */
router.get('/mine', requirePatient, validate({ query: listPaymentsQuery }), controller.myPayments);

module.exports = router;
