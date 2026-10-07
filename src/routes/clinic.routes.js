'use strict';

const express = require('express');

const controller = require('../controllers/clinic.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireClinicScope, requireClinicTeam } = require('../middlewares/authorize.middleware');
const { listClinicsQuery, clinicIdParam } = require('../validators/doctor.validator');

const router = express.Router();

/* --------------------------------- public --------------------------------- */
router.get('/', validate({ query: listClinicsQuery }), controller.list);
router.get('/:clinicId', validate({ params: clinicIdParam }), controller.getOne);

/* ---------------------------- clinic member ------------------------------- */
router.use(authenticate, requireClinicScope);

router.get('/me/details', controller.myClinic);
router.get('/me/staff', requireClinicTeam, controller.listStaff);

module.exports = router;
