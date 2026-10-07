'use strict';

const express = require('express');

const controller = require('../controllers/queue.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireDoctorOrStaff, requireDoctor } = require('../middlewares/authorize.middleware');
const { appointmentIdParam } = require('../validators/common.validator');
const { queueQuery, noShowSchema } = require('../validators/appointment.validator');
const { doctorScheduleQuery } = require('../validators/doctor.validator');

const router = express.Router();

router.use(authenticate);

/** Live queue: current patient, waiting list with positions, completed list. */
router.get('/', requireDoctorOrStaff, validate({ query: queueQuery }), controller.getQueue);

/** Everything needed for "today": schedule + queue + summary. */
router.get('/today', requireDoctorOrStaff, validate({ query: queueQuery }), controller.getToday);

/** Doctor's own weekly schedule and generated slots. */
router.get('/my-schedule', requireDoctor, validate({ query: doctorScheduleQuery }), controller.mySchedule);

/** Consultation lifecycle. */
router.post('/:appointmentId/start', requireDoctorOrStaff, validate(appointmentIdParam), controller.start);
router.post('/:appointmentId/complete', requireDoctorOrStaff, validate(appointmentIdParam), controller.complete);
router.patch(
  '/:appointmentId/no-show',
  requireDoctorOrStaff,
  validate({ params: appointmentIdParam, body: noShowSchema.body }),
  controller.noShow,
);

module.exports = router;
