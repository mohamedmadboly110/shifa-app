'use strict';

const paymentService = require('../services/payment/payment.service');
const { getActorContext } = require('../services/tenant.service');
const { asyncHandler, ok, buildPaginationMeta } = require('../utils/ApiResponse');

/**
 * Pay for an appointment.
 *
 * The request body may not contain an amount (the validator rejects it) and the
 * service ignores any amount anyway: the charge is always the doctor's
 * consultation fee captured on the appointment.
 */
const pay = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const result = await paymentService.payForAppointment({
    appointmentId: req.params.appointmentId,
    actor,
    headers: req.headers,
    paymentMethod: req.body?.paymentMethod,
  });

  return ok(res, 'Payment completed successfully', {
    payment: {
      id: result.payment._id.toString(),
      amount: result.payment.amount,
      currency: result.payment.currency,
      status: result.payment.status,
      transactionReference: result.payment.transactionReference,
      paidAt: result.payment.paidAt,
      provider: result.payment.provider,
    },
    appointment: result.appointment,
    ticket: result.ticket,
  });
});

const myPayments = asyncHandler(async (req, res) => {
  const actor = await getActorContext(req.user);
  const { page, limit } = req.query;
  const { payments, total } = await paymentService.listPatientPayments(actor.userId, { page, limit });

  return ok(res, 'Payments retrieved successfully', payments, buildPaginationMeta({ page, limit, total }));
});

module.exports = { pay, myPayments };