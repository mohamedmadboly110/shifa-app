'use strict';

const {
  api,
  authHeader,
  login,
  createClinic,
  createDoctor,
  createPatient,
  createAdmin,
  bookAppointment,
  futureDate,
  futureSlotOn,
  todayKey,
  addDays,
  getWeekDay,
  FULL_WEEK,
} = require('./helpers');

/** Calendar date `daysAhead` days from today whose weekday is `weekDay`. */
const dateWithWeekday = (weekDay, startAhead = 1) => {
  let date = futureDate(startAhead);
  let guard = 0;
  while (getWeekDay(date) !== weekDay && guard < 7) {
    date = addDays(date, 1);
    guard += 1;
  }
  return date;
};

/** Cache one admin token for the suite. */
const context = { adminToken: null };

const adminHeader = async () => {
  if (!context.adminToken) {
    const admin = await createAdmin();
    ({ token: context.adminToken } = await login(admin.email));
  }
  return authHeader(context.adminToken);
};

describe('Doctor discovery and availability', () => {
  let clinic;
  let doctor;
  let patientToken;

  beforeEach(async () => {
    clinic = await createClinic({ name: 'Downtown Clinic' });
    ({ doctor } = await createDoctor(clinic, { name: 'Dr. Nada', specialty: 'Dermatology' }));
    const patient = await createPatient();
    ({ token: patientToken } = await login(patient.email));
  });

  describe('GET /api/v1/doctors', () => {
    it('lists active doctors without exposing private user data', async () => {
      const response = await api().get('/api/v1/doctors');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);

      const [entry] = response.body.data;
      expect(entry.name).toBe('Dr. Nada');
      expect(entry.specialty).toBe('Dermatology');
      expect(entry.email).toBeUndefined();
      expect(entry.phone).toBeUndefined();
      expect(entry.clinic.name).toBe('Downtown Clinic');
      expect(response.body.meta.total).toBe(1);
    });

    it('filters by specialty, clinic and free text search', async () => {
      const { doctor: otherDoctor } = await createDoctor(clinic, {
        name: 'Dr. Karim',
        specialty: 'Cardiology',
      });
      const otherClinic = await createClinic({ name: 'Alex Clinic' });
      await createDoctor(otherClinic, { name: 'Dr. Remote', specialty: 'Cardiology' });

      const bySpecialty = await api().get('/api/v1/doctors').query({ specialty: 'cardiology' });
      expect(bySpecialty.body.data).toHaveLength(2);

      const byClinic = await api().get('/api/v1/doctors').query({ clinicId: clinic._id.toString() });
      expect(byClinic.body.data).toHaveLength(2);
      byClinic.body.data.forEach((entry) => expect(entry.clinic.id).toBe(clinic._id.toString()));

      const byName = await api().get('/api/v1/doctors').query({ search: 'Nada' });
      expect(byName.body.data).toHaveLength(1);
      expect(byName.body.data[0].name).toBe('Dr. Nada');

      expect(otherDoctor._id).not.toBe(doctor._id);
    });

    it('paginates', async () => {
      await createDoctor(clinic, { name: 'Dr. Two', specialty: 'Neurology' });
      await createDoctor(clinic, { name: 'Dr. Three', specialty: 'Neurology' });

      const response = await api().get('/api/v1/doctors').query({ page: 2, limit: 2 });

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, hasPrevPage: true, hasNextPage: false });
    });

    it('hides deactivated doctors', async () => {
      await api()
        .patch(`/api/v1/admin/doctors/${doctor._id}/status`)
        .set(await adminHeader())
        .send({ isActive: false });
      const response = await api().get('/api/v1/doctors');
      expect(response.body.data).toHaveLength(0);
    });

    it('rejects an invalid pagination value', async () => {
      const response = await api().get('/api/v1/doctors').query({ limit: '999' });
      expect(response.status).toBe(422);
    });
  });

  describe('GET /api/v1/doctors/:doctorId/availability', () => {
    it('generates slots inside the working hours only', async () => {
      const date = futureDate(1);
      const response = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });

      expect(response.status).toBe(200);
      expect(response.body.data.date).toBe(date);
      expect(response.body.data.workingHours).toEqual([{ start: '08:00', end: '18:00' }]);
      // 10 hours / 30 minutes = 20 slots
      expect(response.body.data.totalSlots).toBe(20);

      const times = response.body.data.slots.map((slot) => slot.startTime);
      expect(times[0]).toBe('08:00');
      expect(times).not.toContain('07:30');
      expect(times).not.toContain('18:00');

      response.body.data.slots.forEach((slot) => {
        expect(slot.endTime > slot.startTime).toBe(true);
      });
    });

    it('supports several ranges per day and a custom slot length', async () => {
      await createDoctor(clinic, {
        name: 'Dr. Split',
        specialty: 'Neurology',
        slotDurationMinutes: 45,
        workingSchedule: {
          ...FULL_WEEK,
          tuesday: [
            { start: '09:00', end: '11:00' },
            { start: '16:00', end: '18:00' },
          ],
        },
      });

      let date = futureDate(1);
      while (getWeekDay(date) !== 'tuesday') date = addDays(date, 1);

      const doctors = await api().get('/api/v1/doctors').query({ specialty: 'Neurology' });
      const [splitDoctor] = doctors.body.data;

      const response = await api()
        .get(`/api/v1/doctors/${splitDoctor.id}/availability`)
        .query({ date });

      expect(response.body.data.workingHours).toHaveLength(2);
      expect(response.body.data.slotDurationMinutes).toBe(45);
      expect(response.body.data.slots[0].startTime).toBe('09:00');
    });

    it('removes a slot once it is booked', async () => {
      const date = futureDate(1);
      const startTime = futureSlotOn(date, 2);

      const before = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });
      expect(before.body.data.slots.map((slot) => slot.startTime)).toContain(startTime);

      await bookAppointment({ token: patientToken, doctorId: doctor._id.toString(), date, startTime });

      const after = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });

      expect(after.body.data.slots.map((slot) => slot.startTime)).not.toContain(startTime);
      expect(after.body.data.bookedSlots).toBe(1);
    });

    it('frees the slot again after cancellation', async () => {
      const date = futureDate(1);
      const startTime = futureSlotOn(date, 3);
      const bookingResponse = await bookAppointment({
        token: patientToken,
        doctorId: doctor._id.toString(),
        date,
        startTime,
      });

      await api()
        .patch(`/api/v1/appointments/${bookingResponse.body.data.id}/cancel`)
        .set(authHeader(patientToken))
        .send({ reason: 'Changed my mind' });

      const response = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });

      expect(response.body.data.slots.map((slot) => slot.startTime)).toContain(startTime);
    });

    it('never offers slots in the past', async () => {
      const date = todayKey();
      const nowMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      const minutesOfDay = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

      const response = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date });

      // Whatever is returned for today must still be bookable.
      response.body.data.slots.forEach((slot) => {
        expect(minutesOfDay(slot.startTime)).toBeGreaterThan(nowMinutes);
      });
    });

    it('returns an empty list on a non working day', async () => {
      // Give a dedicated doctor a single working day only.
      const { doctor: mondayOnly } = await createDoctor(clinic, {
        name: 'Dr. Mondays',
        specialty: 'Physiotherapy',
        workingSchedule: {
          monday: [{ start: '09:00', end: '12:00' }],
        },
      });

      let saturday = futureDate(1);
      while (getWeekDay(saturday) !== 'saturday') saturday = addDays(saturday, 1);

      const response = await api()
        .get(`/api/v1/doctors/${mondayOnly._id}/availability`)
        .query({ date: saturday });

      expect(response.status).toBe(200);
      expect(response.body.data.isWorkingDay).toBe(false);
      expect(response.body.data.slots).toHaveLength(0);
    });

    it('validates the date query parameter', async () => {
      const bad = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date: '10-10-2026' });
      expect(bad.status).toBe(422);

      const impossible = await api()
        .get(`/api/v1/doctors/${doctor._id}/availability`)
        .query({ date: '2026-02-31' });
      expect(impossible.status).toBe(422);

      const missing = await api().get(`/api/v1/doctors/${doctor._id}/availability`);
      expect(missing.status).toBe(422);
    });

    it('404s for an unknown doctor', async () => {
      const response = await api()
        .get('/api/v1/doctors/64b7f9c2e13a1c2d3e4f5a6b/availability')
        .query({ date: futureDate(1) });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });
  });

  describe('GET /api/v1/doctors/:doctorId', () => {
    it('returns the public profile with clinic info', async () => {
      const response = await api().get(`/api/v1/doctors/${doctor._id}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(doctor._id.toString());
      expect(response.body.data.clinic.name).toBe('Downtown Clinic');
      expect(response.body.data.consultationFee).toBe(400);
      expect(response.body.data.email).toBeUndefined();
    });
  });
});

