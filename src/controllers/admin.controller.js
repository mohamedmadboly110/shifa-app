'use strict';

const adminService = require('../services/admin.service');
const doctorService = require('../services/doctor.service');
const clinicService = require('../services/clinic.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, created, ok, buildPaginationMeta } = require('../utils/ApiResponse');

/* ---------------------------------- users ---------------------------------- */

const listUsers = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { users, total } = await adminService.listUsers(req.query);
  return ok(res, 'Users retrieved successfully', users, buildPaginationMeta({ page, limit, total }));
});

const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUser(req.params.id);
  return ok(res, 'User retrieved successfully', user);
});

const setUserActive = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const user = await adminService.setUserActive(req.params.id, req.body.isActive, { actor });
  return ok(res, 'User updated successfully', user);
});

/* --------------------------------- clinics --------------------------------- */

const listClinics = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { clinics, total } = await clinicService.listClinics({ ...req.query, includeInactive: true });
  return ok(res, 'Clinics retrieved successfully', clinics, buildPaginationMeta({ page, limit, total }));
});

const createClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicService.createClinic(req.body);
  return created(res, 'Clinic created successfully', clinic);
});

const updateClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicService.updateClinic(req.params.id, req.body);
  return ok(res, 'Clinic updated successfully', clinic);
});

/* --------------------------------- doctors --------------------------------- */

const listDoctors = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const { doctors, total } = await doctorService.listDoctors({ ...req.query, includeInactive: true });
  return ok(res, 'Doctors retrieved successfully', doctors, buildPaginationMeta({ page, limit, total }));
});

const createDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorService.createDoctor(req.body);
  return created(res, 'Doctor created successfully', doctor);
});

const updateDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorService.updateDoctor(req.params.id, req.body);
  return ok(res, 'Doctor updated successfully', doctor);
});

const setDoctorActive = asyncHandler(async (req, res) => {
  const doctor = await doctorService.setDoctorActive(req.params.id, req.body.isActive);
  return ok(res, 'Doctor updated successfully', doctor);
});

/* -------------------------------- clinic staff ------------------------------ */

const createStaff = asyncHandler(async (req, res) => {
  const staff = await clinicService.createStaff(req.body);
  return created(res, 'Clinic staff account created successfully', staff);
});

const updateStaff = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const staff = await clinicService.updateStaff(req.params.id, actor, req.body);
  return ok(res, 'Clinic staff updated successfully', staff);
});

/* ------------------------------- transactions ------------------------------ */

const listAppointments = asyncHandler(async (req, res) => {
  // eslint-disable-next-line global-require
  const appointmentService = require('../services/appointment.service');
  const actor = await getActorContext(req.user);
  const { page, limit, date, doctorId, patientId, status } = req.query;
  const { appointments, total } = await appointmentService.listAppointmentsForClinic(actor, {
    page,
    limit,
    date,
    doctorId,
    patientId,
    status,
  });

  return ok(res, 'Appointments retrieved successfully', appointments, buildPaginationMeta({ page, limit, total }));
});

const listPayments = asyncHandler(async (req, res) => {
  const { payments, total, page, limit, totalsByStatus } = await adminService.listPayments(req.query);
  return ok(res, 'Payments retrieved successfully', payments, {
    ...buildPaginationMeta({ page, limit, total }),
    totalsByStatus,
  });
});

const stats = asyncHandler(async (_req, res) => {
  const dashboard = await adminService.getDashboardStats();
  return ok(res, 'Platform statistics retrieved successfully', dashboard);
});

module.exports = {
  listUsers,
  getUser,
  setUserActive,
  listClinics,
  createClinic,
  updateClinic,
  listDoctors,
  createDoctor,
  updateDoctor,
  setDoctorActive,
  createStaff,
  updateStaff,
  listAppointments,
  listPayments,
  stats,
};