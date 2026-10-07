'use strict';

const { User, DoctorProfile, Clinic, Appointment, Payment } = require('../models');
const { ROLES, APPOINTMENT_STATUS, PAYMENT_STATUS } = require('../constants');
const { notFound, badRequest } = require('../errors');
const { todayKey } = require('../utils/dateTime');
const { logInfo } = require('../utils/ApiResponse');
const { escapeRegex } = require('./doctor.service');

/**
 * Admin / cross-tenant read operations.
 * Nothing here mutates clinic-scoped business data; that stays with each clinic.
 */

const listUsers = async ({ role, clinicId, search, isActive, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (role) filter.role = role;
  if (clinicId) filter.clinic = clinicId;
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    filter.$or = [
      { name: new RegExp(escapeRegex(search), 'i') },
      { email: new RegExp(escapeRegex(search), 'i') },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('name email phone role clinic isActive lastLoginAt createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map((user) => ({ ...user, id: user._id.toString() })),
    total,
    page,
    limit,
  };
};

const getUser = async (userId) => {
  const user = await User.findById(userId).populate('clinic', 'name address phone');
  if (!user) throw notFound('User not found', 'USER_NOT_FOUND');
  return user.toPublicJSON();
};

const setUserActive = async (userId, isActive, { actor } = {}) => {
  const user = await User.findById(userId);
  if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

  if (actor && user._id.toString() === actor.userId) {
    throw badRequest('You cannot deactivate your own account', 'SELF_DEACTIVATION');
  }

  user.isActive = isActive;
  await user.save();

  // Keep the doctor profile's booking switch in sync.
  if (user.role === ROLES.DOCTOR) {
    await DoctorProfile.updateOne({ user: user._id }, { $set: { isActive } });
  }

  logInfo('User activation changed', { userId, isActive, by: actor?.userId });
  return user.toPublicJSON();
};

const listPayments = async ({ status, clinicId, patientId, from, to, page = 1, limit = 25 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (clinicId) filter.clinic = clinicId;
  if (patientId) filter.patient = patientId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [payments, total, totals] = await Promise.all([
    Payment.find(filter)
      .populate('patient', 'name email')
      .populate('appointment', 'bookingReference appointmentDate status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
    Payment.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ]);

  return {
    payments: payments.map((payment) => ({ ...payment, id: payment._id.toString() })),
    total,
    page,
    limit,
    totalsByStatus: Object.fromEntries(totals.map((row) => [row._id, { count: row.count, amount: row.amount }])),
  };
};

/** Platform level counters for the admin landing screen. */
const getDashboardStats = async () => {
  const today = todayKey();

  const [
    usersByRole,
    clinics,
    doctorsActive,
    appointmentsToday,
    appointmentsByStatus,
    paymentsByStatus,
    revenuePaid,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Clinic.countDocuments({ isActive: true }),
    DoctorProfile.countDocuments({ isActive: true }),
    Appointment.countDocuments({ appointmentDate: today }),
    Appointment.aggregate([
      { $match: { appointmentDate: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Payment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.PAID } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  return {
    date: today,
    users: Object.fromEntries(usersByRole.map((row) => [row._id, row.count])),
    clinics,
    activeDoctors: doctorsActive,
    appointmentsToday,
    appointmentsTodayByStatus: Object.fromEntries(appointmentsByStatus.map((row) => [row._id, row.count])),
    paymentsByStatus: Object.fromEntries(paymentsByStatus.map((row) => [row._id, { count: row.count, amount: row.amount }])),
    revenue: { totalPaid: revenuePaid[0]?.total || 0, paidCount: revenuePaid[0]?.count || 0 },
    currency: process.env.DEFAULT_CURRENCY || 'EGP',
    statuses: { appointments: APPOINTMENT_STATUS, payments: PAYMENT_STATUS },
  };
};

module.exports = { listUsers, getUser, setUserActive, listPayments, getDashboardStats };