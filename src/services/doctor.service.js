'use strict';

const mongoose = require('mongoose');
const { DoctorProfile, Clinic, User, Appointment } = require('../models');
const { ROLES, WEEK_DAYS } = require('../constants');
const { env } = require('../config/env');
const {
  notFound,
  badRequest,
  conflict,
  forbidden,
} = require('../errors');
const { toMinutes, isValidTime } = require('../utils/dateTime');
const { logInfo } = require('../utils/ApiResponse');

/* -------------------------------------------------------------------------- */
/* Serializers - a public profile never exposes private User fields.          */
/* -------------------------------------------------------------------------- */

const serializeDoctor = (doctor, { includePrivate = false } = {}) => {
  if (!doctor) return null;
  const clinic = doctor.clinic;
  const user = doctor.user;

  const base = {
    id: doctor._id.toString(),
    name: user?.name,
    specialty: doctor.specialty,
    bio: doctor.bio,
    consultationFee: doctor.consultationFee,
    currency: doctor.currency,
    slotDurationMinutes: doctor.effectiveSlotDuration || env.SLOT_DURATION_MINUTES,
    isAcceptingAppointments: Boolean(doctor.isActive),
    clinic: clinic
      ? {
          id: (clinic._id ?? clinic).toString(),
          name: clinic.name,
          address: clinic.address,
          phone: clinic.phone,
        }
      : null,
  };

  if (includePrivate) {
    base.userId = (user?._id ?? user)?.toString() ?? null;
    base.email = user?.email;
    base.phone = user?.phone;
    base.isActive = doctor.isActive;
    base.workingSchedule = doctor.getWorkingSchedule ? doctor.getWorkingSchedule() : doctor.workingSchedule;
    base.createdAt = doctor.createdAt;
    base.updatedAt = doctor.updatedAt;
  }

  return base;
};

const PUBLIC_USER_FIELDS = 'name';
const PRIVATE_USER_FIELDS = 'name email phone isActive';

/* -------------------------------------------------------------------------- */
/* Discovery (public)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Browse/search doctors.
 *
 * @param {{specialty?: string, clinicId?: string, clinicName?: string, search?: string,
 *          includeInactive?: boolean, page?: number, limit?: number, sort?: string}} query
 */
const listDoctors = async ({
  specialty,
  clinicId,
  clinicName,
  search,
  includeInactive = false,
  page = 1,
  limit = 20,
  sort = 'name',
} = {}) => {
  const filter = {};
  if (!includeInactive) filter.isActive = true;
  if (specialty) filter.specialty = new RegExp(`^${escapeRegex(specialty)}$`, 'i');
  if (clinicId && mongoose.isValidObjectId(clinicId)) filter.clinic = clinicId;

  if (clinicName) {
    const clinics = await Clinic.find({ name: new RegExp(escapeRegex(clinicName), 'i') }).select('_id').lean();
    filter.clinic = { $in: clinics.map((clinic) => clinic._id) };
  }

  // Name lives on the User document, so resolve matching doctors first.
  if (search) {
    const users = await User.find({
      role: ROLES.DOCTOR,
      name: new RegExp(escapeRegex(search), 'i'),
    })
      .select('_id')
      .lean();
    filter.user = { $in: users.map((user) => user._id) };
  }

  const sortMap = {
    name: { 'user.name': 1 },
    fee_asc: { consultationFee: 1 },
    fee_desc: { consultationFee: -1 },
    newest: { createdAt: -1 },
  };

  const [doctors, total] = await Promise.all([
    DoctorProfile.find(filter)
      .populate('user', PUBLIC_USER_FIELDS)
      .populate('clinic', 'name address phone')
      .sort(sortMap[sort] || sortMap.name)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean({ virtuals: true }),
    DoctorProfile.countDocuments(filter),
  ]);

  return {
    doctors: doctors.map((doctor) => serializeDoctor(doctor)),
    total,
    page,
    limit,
  };
};

const getDoctorById = async (doctorId, { includeInactive = false } = {}) => {
  const filter = { _id: doctorId };
  if (!includeInactive) filter.isActive = true;

  const doctor = await DoctorProfile.findOne(filter)
    .populate('user', PUBLIC_USER_FIELDS)
    .populate('clinic', 'name address phone');

  if (!doctor) throw notFound('Doctor not found', 'DOCTOR_NOT_FOUND');

  return doctor;
};

const getPublicDoctorProfile = async (doctorId, options = {}) => serializeDoctor(await getDoctorById(doctorId, options));

/** Distinct specialties for filter dropdowns. */
const listSpecialties = async () => {
  const specialties = await DoctorProfile.distinct('specialty', { isActive: true });
  return specialties.filter(Boolean).sort((a, b) => a.localeCompare(b));
};

/* -------------------------------------------------------------------------- */
/* Doctor self-service                                                         */
/* -------------------------------------------------------------------------- */

const getOwnProfile = async (userId) => {
  const doctor = await DoctorProfile.findOne({ user: userId })
    .populate('user', PRIVATE_USER_FIELDS)
    .populate('clinic', 'name address phone');
  if (!doctor) throw notFound('Doctor profile not found', 'DOCTOR_PROFILE_NOT_FOUND');
  return doctor;
};

const updateOwnProfile = async (userId, { specialty, bio, consultationFee, slotDurationMinutes }) => {
  const doctor = await getOwnProfile(userId);

  if (specialty !== undefined) doctor.specialty = specialty;
  if (bio !== undefined) doctor.bio = bio;
  if (consultationFee !== undefined) doctor.consultationFee = consultationFee;
  if (slotDurationMinutes !== undefined) doctor.slotDurationMinutes = slotDurationMinutes;

  await doctor.save();
  logInfo('Doctor updated own profile', { doctorId: doctor._id.toString() });

  return serializeDoctor(doctor, { includePrivate: true });
};

/**
 * Replace the weekly working schedule.
 * Shape: { monday: [{ start: '09:00', end: '13:00' }], ... }
 */
const updateWorkingSchedule = async (userId, schedule) => {
  const doctor = await getOwnProfile(userId);
  const normalised = normaliseSchedule(schedule);

  doctor.workingSchedule = normalised;
  await doctor.save();

  logInfo('Doctor updated working schedule', { doctorId: doctor._id.toString(), days: Object.keys(normalised).length });

  return {
    doctorId: doctor._id.toString(),
    workingSchedule: doctor.getWorkingSchedule(),
    slotDurationMinutes: doctor.effectiveSlotDuration,
  };
};

/** Validate and normalise a weekly schedule object. */
const normaliseSchedule = (schedule) => {
  if (!schedule || typeof schedule !== 'object') {
    throw badRequest('workingSchedule must be an object of days', 'INVALID_SCHEDULE');
  }

  const output = {};
  const problems = [];

  for (const [rawDay, ranges] of Object.entries(schedule)) {
    const day = rawDay.toLowerCase().trim();
    if (!WEEK_DAYS.includes(day)) {
      problems.push(`"${rawDay}" is not a valid weekday`);
      continue;
    }
    if (!Array.isArray(ranges) || ranges.length === 0) continue;

    const cleaned = [];
    for (const range of ranges) {
      if (!range || !isValidTime(range.start) || !isValidTime(range.end)) {
        problems.push(`${day}: hours must look like { start: "09:00", end: "13:00" }`);
        continue;
      }
      if (toMinutes(range.start) >= toMinutes(range.end)) {
        problems.push(`${day}: start must be before end`);
        continue;
      }
      cleaned.push({ start: range.start, end: range.end });
    }

    // Merge/validate overlaps within the same day.
    cleaned.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < cleaned.length; i += 1) {
      if (toMinutes(cleaned[i].start) < toMinutes(cleaned[i - 1].end)) {
        problems.push(`${day}: overlapping working ranges`);
        break;
      }
    }

    if (cleaned.length) output[day] = cleaned;
  }

  if (problems.length) throw badRequest(`Invalid working schedule: ${problems.join('; ')}`, 'INVALID_SCHEDULE');

  return output;
};

/* -------------------------------------------------------------------------- */
/* Doctor stats (dashboard)                                                    */
/* -------------------------------------------------------------------------- */

const getDoctorStats = async (doctorId, { from, to } = {}) => {
  const query = { doctor: doctorId, slotHeld: true };
  if (from || to) {
    query.appointmentDate = {};
    if (from) query.appointmentDate.$gte = from;
    if (to) query.appointmentDate.$lte = to;
  }

  const [grouped, total] = await Promise.all([
    Appointment.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: { $cond: ['$paid', '$fee', 0] } } } },
    ]),
    Appointment.countDocuments(query),
  ]);

  const byStatus = Object.fromEntries(grouped.map((row) => [row._id, { count: row.count, revenue: row.revenue }]));

  return { total, byStatus };
};

/* -------------------------------------------------------------------------- */
/* Admin                                                                       */
/* -------------------------------------------------------------------------- */

const createDoctor = async ({ name, email, password, phone, clinicId, specialty, bio, consultationFee, workingSchedule, currency }) => {
  const clinic = await Clinic.findById(clinicId);
  if (!clinic) throw notFound('Clinic not found', 'CLINIC_NOT_FOUND');

  const normalisedEmail = email.toLowerCase();
  if (await User.exists({ email: normalisedEmail })) {
    throw conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
  }

  const user = await User.create({
    name,
    email: normalisedEmail,
    password,
    phone,
    role: ROLES.DOCTOR,
    clinic: clinic._id,
  });

  try {
    const doctor = await DoctorProfile.create({
      user: user._id,
      clinic: clinic._id,
      specialty,
      bio,
      consultationFee,
      currency: currency || clinic && env.DEFAULT_CURRENCY,
      workingSchedule: normaliseSchedule(workingSchedule || {}),
    });

    logInfo('Doctor created by admin', { doctorId: doctor._id.toString(), clinicId: clinic._id.toString() });

    return serializeDoctor(
      await doctor.populate([{ path: 'user', select: PRIVATE_USER_FIELDS }, { path: 'clinic', select: 'name address phone' }]),
      { includePrivate: true },
    );
  } catch (error) {
    // Never leave an orphaned user behind if the profile fails.
    await User.deleteOne({ _id: user._id });
    throw error;
  }
};

const setDoctorActive = async (doctorId, isActive) => {
  const doctor = await DoctorProfile.findById(doctorId);
  if (!doctor) throw notFound('Doctor not found', 'DOCTOR_NOT_FOUND');

  doctor.isActive = isActive;
  await doctor.save();

  // Keep the account and the booking availability in sync.
  await User.updateOne({ _id: doctor.user }, { $set: { isActive } });

  logInfo('Doctor activation changed', { doctorId, isActive });
  return serializeDoctor(doctor, { includePrivate: true });
};

const updateDoctor = async (doctorId, updates) => {
  const doctor = await DoctorProfile.findById(doctorId);
  if (!doctor) throw notFound('Doctor not found', 'DOCTOR_NOT_FOUND');

  const { specialty, bio, consultationFee, workingSchedule, clinicId, currency, slotDurationMinutes } = updates;

  if (specialty !== undefined) doctor.specialty = specialty;
  if (bio !== undefined) doctor.bio = bio;
  if (consultationFee !== undefined) doctor.consultationFee = consultationFee;
  if (currency !== undefined) doctor.currency = currency;
  if (slotDurationMinutes !== undefined) doctor.slotDurationMinutes = slotDurationMinutes;
  if (workingSchedule !== undefined) doctor.workingSchedule = normaliseSchedule(workingSchedule);
  if (clinicId !== undefined) {
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) throw notFound('Clinic not found', 'CLINIC_NOT_FOUND');
    doctor.clinic = clinic._id;
    await User.updateOne({ _id: doctor.user }, { $set: { clinic: clinic._id } });
  }

  await doctor.save();
  logInfo('Doctor updated by admin', { doctorId });

  return serializeDoctor(
    await doctor.populate([{ path: 'user', select: PRIVATE_USER_FIELDS }, { path: 'clinic', select: 'name address phone' }]),
    { includePrivate: true },
  );
};

const assertDoctorOwnership = (actor, doctor) => {
  if (actor.isAdmin) return true;
  if (doctor.clinic._id?.toString() !== actor.clinicId && doctor.clinic.toString() !== actor.clinicId) {
    throw forbidden('This doctor belongs to another clinic', 'CLINIC_ACCESS_DENIED');
  }
  return true;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  serializeDoctor,
  listDoctors,
  getDoctorById,
  getPublicDoctorProfile,
  listSpecialties,
  getOwnProfile,
  updateOwnProfile,
  updateWorkingSchedule,
  normaliseSchedule,
  getDoctorStats,
  createDoctor,
  updateDoctor,
  setDoctorActive,
  assertDoctorOwnership,
  escapeRegex,
};