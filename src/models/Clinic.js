'use strict';

const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'clinic name is required'],
      trim: true,
      maxlength: 140,
    },
    address: {
      type: String,
      required: [true, 'clinic address is required'],
      trim: true,
      maxlength: 300,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
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

clinicSchema.index({ name: 1 });
clinicSchema.index({ name: 'text', address: 'text' });

module.exports = mongoose.models.Clinic || mongoose.model('Clinic', clinicSchema);