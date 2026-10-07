'use strict';

const express = require('express');

const controller = require('../controllers/appointment.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requirePatient, requireClinicScope, requireClinicTeam } = require('../middlewares/authorize.middleware');
const { mongoIdParam } = require('../validators/common.validator');
const {
  createAppointmentSchema,
  listMyAppointmentsQuery,
  listClinicAppointmentsQuery,
  cancelAppointmentSchema,
} = require('../validators/appointment.validator');

const router = express.Router();

router.use(authenticate);

/* ------------------------------ patient scope ----------------------------- */
router.post('/', requirePatient, validate(createAppointmentSchema), controller.create);
router.get('/mine', requirePatient, validate({ query: listMyAppointmentsQuery }), controller.listMine);
router.get('/mine/:id/ticket', requirePatient, validate({ params: mongoIdParam }), controller.myTicket);
router.get('/mine/:id/status', requirePatient, validate({ params: mongoIdParam }), controller.myStatus);

/* ------------------------- clinic staff / admin view ----------------------- */
router.get(
  '/',
  requireClinicScope,
  requireClinicTeam,
  validate({ query: listClinicAppointmentsQuery }),
  controller.listForClinic,
);

/* ------------------------------ shared reads ------------------------------ */
router.get('/reference/:reference', controller.getByReference);
router.get('/:id', validate({ params: mongoIdParam }), controller.getOne);
router.patch('/:id/cancel', validate(cancelAppointmentSchema), controller.cancel);

module.exports = router;