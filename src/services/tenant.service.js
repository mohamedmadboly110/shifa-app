'use strict';

const { User, DoctorProfile, Clinic } = require('../models');
const { ROLES } = require('../constants');
const { clinicAccessDenied, forbidden, internal } = require('../errors');
const { logger } = require('../config/logger');

/**
 * Resolves who the caller is *and* which clinic they may act on behalf of.
 *
 * Tenant scope is always derived from the authenticated user (never from the
 * request body/query), which is what makes clinic isolation enforceable.
 *
 * @returns {Promise<{user, role, userId, clinicId: string|null, doctorId: string|null, isAdmin: boolean}>}
 */
const getActorContext = async (user) => {
  if (!user) throw forbidden('Authentication required');

  const base = {
    user,
    role: user.role,
    userId: user._id.toString(),
    clinicId: user.clinic ? user.clinic.toString() : null,
    doctorId: null,
    isAdmin: user.role === ROLES.ADMIN,
  };

  if (user.role === ROLES.DOCTOR) {
    const profile = await DoctorProfile.findOne({ user: user._id }).select('clinic').lean();
    if (!profile) throw internal('Doctor profile is missing for this account');

    // Prefer the profile (source of truth) and keep them in sync if needed.
    if (!base.clinicId) base.clinicId = profile.clinic.toString();
    else if (profile.clinic.toString() !== base.clinicId) {
      logger.error('Doctor clinic mismatch between user and profile', {
        userId: base.userId,
        userClinic: base.clinicId,
        profileClinic: profile.clinic.toString(),
      });
      throw clinicAccessDenied();
    }
    base.doctorId = profile._id.toString();
  }

  if (!base.isAdmin && [ROLES.DOCTOR, ROLES.STAFF].includes(user.role) && !base.clinicId) {
    throw forbidden('Your account is not linked to a clinic yet', 'CLINIC_NOT_ASSIGNED');
  }

  return base;
};

/** Throws unless `clinicId` is inside the actor's tenant scope. */
const assertClinicAccess = (actor, clinicId) => {
  const target = clinicId?.toString?.() ?? clinicId;
  if (actor.isAdmin) return true;
  if (!target || target !== actor.clinicId) throw clinicAccessDenied();
  return true;
};

/** Clinic id filter to merge into a query: admins are unrestricted. */
const scopeFilter = (actor) => (actor.isAdmin ? {} : { clinic: actor.clinicId });

const getClinicOrFail = async (clinicId, { includeInactive = false } = {}) => {
  const query = { _id: clinicId };
  if (!includeInactive) query.isActive = true;
  const clinic = await Clinic.findOne(query);
  return clinic;
};

module.exports = { getActorContext, assertClinicAccess, scopeFilter, getClinicOrFail };