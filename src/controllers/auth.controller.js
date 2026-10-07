'use strict';

const authService = require('../services/auth.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, created, ok } = require('../utils/ApiResponse');

const register = asyncHandler(async (req, res) => {
  const result = await authService.registerPatient(req.body);
  return created(res, 'Account created successfully', result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  return ok(res, 'Logged in successfully', result);
});

const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user._id);
  return ok(res, 'Current user profile', profile);
});

const updateMe = asyncHandler(async (req, res) => {
  const profile = await authService.updateOwnProfile(req.user._id, req.body);
  return ok(res, 'Profile updated successfully', profile);
});

const myDoctorProfile = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const doctor = await authService.getOwnDoctorProfile(actor.userId);
  return ok(res, 'Doctor profile', doctor);
});

module.exports = { register, login, me, updateMe, myDoctorProfile };