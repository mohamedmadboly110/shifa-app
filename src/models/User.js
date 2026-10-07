'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../constants');

/**
 * bcrypt cost factor. 12 is the production default; the test environment drops
 * to 4 because the suite creates hundreds of users and every hash costs ~2.5s
 * at 12 rounds, which would dominate the run time without testing anything real.
 */
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || (process.env.NODE_ENV === 'test' ? 4 : 12);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    // `select: false` keeps the hash out of every query result by default,
    // so it can never leak through a controller that forgets to map fields.
    password: {
      type: String,
      required: [true, 'password is required'],
      select: false,
      minlength: 8,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.PATIENT,
      index: true,
    },
    /** Tenant ownership. Required for doctor and staff accounts. */
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
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
        delete ret.password;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.index({ name: 'text', email: 'text' });

userSchema.virtual('isTenantScoped').get(function isTenantScoped() {
  return this.role === ROLES.DOCTOR || this.role === ROLES.STAFF;
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** Explicit, allow-listed projection - never send the whole document. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    clinic: this.clinic ? this.clinic.toString() : null,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);