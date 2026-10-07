'use strict';

const { Clinic, User, DoctorProfile, Appointment } = require('../models');
const { ROLES } = require('../constants');
const { notFound, conflict, forbidden, badRequest } = require('../errors');
const { logInfo } = require('../utils/ApiResponse');
const { escapeRegex } = require('./doctor.service');

/** Public clinic shape (safe to expose to any authenticated visitor). */
const serializeClinic = (clinic, { includePrivate = false, counts } = {}) => ({
  id: clinic._id.toString(),
  name: clinic.name,
  address: clinic.address,
  phone: clinic.phone,
  description: clinic.description,
  email: clinic.email,
  ...(includePrivate ? { isActive: clinic.isActive, createdAt: clinic.createdAt, updatedAt: clinic.updatedAt } : {}),
  ...(counts ? { counts } : {}),
});

const listClinics = async ({ search, includeInactive = false, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (!includeInactive) filter.isActive = true;
  if (search) filter.name = new RegExp(escapeRegex(search), 'i');

  const [clinics, total] = await Promise.all([
    Clinic.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Clinic.countDocuments(filter),
  ]);

  return { clinics: clinics.map((clinic) => serializeClinic(clinic)), total, page, limit };
};

const getClinicById = async (clinicId, { includeInactive = true } = {}) => {
  const filter = { _id: clinicId };
  if (!includeInactive) filter.isActive = true;
  const clinic = await Clinic.findOne(filter);
  if (!clinic) throw notFound('Clinic not found', 'CLINIC_NOT_FOUND');
  return clinic;
};

const getClinicSummary = async (clinicId) => {
  const [doctorCount, staffCount] = await Promise.all([
    DoctorProfile.countDocuments({ clinic: clinicId, isActive: true }),
    User.countDocuments({ clinic: clinicId, role: ROLES.STAFF, isActive: true }),
  ]);
  return { doctors: doctorCount, staff: staffCount };
};

const createClinic = async ({ name, address, phone, description, email }) => {
  const existing = await Clinic.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (existing) throw conflict('A clinic with this name already exists', 'CLINIC_NAME_TAKEN');

  const clinic = await Clinic.create({ name, address, phone, description, email });
  logInfo('Clinic created', { clinicId: clinic._id.toString() });

  return serializeClinic(clinic, { includePrivate: true });
};

const updateClinic = async (clinicId, updates) => {
  const clinic = await getClinicById(clinicId);

  ['name', 'address', 'phone', 'description', 'email', 'isActive'].forEach((field) => {
    if (updates[field] !== undefined) clinic[field] = updates[field];
  });

  await clinic.save();
  logInfo('Clinic updated', { clinicId });

  return serializeClinic(clinic, { includePrivate: true });
};

/** The clinic the authenticated staff/doctor belongs to. */
const getMyClinic = async (actor) => {
  if (!actor.clinicId) throw forbidden('Your account is not linked to a clinic', 'CLINIC_NOT_ASSIGNED');

  const clinic = await getClinicById(actor.clinicId, { includeInactive: true });
  const [summary, todayAppointments] = await Promise.all([
    getClinicSummary(actor.clinicId),
    Appointment.countDocuments({ clinic: actor.clinicId }),
  ]);

  return { clinic: serializeClinic(clinic, { includePrivate: true, counts: { ...summary, appointments: todayAppointments } }) };
};

const listClinicStaff = async (actor) => {
  if (actor.role === ROLES.DOCTOR) {
    throw forbidden('Only clinic staff and admins can list staff members', 'STAFF_LIST_FORBIDDEN');
  }

  const filter = { role: ROLES.STAFF };
  if (!actor.isAdmin) filter.clinic = actor.clinicId;

  const staff = await User.find(filter).select('name email phone isActive lastLoginAt createdAt').sort({ name: 1 }).lean();

  return staff.map((member) => ({ ...member, id: member._id.toString(), _id: undefined }));
};

/** Admin creates a clinic staff account. */
const createStaff = async ({ name, email, password, phone, clinicId }) => {
  const clinic = await getClinicById(clinicId);

  const normalisedEmail = email.toLowerCase();
  if (await User.exists({ email: normalisedEmail })) {
    throw conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
  }

  const staff = await User.create({
    name,
    email: normalisedEmail,
    password,
    phone,
    role: ROLES.STAFF,
    clinic: clinic._id,
  });

  logInfo('Clinic staff created', { staffId: staff._id.toString(), clinicId: clinic._id.toString() });

  return staff.toPublicJSON();
};

/** Admin (or the staff member) updates a staff account. */
const updateStaff = async (staffId, actor, updates) => {
  const staff = await User.findById(staffId);
  if (!staff) throw notFound('Staff account not found', 'STAFF_NOT_FOUND');
  if (staff.role !== ROLES.STAFF) throw badRequest('Target user is not clinic staff', 'NOT_STAFF');
  if (!actor.isAdmin && staff.clinic?.toString() !== actor.clinicId) {
    throw forbidden('You can only manage your own clinic staff', 'CLINIC_ACCESS_DENIED');
  }

  ['name', 'phone', 'isActive'].forEach((field) => {
    if (updates[field] !== undefined) staff[field] = updates[field];
  });

  await staff.save();
  logInfo('Clinic staff updated', { staffId, byRole: actor.role });

  return staff.toPublicJSON();
};

module.exports = {
  serializeClinic,
  listClinics,
  getClinicById,
  getClinicSummary,
  createClinic,
  updateClinic,
  getMyClinic,
  listClinicStaff,
  createStaff,
  updateStaff,
};