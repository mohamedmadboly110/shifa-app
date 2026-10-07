'use strict';

const checkInService = require('../services/checkIn.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, ok } = require('../utils/ApiResponse');

/** Patient checks in with their own QR ticket. */
const selfCheckIn = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await checkInService.selfCheckIn({ token: req.body.token, actor });
  return ok(res, 'Checked in successfully', appointment);
});

/** Clinic staff scans the QR ticket at reception. */
const staffCheckIn = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const appointment = await checkInService.staffCheckIn({ token: req.body.token, actor });
  return ok(res, 'Patient checked in successfully', appointment);
});

module.exports = { selfCheckIn, staffCheckIn };