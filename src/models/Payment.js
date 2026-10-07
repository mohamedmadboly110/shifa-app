'use strict';

const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_STATUSES, PAYMENT_PROVIDER } = require('../constants');

const paymentSchema = new mongoose.Schema(
  {
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    /** Always derived from the doctor's fee - never from the request body. */
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    transactionReference: {
      type: String,
      default: null,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.SIMULATED,
    },
    /** Gateway response metadata (masked before logging). */
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

paymentSchema.index(
  { transactionReference: 1 },
  { name: 'unique_transaction_reference', unique: true, sparse: true },
);
paymentSchema.index({ appointment: 1, status: 1 }, { name: 'appointment_status' });
paymentSchema.index({ patient: 1, createdAt: -1 }, { name: 'patient_history' });
paymentSchema.index({ clinic: 1, createdAt: -1 }, { name: 'clinic_history' });

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);