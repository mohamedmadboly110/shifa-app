'use strict';

const { z, email, password, phone, name } = require('./common.validator');

const registerSchema = {
  body: z.object({
    name,
    email,
    password,
    phone,
  }),
};

const loginSchema = {
  body: z.object({
    email,
    // Deliberately lenient: the length/regex rules live on the model so legacy
    // accounts keep working, and we never reveal which rule failed.
    password: z.string().min(1, 'Password is required').max(128),
  }),
};

const updateProfileSchema = {
  // Every field is optional: a caller may only send `newPassword`.
  body: z
    .object({
      name: name.optional(),
      phone,
      currentPassword: z.string().max(128).optional(),
      newPassword: password.optional(),
    })
    .refine((data) => !data.newPassword || Boolean(data.currentPassword), {
      message: 'currentPassword is required when setting a new password',
      path: ['currentPassword'],
    }),
};

module.exports = { registerSchema, loginSchema, updateProfileSchema };