'use strict';

const { unauthorized, forbidden, badRequest } = require('../errors');
const { ROLES } = require('../constants');

/**
 * Reusable role guard.
 *
 *   router.get('/', requireRole('doctor', 'staff'), controller.list)
 *
 * Must be registered after `authenticate`.
 */
const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      throw forbidden(
        `This action requires one of the following roles: ${roles.join(', ')}`,
        'INSUFFICIENT_ROLE',
      );
    }
    return next();
  };

const requirePatient = requireRole(ROLES.PATIENT);
const requireDoctor = requireRole(ROLES.DOCTOR);
const requireStaff = requireRole(ROLES.STAFF);
const requireDoctorOrStaff = requireRole(ROLES.DOCTOR, ROLES.STAFF);
const requireAdmin = requireRole(ROLES.ADMIN);
const requireClinicTeam = requireRole(ROLES.DOCTOR, ROLES.STAFF, ROLES.ADMIN);

/**
 * Tenant guard: only doctors and staff have a clinic scope. Admin passes through
 * with `clinic = null`, which callers read as "no tenant restriction".
 */
const requireClinicScope = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (req.user.role === ROLES.ADMIN) return next();

  if (req.user.role !== ROLES.DOCTOR && req.user.role !== ROLES.STAFF) {
    throw forbidden('Clinic staff access only', 'NOT_CLINIC_MEMBER');
  }
  if (!req.user.clinic) {
    throw forbidden('Your account is not linked to a clinic yet', 'CLINIC_NOT_ASSIGNED');
  }
  return next();
};

/** Guard used by routes that expect an :id path param to be a Mongo ObjectId. */
const assertObjectId = (value, name = 'id') => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw badRequest(`Invalid ${name}`, 'INVALID_IDENTIFIER');
  }
  return value;
};

module.exports = {
  requireRole,
  requirePatient,
  requireDoctor,
  requireStaff,
  requireDoctorOrStaff,
  requireAdmin,
  requireClinicTeam,
  requireClinicScope,
  assertObjectId,
};