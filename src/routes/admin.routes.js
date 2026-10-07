'use strict';

const express = require('express');

const controller = require('../controllers/admin.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireAdmin } = require('../middlewares/authorize.middleware');
const { listDoctorsQuery } = require('../validators/doctor.validator');
const {
  adminListUsersQuery,
  adminListPaymentsQuery,
  createDoctorSchema,
  updateDoctorAdminSchema,
  setDoctorActiveSchema,
  createClinicSchema,
  updateClinicSchema,
  createStaffSchema,
  updateStaffSchema,
  setUserActiveSchema,
} = require('../validators/doctor.validator');
const { listClinicAppointmentsQuery } = require('../validators/appointment.validator');
const { mongoIdParam } = require('../validators/common.validator');

const router = express.Router();

// Every route below this line is admin only.
router.use(authenticate, requireAdmin);

/* -------------------------------- platform -------------------------------- */
router.get('/stats', controller.stats);

/* ---------------------------------- users --------------------------------- */
router.get('/users', validate({ query: adminListUsersQuery }), controller.listUsers);
router.get('/users/:id', validate({ params: mongoIdParam }), controller.getUser);
router.patch('/users/:id/status', validate(setUserActiveSchema), controller.setUserActive);

/* --------------------------------- clinics -------------------------------- */
router.get('/clinics', validate({ query: listDoctorsQuery }), controller.listClinics);
router.post('/clinics', validate(createClinicSchema), controller.createClinic);
router.patch('/clinics/:id', validate(updateClinicSchema), controller.updateClinic);

/* --------------------------------- doctors -------------------------------- */
router.get('/doctors', validate({ query: listDoctorsQuery }), controller.listDoctors);
router.post('/doctors', validate(createDoctorSchema), controller.createDoctor);
router.patch('/doctors/:id', validate({ ...updateDoctorAdminSchema, params: mongoIdParam }), controller.updateDoctor);
router.patch('/doctors/:id/status', validate(setDoctorActiveSchema), controller.setDoctorActive);

/* ------------------------------- clinic staff ----------------------------- */
router.post('/staff', validate(createStaffSchema), controller.createStaff);
router.patch('/staff/:id', validate(updateStaffSchema), controller.updateStaff);

/* ------------------------------ transactions ------------------------------ */
router.get('/appointments', validate({ query: listClinicAppointmentsQuery }), controller.listAppointments);
router.get('/payments', validate({ query: adminListPaymentsQuery }), controller.listPayments);

module.exports = router;
