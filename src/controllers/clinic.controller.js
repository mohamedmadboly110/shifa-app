'use strict';

const clinicService = require('../services/clinic.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, ok, buildPaginationMeta } = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { clinics, total, page, limit } = await clinicService.listClinics(req.query);
  return ok(res, 'Clinics retrieved successfully', clinics, buildPaginationMeta({ page, limit, total }));
});

const getOne = asyncHandler(async (req, res) => {
  const clinic = await clinicService.getClinicById(req.params.clinicId);
  const counts = await clinicService.getClinicSummary(clinic._id);
  return ok(res, 'Clinic retrieved successfully', clinicService.serializeClinic(clinic, { counts }));
});

const myClinic = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const result = await clinicService.getMyClinic(actor);
  return ok(res, 'Clinic retrieved successfully', result.clinic);
});

const listStaff = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const staff = await clinicService.listClinicStaff(actor);
  return ok(res, 'Clinic staff retrieved successfully', staff);
});

module.exports = { list, getOne, myClinic, listStaff };