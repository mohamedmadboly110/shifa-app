'use strict';

const doctorService = require('../services/doctor.service');
const availabilityService = require('../services/availability.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, ok, buildPaginationMeta } = require('../utils/ApiResponse');

const listDoctors = asyncHandler(async (req, res) => {
  const { doctors, total, page, limit } = await doctorService.listDoctors(req.query);
  return ok(res, 'Doctors retrieved successfully', doctors, buildPaginationMeta({ page, limit, total }));
});

const getDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorService.getPublicDoctorProfile(req.params.doctorId);
  return ok(res, 'Doctor profile retrieved successfully', doctor);
});

const getDoctorAvailability = asyncHandler(async (req, res) => {
  const availability = await availabilityService.getDoctorAvailability(req.params.doctorId, req.query.date);
  return ok(res, 'Available slots retrieved successfully', availability);
});

const listSpecialties = asyncHandler(async (_req, res) =>
  ok(res, 'Specialties retrieved successfully', await doctorService.listSpecialties()),
);

const getMyProfile = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const doctor = await doctorService.getOwnProfile(actor.userId);
  return ok(res, 'Doctor profile retrieved successfully', doctorService.serializeDoctor(doctor, { includePrivate: true }));
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const doctor = await doctorService.updateOwnProfile(actor.userId, req.body);
  return ok(res, 'Doctor profile updated successfully', doctor);
});

const updateMySchedule = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const schedule = await doctorService.updateWorkingSchedule(actor.userId, req.body.workingSchedule);
  return ok(res, 'Working schedule updated successfully', schedule);
});

module.exports = {
  listDoctors,
  getDoctor,
  getDoctorAvailability,
  listSpecialties,
  getMyProfile,
  updateMyProfile,
  updateMySchedule,
};