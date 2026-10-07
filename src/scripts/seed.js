'use strict';

/**
 * Development seed.
 *
 *   npm run seed
 *
 * Creates 1 admin, 2 clinics (tenant isolation demo), 4 doctors, 4 staff,
 * 5 patients and sample appointments covering every lifecycle state.
 * Development-only credentials are printed at the end and documented in README.md.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../config/database');const { env } = require('../config/env');
const { logger } = require('../config/logger');
const { Clinic, DoctorProfile, User, Appointment, Payment } = require('../models');
const { APPOINTMENT_STATUS, PAYMENT_STATUS, CHECK_IN_STATUS, ROLES } = require('../constants');
const { todayKey, addDays, toMinutes, fromMinutes, getWeekDay } = require('../utils/dateTime');
const { generateBookingReference, createCheckInToken, verifyCheckInToken } = require('../utils/tokens');

const DEV_PASSWORD = 'Passw0rd!23';

const FULL_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Wide opening hours so the demo always has bookable slots. */
const DEMO_SCHEDULE = FULL_WEEK.reduce((schedule, day) => {
  schedule[day] = [{ start: '08:00', end: '22:00' }];
  return schedule;
}, {});

const log = (message) => {
  // eslint-disable-next-line no-console
  console.log(message);
};

/** All slot start times a doctor offers on a date, honouring working hours. */
const slotsForDate = (schedule, dateKey, duration = 30) => {
  const ranges = schedule[getWeekDay(dateKey)] || [];
  const slots = [];
  for (const range of ranges) {
    for (let cursor = toMinutes(range.start); cursor + duration <= toMinutes(range.end); cursor += duration) {
      slots.push(fromMinutes(cursor));
    }
  }
  return slots;
};

async function wipe() {
  await Promise.all([
    User.deleteMany({}),
    Clinic.deleteMany({}),
    DoctorProfile.deleteMany({}),
    Appointment.deleteMany({}),
    Payment.deleteMany({}),
  ]);
  log('  cleared existing collections');
}

const createAppointmentAt = async ({ patient, doctor, date, time, status, paymentStatus, checkInStatus }) => {
  const startMinutes = toMinutes(time);
  const appointment = await Appointment.create({
    patient: patient._id,
    doctor: doctor._id,
    clinic: doctor.clinic,
    appointmentDate: date,
    startTime: time,
    endTime: fromMinutes(startMinutes + (doctor.slotDurationMinutes || 30)),
    status,
    paymentStatus,
    checkInStatus: checkInStatus || CHECK_IN_STATUS.NOT_CHECKED_IN,
    fee: doctor.consultationFee,
    currency: doctor.currency,
    bookingReference: generateBookingReference(),
    slotHeld: true,
    checkedInAt: checkInStatus === CHECK_IN_STATUS.CHECKED_IN ? new Date() : null,
  });

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    await Payment.create({
      appointment: appointment._id,
      patient: patient._id,
      clinic: doctor.clinic,
      amount: doctor.consultationFee,
      currency: doctor.currency,
      status: PAYMENT_STATUS.PAID,
      transactionReference: `SIMPAY_seed${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`,
      provider: 'simulated',
      paidAt: new Date(),
    });

    const { token } = createCheckInToken({
      appointmentId: appointment._id,
      patientId: patient._id,
      clinicId: doctor.clinic,
      expiresAt: new Date(`${date}T23:59:00.000Z`),
    });
    appointment.checkInTokenId = verifyCheckInToken(token).jti;
    appointment.checkInTokenExpiresAt = new Date(`${date}T23:59:00.000Z`);
    await appointment.save();
  }

  if (paymentStatus === PAYMENT_STATUS.REFUNDED) {
    await Payment.create({
      appointment: appointment._id,
      patient: patient._id,
      clinic: doctor.clinic,
      amount: doctor.consultationFee,
      currency: doctor.currency,
      status: PAYMENT_STATUS.REFUNDED,
      transactionReference: `SIMPAY_seed${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`,
      provider: 'simulated',
      paidAt: new Date(),
      refundedAt: new Date(),
      refundedAmount: doctor.consultationFee,
    });
  }

  return appointment;
};

const run = async () => {
  if (env.isProduction && env.SEED_ALLOW_NON_PRODUCTION) {
    log('Refusing to seed a production database. Set SEED_ALLOW_NON_PRODUCTION=false only if you know what you are doing.');
    process.exit(1);
  }

  await connectDatabase();
  log('Seeding Shifa database...');
  await wipe();

  /* ------------------------------- clinics ------------------------------- */
  const cairo = await Clinic.create({
    name: 'Cairo Health Hub',
    address: '15 Nasr City Street, Nasr City, Cairo',
    phone: '+20 2 2345 6789',
    email: 'info@cairohealthhub.test',
    description: 'Multi-specialty clinic focused on family and internal medicine.',
  });

  const alex = await Clinic.create({
    name: 'Alexandria Medical Center',
    address: '3 Smouha Road, Smouha, Alexandria',
    phone: '+20 3 4567 8910',
    email: 'info@alexmedcenter.test',
    description: 'Specialist centre with orthopaedics and dermatology services.',
  });

  /* -------------------------------- admin -------------------------------- */
  const admin = await User.create({
    name: 'Platform Admin',
    email: 'admin@shifa.test',
    password: DEV_PASSWORD,
    phone: '+20 100 000 0001',
    role: ROLES.ADMIN,
  });

  /* -------------------------------- staff -------------------------------- */
  const staffCairo = await User.create({
    name: 'Cairo Reception',
    email: 'staff.cairo@shifa.test',
    password: DEV_PASSWORD,
    phone: '+20 100 000 0011',
    role: ROLES.STAFF,
    clinic: cairo._id,
  });

  const staffAlex = await User.create({
    name: 'Alexandria Reception',
    email: 'staff.alex@shifa.test',
    password: DEV_PASSWORD,
    phone: '+20 100 000 0012',
    role: ROLES.STAFF,
    clinic: alex._id,
  });

  /* ------------------------------- doctors ------------------------------- */
  const doctorDefinitions = [
    {
      user: { name: 'Dr. Omar Hassan', email: 'omar.hassan@shifa.test', phone: '+20 100 000 0101' },
      clinic: cairo,
      specialty: 'Cardiology',
      bio: 'Consultant cardiologist with 14 years of experience in heart failure and preventive cardiology.',
      consultationFee: 450,
    },
    {
      user: { name: 'Dr. Mona Farouk', email: 'mona.farouk@shifa.test', phone: '+20 100 000 0102' },
      clinic: cairo,
      specialty: 'Dermatology',
      bio: 'Dermatologist and aesthetic medicine specialist.',
      consultationFee: 350,
    },
    {
      user: { name: 'Dr. Karim Adel', email: 'karim.adel@shifa.test', phone: '+20 100 000 0103' },
      clinic: alex,
      specialty: 'Orthopedics',
      bio: 'Orthopaedic surgeon focusing on sports injuries and joint replacement.',
      consultationFee: 500,
    },
    {
      user: { name: 'Dr. Salma Nour', email: 'salma.nour@shifa.test', phone: '+20 100 000 0104' },
      clinic: alex,
      specialty: 'Pediatrics',
      bio: 'Paediatrician dealing with newborn and childhood development.',
      consultationFee: 300,
    },
  ];

  const doctors = [];
  for (const definition of doctorDefinitions) {
    // eslint-disable-next-line no-await-in-loop
    const user = await User.create({
      ...definition.user,
      password: DEV_PASSWORD,
      role: ROLES.DOCTOR,
      clinic: definition.clinic._id,
    });
    // eslint-disable-next-line no-await-in-loop
    const doctor = await DoctorProfile.create({
      user: user._id,
      clinic: definition.clinic._id,
      specialty: definition.specialty,
      bio: definition.bio,
      consultationFee: definition.consultationFee,
      currency: env.DEFAULT_CURRENCY,
      workingSchedule: DEMO_SCHEDULE,
    });
    doctors.push(doctor);
  }

  /* ------------------------------ patients ------------------------------- */
  const patientDefinitions = [
    { name: 'Ahmed Patient', email: 'ahmed@patient.test', phone: '+20 111 111 0001' },
    { name: 'Nour Patient', email: 'nour@patient.test', phone: '+20 111 111 0002' },
    { name: 'Youssef Patient', email: 'youssef@patient.test', phone: '+20 111 111 0003' },
    { name: 'Mariam Patient', email: 'mariam@patient.test', phone: '+20 111 111 0004' },
    { name: 'Hassan Patient', email: 'hassan@patient.test', phone: '+20 111 111 0005' },
  ];

  const patients = [];
  for (const definition of patientDefinitions) {
    // eslint-disable-next-line no-await-in-loop
    const patient = await User.create({ ...definition, password: DEV_PASSWORD, role: ROLES.PATIENT });
    patients.push(patient);
  }

  /* ----------------------------- appointments ---------------------------- */
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const nowMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();

  const futureSlots = (doctor, dateKey) =>
    slotsForDate(DEMO_SCHEDULE, dateKey, doctor.slotDurationMinutes || 30).filter(
      (time) => dateKey > today || toMinutes(time) > nowMinutes + 120,
    );

  // Tomorrow: the full lifecycle, always safe to seed.
  const [omar, mona, karim, salma] = doctors;
  const tomorrowSlots = futureSlots(omar, tomorrow);

  await createAppointmentAt({
    patient: patients[0],
    doctor: omar,
    date: tomorrow,
    time: tomorrowSlots[2],
    status: APPOINTMENT_STATUS.CONFIRMED,
    paymentStatus: PAYMENT_STATUS.PAID,
  });

  await createAppointmentAt({
    patient: patients[1],
    doctor: omar,
    date: tomorrow,
    time: tomorrowSlots[3],
    status: APPOINTMENT_STATUS.CONFIRMED,
    paymentStatus: PAYMENT_STATUS.PAID,
  });

  await createAppointmentAt({
    patient: patients[2],
    doctor: mona,
    date: tomorrow,
    time: tomorrowSlots[1],
    status: APPOINTMENT_STATUS.PENDING_PAYMENT,
    paymentStatus: PAYMENT_STATUS.PENDING,
  });

  const cancelled = await createAppointmentAt({
    patient: patients[3],
    doctor: mona,
    date: tomorrow,
    time: tomorrowSlots[4],
    status: APPOINTMENT_STATUS.CANCELLED,
    paymentStatus: PAYMENT_STATUS.REFUNDED,
  });
  cancelled.slotHeld = false;
  cancelled.cancelledAt = new Date();
  await cancelled.save();

  await createAppointmentAt({
    patient: patients[4],
    doctor: karim,
    date: tomorrow,
    time: futureSlots(karim, tomorrow)[0],
    status: APPOINTMENT_STATUS.CONFIRMED,
    paymentStatus: PAYMENT_STATUS.PAID,
  });

  // Today: only created when there is still room in the working day.
  const todaySeeded = { count: 0 };
  for (const doctor of [omar, mona, karim]) {
    const slots = futureSlots(doctor, today);
    if (slots.length < 2) continue;

    // eslint-disable-next-line no-await-in-loop
    await createAppointmentAt({
      patient: patients[todaySeeded.count % patients.length],
      doctor,
      date: today,
      time: slots[0],
      status: APPOINTMENT_STATUS.CONFIRMED,
      paymentStatus: PAYMENT_STATUS.PAID,
    });
    todaySeeded.count += 1;

    if (slots.length > 1) {
      // eslint-disable-next-line no-await-in-loop
      await createAppointmentAt({
        patient: patients[(todaySeeded.count + 2) % patients.length],
        doctor,
        date: today,
        time: slots[1],
        status: APPOINTMENT_STATUS.CONFIRMED,
        paymentStatus: PAYMENT_STATUS.PAID,
        checkInStatus: CHECK_IN_STATUS.CHECKED_IN,
      });
      await Appointment.updateOne(
        { patient: patients[(todaySeeded.count + 2) % patients.length]._id, doctor: doctor._id, appointmentDate: today },
        { $set: { status: APPOINTMENT_STATUS.WAITING, checkedInAt: new Date(), checkInMethod: 'staff', checkedInBy: staffCairo._id } },
      );
      todaySeeded.count += 1;
    }
    break;
  }

  /* -------------------------------- report ------------------------------- */
  const counts = {
    users: await User.countDocuments(),
    clinics: await Clinic.countDocuments(),
    doctors: await DoctorProfile.countDocuments(),
    appointments: await Appointment.countDocuments(),
    payments: await Payment.countDocuments(),
  };

  log('');
  log('Seed complete.');
  log(`  ${JSON.stringify(counts)}`);
  log('');
  log('Development credentials (password for every account: ' + DEV_PASSWORD + ')');
  log('---------------------------------------------------------------------------');
  log('  ADMIN    admin@shifa.test');
  log('  DOCTOR   omar.hassan@shifa.test    (Cairo Health Hub - Cardiology)');
  log('  DOCTOR   mona.farouk@shifa.test    (Cairo Health Hub - Dermatology)');
  log('  DOCTOR   karim.adel@shifa.test     (Alexandria Medical Center - Orthopedics)');
  log('  DOCTOR   salma.nour@shifa.test     (Alexandria Medical Center - Pediatrics)');
  log('  STAFF    staff.cairo@shifa.test    (Cairo Health Hub)');
  log('  STAFF    staff.alex@shifa.test     (Alexandria Medical Center)');
  log('  PATIENT  ahmed@patient.test        (also: nour, youssef, mariam, hassan @patient.test)');
  log('---------------------------------------------------------------------------');
  log(`  Sample appointments: ${tomorrow} (all states) and ${today} (queue demo, ${todaySeeded.count} records)`);
  log('');
  log(`  Login: POST /api/v1/auth/login  { "email": "admin@shifa.test", "password": "${DEV_PASSWORD}" }`);
  log('');
}

run()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('Seed failed', { error: error.message, stack: error.stack });
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
