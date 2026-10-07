'use strict';

const appointmentService = require('../services/appointment.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, created, ok, buildPaginationMeta } = require('../utils/ApiResponse');

/* ------------------------------- patient side ------------------------------ */

const create = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await appointmentService.createAppointment({
    patientId: actor.userId,
    ...req.body,
  });

  return created(res, 'Appointment created successfully', appointment);
});

const listMine = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const { page, limit, status } = req.query;
  const { appointments, total } = await appointmentService.listPatientAppointments(actor.userId, {
    status,
    page,
    limit,
  });

  return ok(res, 'Appointments retrieved successfully', appointments, buildPaginationMeta({ page, limit, total }));
});

const getOne = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await appointmentService.loadAppointmentForActor(req.params.id, actor);
  return ok(res, 'Appointment retrieved successfully', appointment);
});

const getByReference = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await appointmentService.getAppointmentByReference(req.params.reference, actor);
  return ok(res, 'Appointment retrieved successfully', appointment);
});

const cancel = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await appointmentService.cancelAppointment(req.params.id, actor, req.body);
  return ok(res, 'Appointment cancelled successfully', appointment);
});

const myTicket = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const { ticket } = await appointmentService.getCheckInTicket(req.params.id, actor);
  return ok(res, 'Check-in ticket generated successfully', ticket);
});

const myStatus = asyncHandler(async (req, res) => {
  // eslint-disable-next-line global-require
  const checkInService = require('../services/checkIn.service');
  const actor = await getActorContext(req.user);
  const result = await checkInService.getCheckInStatus(req.params.id, actor);
  return ok(res, 'Appointment status retrieved successfully', result);
});

/* ------------------------------ clinic / admin ----------------------------- */

const listForClinic = asyncHandler(async (req, res) => {
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

module.exports = { create, listMine, getOne, getByReference, cancel, myTicket, myStatus, listForClinic };