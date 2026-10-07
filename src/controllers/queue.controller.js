'use strict';

const queueService = require('../services/queue.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, ok } = require('../utils/ApiResponse');

/** Live queue (current patient + waiting list + completed) for a doctor or clinic. */
const getQueue = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const { doctorId, date } = req.query;
  const queue = await queueService.getQueue(actor, { doctorId, date });
  return ok(res, 'Queue retrieved successfully', queue);
});

/** Everything a doctor/staff needs for the current day: schedule + queue. */
const getToday = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const { doctorId, date } = req.query;
  const view = await queueService.getClinicDayView(actor, { doctorId, date });
  return ok(res, 'Today view retrieved successfully', view);
});

const start = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await queueService.startConsultation(req.params.appointmentId, actor);
  return ok(res, 'Consultation started successfully', appointment);
});

const complete = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await queueService.completeConsultation(req.params.appointmentId, actor);
  return ok(res, 'Consultation completed successfully', appointment);
});

const noShow = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await queueService.markNoShow(req.params.appointmentId, actor);
  return ok(res, 'Appointment marked as no show', appointment);
});

const mySchedule = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const schedule = await queueService.getDoctorSchedule(actor, req.query);
  return ok(res, 'Doctor schedule retrieved successfully', schedule);
});

module.exports = { getQueue, getToday, start, complete, noShow, mySchedule };