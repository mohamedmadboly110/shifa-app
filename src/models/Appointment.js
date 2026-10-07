'use strict';

const mongoose = require('mongoose');
const {
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  CHECK_IN_STATUS,
  CHECK_IN_STATUSES,
} = require('../constants');
const { DATE_KEY_RE, TIME_RE } = require('../utils/dateTime');

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Reference is to the DoctorProfile, not the User. */
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorProfile',
      required: true,
      index: true,
    },
    /**
     * Denormalised on purpose: every queue/appointment query needs the clinic to
     * enforce tenant isolation without a second lookup.
     */
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    appointmentDate: {
      type: String,
      required: [true, 'appointmentDate is required'],
      match: [DATE_KEY_RE, 'appointmentDate must use the YYYY-MM-DD format'],
    },
    startTime: {
      type: String,
      required: true,
      match: [TIME_RE, 'startTime must use the HH:mm format'],
    },
    endTime: {
      type: String,
      required: true,
      match: [TIME_RE, 'endTime must use the HH:mm format'],
    },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: APPOINTMENT_STATUS.PENDING_PAYMENT,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: PAYMENT_STATUS.PENDING,
    },
    checkInStatus: {
      type: String,
      enum: CHECK_IN_STATUSES,
      default: CHECK_IN_STATUS.NOT_CHECKED_IN,
    },
    /** Server-side snapshot of the doctor's fee at booking time. */
    fee: {
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
    bookingReference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    /**
     * `jti` of the issued check-in ticket. Storing only the token id (not the
     * signed token) means a database dump cannot be replayed at reception.
     */
    checkInTokenId: {
      type: String,
      default: null,
    },
    checkInTokenExpiresAt: {
      type: Date,
      default: null,
    },
    /**
     * Guard for the unique slot index: `true` while the appointment occupies the
     * doctor's slot, flipped to `false` on cancellation so the slot frees up
     * while the cancelled row stays for history.
     */
    slotHeld: {
      type: Boolean,
      default: true,
    },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    checkInMethod: { type: String, enum: ['self', 'staff'], default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, trim: true, maxlength: 300, default: null },
    /** Short, non-clinical note from the patient (e.g. "follow up"). */
    patientNote: { type: String, trim: true, maxlength: 300, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.slotHeld;
        delete ret.checkInTokenId;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* -------------------------------------------------------------------------- */
/* Indexes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * CRITICAL - double booking protection.
 *
 * A partial unique index on (doctor, appointmentDate, startTime) restricted to
 * `slotHeld: true` guarantees at the storage layer that only one active
 * appointment can ever exist per doctor slot. Concurrent requests cannot both
 * win: the loser receives a Mongo E11000 duplicate key error, which the
 * booking service maps to 409 APPOINTMENT_SLOT_UNAVAILABLE.
 * Cancelled appointments set `slotHeld: false` and fall outside the index.
 */
appointmentSchema.index(
  { doctor: 1, appointmentDate: 1, startTime: 1 },
  {
    name: 'unique_active_doctor_slot',
    unique: true,
    partialFilterExpression: { slotHeld: true },
  },
);

appointmentSchema.index({ patient: 1, appointmentDate: 1 }, { name: 'patient_date' });
appointmentSchema.index({ patient: 1, status: 1, appointmentDate: -1 }, { name: 'patient_status_date' });
appointmentSchema.index({ clinic: 1, appointmentDate: 1, status: 1 }, { name: 'clinic_date_status' });
appointmentSchema.index({ doctor: 1, appointmentDate: 1, status: 1 }, { name: 'doctor_date_status' });
appointmentSchema.index({ clinic: 1, status: 1, checkedInAt: 1 }, { name: 'clinic_queue_order' });
appointmentSchema.index(
  { checkInTokenId: 1 },
  {
    name: 'unique_check_in_token_id',
    unique: true,
    // `$type: 'string'` (not $exists) so documents whose field is null (the
    // default for "no ticket issued") never collide with each other.
    partialFilterExpression: { checkInTokenId: { $type: 'string' } },
  },
);
appointmentSchema.index({ createdAt: -1 });

appointmentSchema.virtual('isCancellable').get(function isCancellable() {
  return (
    this.status === APPOINTMENT_STATUS.PENDING_PAYMENT ||
    this.status === APPOINTMENT_STATUS.CONFIRMED
  );
});

appointmentSchema.set('toObject', {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.slotHeld;
    delete ret.checkInTokenId;
    return ret;
  },
});

module.exports =
  mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);