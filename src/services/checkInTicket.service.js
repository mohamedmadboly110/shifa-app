'use strict';

const { Appointment } = require('../models');
const { env } = require('../config/env');
const { APPOINTMENT_STATUS, PAYMENT_STATUS } = require('../constants');
const { createCheckInToken } = require('../utils/tokens');
const { cancellationNotAllowed, conflict } = require('../errors');
const { logInfo } = require('../utils/ApiResponse');

/**
 * QR check-in tickets.
 *
 * The signed token is returned to the client and never stored: only the token id
 * (`checkInTokenId`) plus its expiry are persisted, so a database dump cannot be
 * replayed at reception and a ticket can be revoked by clearing the id.
 * This module is a leaf dependency (models + utils only) so both the payment and
 * appointment services can use it without an import cycle.
 */

const buildTicketExpiry = (appointment, ttlHours = env.CHECKIN_TOKEN_TTL_HOURS) => {
  const startOfAppointmentDay = new Date(`${appointment.appointmentDate}T00:00:00.000Z`).getTime();
  const expiresAtMs = startOfAppointmentDay + ttlHours * 3600 * 1000;
  // Never hand out an already expired ticket for a past appointment.
  return new Date(Math.max(expiresAtMs, Date.now()));
};

/** Mint a new ticket and persist its token id on the appointment. */
const issueCheckInTicket = async (appointment, { ttlHours = env.CHECKIN_TOKEN_TTL_HOURS } = {}) => {
  const expiresAt = buildTicketExpiry(appointment, ttlHours);

  const { token, tokenId } = createCheckInToken({
    appointmentId: appointment._id,
    patientId: appointment.patient?._id ?? appointment.patient,
    clinicId: appointment.clinic?._id ?? appointment.clinic,
    expiresAt,
  });

  appointment.checkInTokenId = tokenId;
  appointment.checkInTokenExpiresAt = expiresAt;
  if (appointment.isModified()) await appointment.save();

  return {
    token,
    expiresAt,
  };
};

/** Shape returned to clients (QR payload + human readable reference). */
const buildTicketResponse = (ticket, appointment) => ({
  bookingReference: appointment.bookingReference,
  appointmentId: appointment._id.toString(),
  clinic: {
    id: (appointment.clinic?._id ?? appointment.clinic)?.toString(),
    name: appointment.clinic?.name,
    address: appointment.clinic?.address,
  },
  doctor: appointment.doctor?.user?.name ?? appointment.doctorName ?? null,
  appointmentDate: appointment.appointmentDate,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
  token: ticket.token,
  expiresAt: ticket.expiresAt,
});

/** Guards before a ticket may be issued. */
const assertTicketEligible = (appointment) => {
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw cancellationNotAllowed('Cancelled appointments do not have a check-in ticket');
  }
  if (appointment.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw conflict('Complete the payment to receive a check-in ticket', 'PAYMENT_REQUIRED');
  }
};

module.exports = { issueCheckInTicket, buildTicketResponse, assertTicketEligible, buildTicketExpiry };