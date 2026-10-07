'use strict';

const { Appointment, Payment } = require('../../models');
const { APPOINTMENT_STATUS, PAYMENT_STATUS, PAYMENT_PROVIDER, ROLES } = require('../../constants');
const { getGateway, resolveSimulationFromHeader } = require('./gateway');
const { issueCheckInTicket, buildTicketResponse } = require('../checkInTicket.service');
const { idOf, assertActorMayAccess } = require('../appointment.service');
const { notFound, forbidden, conflict } = require('../../errors');
const { logInfo, logWarn } = require('../../utils/ApiResponse');

/**
 * Payment orchestration.
 *
 * Security rules enforced here:
 *  - the amount is ALWAYS `appointment.fee` (server-side snapshot of the doctor's
 *    consultation fee). Any amount sent by the client is ignored outright,
 *  - the patient must own the appointment,
 *  - the appointment must be in PENDING_PAYMENT,
 *  - the appointment status flip is a conditional atomic update, so a duplicated
 *    / concurrent pay request cannot confirm twice or mint two paid states.
 */

/** Load an appointment and assert the caller may act on it. */
const loadAppointmentForPayment = async (appointmentId, actor) => {
  const appointment = await Appointment.findById(appointmentId)
    .populate('clinic', 'name address phone')
    .populate({ path: 'doctor', select: 'user specialty consultationFee', populate: { path: 'user', select: 'name' } });

  if (!appointment) throw notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
  assertActorMayAccess(appointment, actor);

  return appointment;
};

/**
 * Pay for an appointment.
 *
 * @param {{appointmentId: string, actor: object, headers?: object, paymentMethod?: string}} input
 */
const payForAppointment = async ({ appointmentId, actor, headers, paymentMethod }) => {
  if (![ROLES.PATIENT, ROLES.ADMIN].includes(actor.role)) {
    throw forbidden('Only the patient can pay for an appointment', 'NOT_APPOINTMENT_OWNER');
  }

  const appointment = await loadAppointmentForPayment(appointmentId, actor);

  if (idOf(appointment.patient) !== actor.userId && actor.role !== ROLES.ADMIN) {
    throw forbidden('You can only pay for your own appointments', 'NOT_APPOINTMENT_OWNER');
  }
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw conflict('This appointment was cancelled', 'APPOINTMENT_CANCELLED');
  }
  if (appointment.paymentStatus === PAYMENT_STATUS.PAID) {
    throw conflict('This appointment has already been paid', 'ALREADY_PAID');
  }
  if (appointment.status !== APPOINTMENT_STATUS.PENDING_PAYMENT) {
    throw conflict(
      `Payment is only allowed for appointments awaiting payment (current status: ${appointment.status})`,
      'APPOINTMENT_NOT_PAYABLE',
    );
  }

  // Server-owned amount. `requestedAmount` (if the client sent one) is ignored on purpose.
  const amount = appointment.fee;
  const currency = appointment.currency;

  const payment = await Payment.findOneAndUpdate(
    { appointment: appointment._id, status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED] } },
    {
      $set: {
        patient: appointment.patient,
        clinic: appointment.clinic._id,
        amount,
        currency,
        status: PAYMENT_STATUS.PENDING,
        failureReason: null,
      },
      $setOnInsert: { provider: PAYMENT_PROVIDER.SIMULATED },
    },
    { upsert: true, new: true },
  );

  const gateway = getGateway();
  const simulate = resolveSimulationFromHeader(headers);

  let charge;
  try {
    charge = await gateway.createCharge({
      amount,
      currency,
      reference: appointment.bookingReference,
      simulate,
      metadata: { appointmentId: appointment._id.toString(), paymentMethod },
    });
  } catch (error) {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = 'provider_error';
    await payment.save();
    logWarn('Payment provider error', { appointmentId: appointment._id.toString(), message: error.message });
    throw conflict('The payment provider could not be reached, please try again', 'PAYMENT_PROVIDER_ERROR');
  }

  if (!charge.success) {
    payment.status = charge.status === 'PENDING' ? PAYMENT_STATUS.PENDING : PAYMENT_STATUS.FAILED;
    payment.transactionReference = charge.transactionReference;
    payment.failureReason = charge.message;
    payment.providerResponse = charge.raw;
    await payment.save();

    logWarn('Payment not completed', {
      appointmentId: appointment._id.toString(),
      bookingReference: appointment.bookingReference,
      status: payment.status,
    });

    throw conflict(charge.message || 'Payment was not completed', charge.status === 'PENDING' ? 'PAYMENT_PENDING' : 'PAYMENT_FAILED');
  }

  payment.status = PAYMENT_STATUS.PAID;
  payment.transactionReference = charge.transactionReference;
  payment.paidAt = new Date();
  payment.providerResponse = charge.raw;
  await payment.save();

  // Atomic conditional flip: only the request that actually moves the
  // appointment out of PENDING_PAYMENT is allowed to confirm it.
  const confirmed = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: APPOINTMENT_STATUS.PENDING_PAYMENT },
    {
      $set: {
        status: APPOINTMENT_STATUS.CONFIRMED,
        paymentStatus: PAYMENT_STATUS.PAID,
      },
    },
    { new: true },
  );

  if (!confirmed) {
    // Someone else confirmed it concurrently - keep the payment record consistent.
    payment.status = PAYMENT_STATUS.PAID;
    await payment.save();
    logWarn('Appointment already confirmed during payment', { appointmentId: appointment._id.toString() });
  }

  logInfo('Payment completed', {
    appointmentId: appointment._id.toString(),
    bookingReference: appointment.bookingReference,
    amount,
    currency,
    provider: gateway.name,
  });

  // Re-read with populate so the ticket carries clinic/doctor details.
  const freshAppointment = confirmed || (await loadAppointmentForPayment(appointmentId, actor));
  const ticket = await issueCheckInTicket(freshAppointment);

  return {
    payment,
    appointment: freshAppointment,
    ticket: buildTicketResponse(ticket, freshAppointment),
  };
};

/**
 * Refund a paid appointment (used by the cancellation flow and by admin).
 * Keeps the original transaction reference for auditability.
 */
const refundPayment = async ({ appointment, actor }) => {
  const payment = await Payment.findOne({
    appointment: appointment._id ?? appointment,
    status: PAYMENT_STATUS.PAID,
  }).sort({ createdAt: -1 });

  if (!payment) throw notFound('No completed payment found for this appointment', 'PAYMENT_NOT_FOUND');

  const gateway = getGateway(payment.provider);
  const result = await gateway.refund({
    amount: payment.amount,
    currency: payment.currency,
    transactionReference: payment.transactionReference,
    metadata: { appointmentId: (appointment._id ?? appointment).toString() },
  });

  if (!result.success) {
    logWarn('Refund failed', { appointmentId: payment.appointment.toString(), reason: result.message });
    throw conflict('The refund could not be processed', 'REFUND_FAILED');
  }

  payment.status = PAYMENT_STATUS.REFUNDED;
  payment.refundedAt = new Date();
  payment.refundedAmount = payment.amount;
  payment.providerResponse = { ...(payment.providerResponse || {}), refundReference: result.refundReference };
  await payment.save();

  const updated = await Appointment.findOneAndUpdate(
    { _id: payment.appointment, paymentStatus: PAYMENT_STATUS.PAID },
    { $set: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
    { new: true },
  );

  logInfo('Payment refunded', {
    appointmentId: payment.appointment.toString(),
    amount: payment.amount,
    byRole: actor?.role,
  });

  return { payment, appointment: updated };
};

/** Patient payment history. */
const listPatientPayments = async (patientId, { page = 1, limit = 20 } = {}) => {
  const query = { patient: patientId };
  const [payments, total] = await Promise.all([
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('appointment', 'bookingReference appointmentDate startTime status'),
    Payment.countDocuments(query),
  ]);

  return { payments, total };
};

module.exports = { payForAppointment, refundPayment, listPatientPayments, loadAppointmentForPayment };