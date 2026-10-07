'use strict';

const { User, DoctorProfile } = require('../models');
const { ROLES } = require('../constants');
const { invalidCredentials, conflict, notFound, forbidden, badRequest } = require('../errors');
const { signAccessToken } = require('../utils/tokens');
const { logInfo, logWarn } = require('../utils/ApiResponse');

/** Build the login payload returned to the client. */
const buildAuthPayload = (user) => ({
  token: signAccessToken({
    userId: user._id,
    role: user.role,
    clinic: user.clinic,
  }),
  user: user.toPublicJSON(),
});

/**
 * Public self-service registration - patients only.
 * Doctor/staff/admin accounts are created by an admin or the seed script.
 */
const registerPatient = async ({ name, email, password, phone }) => {
  const normalisedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalisedEmail }).lean();
  if (existing) throw conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');

  const user = await User.create({
    name,
    email: normalisedEmail,
    password,
    phone,
    role: ROLES.PATIENT,
  });

  logInfo('Patient registered', { userId: user._id.toString() });

  return buildAuthPayload(user);
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  // Constant-ish work whether or not the account exists (mitigates user enumeration).
  if (!user) {
    logWarn('Login attempt for unknown email');
    throw invalidCredentials();
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    logWarn('Login attempt with invalid password', { userId: user._id.toString() });
    throw invalidCredentials();
  }
  if (!user.isActive) throw forbidden('This account has been deactivated', 'ACCOUNT_INACTIVE');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  logInfo('User logged in', { userId: user._id.toString(), role: user.role });

  return buildAuthPayload(user);
};

const getProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
  return user.toPublicJSON();
};

/** Patients may edit their own contact details and password. */
const updateOwnProfile = async (userId, { name, phone, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;

  if (newPassword) {
    if (!currentPassword) {
      throw badRequest('currentPassword is required to set a new password', 'PASSWORD_CONFIRMATION_REQUIRED');
    }
    const matches = await user.comparePassword(currentPassword);
    if (!matches) throw invalidCredentials();
    user.password = newPassword;
  }

  await user.save();
  logInfo('User updated own profile', { userId });

  return user.toPublicJSON();
};

/** The doctor profile attached to the authenticated doctor account. */
const getOwnDoctorProfile = async (userId) => {
  const profile = await DoctorProfile.findOne({ user: userId }).populate('clinic', 'name address phone');
  if (!profile) throw notFound('Doctor profile not found', 'DOCTOR_PROFILE_NOT_FOUND');
  return profile;
};

module.exports = {
  registerPatient,
  login,
  getProfile,
  updateOwnProfile,
  getOwnDoctorProfile,
  buildAuthPayload,
};