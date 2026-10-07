'use strict';

const express = require('express');

const controller = require('../controllers/doctor.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate, optionalAuthenticate } = require('../middlewares/auth.middleware');
const { requireDoctor } = require('../middlewares/authorize.middleware');
const {
  listDoctorsQuery,
  doctorIdParam,
  availabilityQuery,
  updateDoctorProfileSchema,
  updateScheduleSchema,
} = require('../validators/doctor.validator');

const router = express.Router();

/* ------------------------------ doctor self ------------------------------- */
router.get('/me/profile', authenticate, requireDoctor, controller.getMyProfile);
router.patch('/me/profile', authenticate, requireDoctor, validate(updateDoctorProfileSchema), controller.updateMyProfile);
router.put('/me/schedule', authenticate, requireDoctor, validate(updateScheduleSchema), controller.updateMySchedule);

/* ------------------------------- discovery -------------------------------- */
router.get('/', optionalAuthenticate, validate({ query: listDoctorsQuery }), controller.listDoctors);
router.get('/specialties', controller.listSpecialties);

router.get(
  '/:doctorId/availability',
  validate({ params: doctorIdParam, query: availabilityQuery }),
  controller.getDoctorAvailability,
);

router.get('/:doctorId', validate({ params: doctorIdParam }), controller.getDoctor);

module.exports = router;