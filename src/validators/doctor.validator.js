'use strict';

const { z, objectId, dateKey, pagination, mongoIdParam, sortList, name, email, password, phone } = require('./common.validator');

/* ---------------------------------- doctors -------------------------------- */

const listDoctorsQuery = z.object({
  specialty: z.string().trim().max(120).optional(),
  clinicId: objectId.optional(),
  clinicName: z.string().trim().max(140).optional(),
  search: z.string().trim().max(80).optional(),
  sort: z.enum(['name', 'fee_asc', 'fee_desc', 'newest']).default('name'),
  ...pagination,
});

const doctorIdParam = z.object({ doctorId: objectId });

const availabilityQuery = z.object({
  date: dateKey,
});

const timeRange = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must use HH:mm'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must use HH:mm'),
  // NOTE: no `start < end` refine here on purpose. Ordering and overlap rules are
  // enforced by the service so every schedule mishap surfaces as one consistent
  // 400 INVALID_SCHEDULE instead of a 422 validation error.
});

const workingSchedule = z
  .object({
    sunday: z.array(timeRange).optional(),
    monday: z.array(timeRange).optional(),
    tuesday: z.array(timeRange).optional(),
    wednesday: z.array(timeRange).optional(),
    thursday: z.array(timeRange).optional(),
    friday: z.array(timeRange).optional(),
    saturday: z.array(timeRange).optional(),
  })
  .refine((schedule) => Object.values(schedule).some((ranges) => Array.isArray(ranges) && ranges.length > 0), {
    message: 'Provide working hours for at least one day',
  });

const updateDoctorProfileSchema = {
  body: z
    .object({
      specialty: z.string().trim().min(2).max(120).optional(),
      bio: z.string().trim().max(2000).optional().nullable(),
      consultationFee: z.coerce.number().min(0).max(1_000_000).optional(),
      slotDurationMinutes: z.coerce.number().int().min(5).max(240).optional().nullable(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' }),
};

const updateScheduleSchema = {
  body: z.object({ workingSchedule }),
};

const doctorScheduleQuery = z.object({
  days: z.coerce.number().int().min(1).max(31).default(7),
});

/* ---------------------------------- clinics -------------------------------- */

const listClinicsQuery = z.object({
  search: z.string().trim().max(140).optional(),
  ...pagination,
});

const clinicIdParam = z.object({ clinicId: objectId });

/* --------------------------------- admin ---------------------------------- */

const adminListUsersQuery = z.object({
  role: z.enum(['patient', 'doctor', 'staff', 'admin']).optional(),
  clinicId: objectId.optional(),
  search: z.string().trim().max(120).optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  ...pagination,
});

const adminListPaymentsQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  clinicId: objectId.optional(),
  patientId: objectId.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  ...pagination,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const createDoctorSchema = {
  body: z.object({
    name,
    email,
    password,
    phone,
    clinicId: objectId,
    specialty: z.string().trim().min(2).max(120),
    bio: z.string().trim().max(2000).optional(),
    consultationFee: z.coerce.number().min(0).max(1_000_000),
    currency: z.string().length(3).toUpperCase().optional(),
    workingSchedule: workingSchedule.optional(),
  }),
};

const updateDoctorAdminSchema = {
  body: z
    .object({
      specialty: z.string().trim().min(2).max(120).optional(),
      bio: z.string().trim().max(2000).nullable().optional(),
      consultationFee: z.coerce.number().min(0).max(1_000_000).optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      slotDurationMinutes: z.coerce.number().int().min(5).max(240).nullable().optional(),
      clinicId: objectId.optional(),
      workingSchedule: workingSchedule.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' }),
};

const setDoctorActiveSchema = {
  params: mongoIdParam,
  body: z.object({ isActive: z.boolean() }),
};

const createClinicSchema = {
  body: z.object({
    name: z.string().trim().min(2).max(140),
    address: z.string().trim().min(5).max(300),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().toLowerCase().email().max(160).optional(),
    description: z.string().trim().max(1000).optional(),
  }),
};

const updateClinicSchema = {
  params: mongoIdParam,
  body: z
    .object({
      name: z.string().trim().min(2).max(140).optional(),
      address: z.string().trim().min(5).max(300).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().toLowerCase().email().max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' }),
};

const createStaffSchema = {
  body: z.object({
    name,
    email,
    password,
    phone,
    clinicId: objectId,
  }),
};

const updateStaffSchema = {
  params: mongoIdParam,
  body: z
    .object({
      name: name.optional(),
      phone,
      isActive: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' }),
};

const setUserActiveSchema = {
  params: mongoIdParam,
  body: z.object({ isActive: z.boolean() }),
};

module.exports = {
  listDoctorsQuery,
  doctorIdParam,
  availabilityQuery,
  updateDoctorProfileSchema,
  updateScheduleSchema,
  doctorScheduleQuery,
  listClinicsQuery,
  clinicIdParam,
  adminListUsersQuery,
  adminListPaymentsQuery,
  createDoctorSchema,
  updateDoctorAdminSchema,
  setDoctorActiveSchema,
  createClinicSchema,
  updateClinicSchema,
  createStaffSchema,
  updateStaffSchema,
  setUserActiveSchema,
  sortList,
};