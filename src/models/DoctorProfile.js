'use strict';

const mongoose = require('mongoose');
const { toMinutes, isValidTime } = require('../utils/dateTime');
const { env } = require('../config/env');

const timeRangeSchema = new mongoose.Schema(
  {
    start: {
      type: String,
      required: true,
      validate: {
        validator: isValidTime,
        message: 'Working hours must use the HH:mm format',
      },
    },
    end: {
      type: String,
      required: true,
      validate: {
        validator: isValidTime,
        message: 'Working hours must use the HH:mm format',
      },
    },
  },
  { _id: false },
);

timeRangeSchema.pre('validate', function validateOrder(next) {
  if (isValidTime(this.start) && isValidTime(this.end) && toMinutes(this.start) >= toMinutes(this.end)) {
    return next(new Error('Working hours start must be before end'));
  }
  return next();
});

const doctorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: [true, 'doctor must belong to a clinic'],
      index: true,
    },
    specialty: {
      type: String,
      required: [true, 'specialty is required'],
      trim: true,
      maxlength: 120,
      index: true,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    /** Price is owned by the backend - clients may only read it. */
    consultationFee: {
      type: Number,
      required: [true, 'consultationFee is required'],
      min: [0, 'consultationFee cannot be negative'],
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: () => env.DEFAULT_CURRENCY,
    },
    /**
     * Weekly working hours: { monday: [{ start: '09:00', end: '13:00' }], ... }
     * A doctor may work several ranges in the same day (e.g. morning + evening).
     */
    workingSchedule: {
      type: Map,
      of: [timeRangeSchema],
      default: () => new Map(),
    },
    /** Overrides SLOT_DURATION_MINUTES for this doctor. */
    slotDurationMinutes: {
      type: Number,
      min: [5, 'slotDurationMinutes must be at least 5'],
      max: [240, 'slotDurationMinutes must be at most 240'],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
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

doctorProfileSchema.index({ clinic: 1, isActive: 1 });
doctorProfileSchema.index({ specialty: 1, isActive: 1 });
doctorProfileSchema.index({ clinic: 1, specialty: 1, isActive: 1 });

/** Effective slot length for this doctor. */
doctorProfileSchema.virtual('effectiveSlotDuration').get(function effectiveSlotDuration() {
  return this.slotDurationMinutes || env.SLOT_DURATION_MINUTES;
});

/** Working hours for a weekday as a plain array of ranges. */
doctorProfileSchema.methods.rangesFor = function rangesFor(weekDay) {
  const ranges = this.workingSchedule?.get?.(weekDay);
  if (!ranges) return [];
  return ranges.map((range) => ({
    start: range.start,
    end: range.end,
    startMinutes: toMinutes(range.start),
    endMinutes: toMinutes(range.end),
  }));
};

/** Full weekly plan as a plain object (never returns the raw Mongoose Map). */
doctorProfileSchema.methods.getWorkingSchedule = function getWorkingSchedule() {
  const schedule = {};
  for (const [day, ranges] of this.workingSchedule?.entries?.() ?? []) {
    schedule[day] = ranges.map((range) => ({ start: range.start, end: range.end }));
  }
  return schedule;
};

module.exports =
  mongoose.models.DoctorProfile || mongoose.model('DoctorProfile', doctorProfileSchema);