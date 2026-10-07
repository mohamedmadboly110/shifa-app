# Shifa API — Appointment Booking & Clinic Check-in

**Shifa** is an MVP REST API for a medical clinic booking flow: patients find
doctors, book and pay for appointments, receive a QR check-in ticket, and get
served through a live clinic queue. It is a backend-only service (no UI) with a
green Jest test suite, Docker support, and a ready-to-import Postman collection.

---

## 1. Overview

Shifa exposes a JSON REST API under `/api/v1` with four actor roles —
**patient**, **doctor**, **staff** (reception), and **admin** — and enforces a
few things that are easy to get wrong in an MVP:

- **Race-safe double-booking prevention** backed by a MongoDB unique partial
  index (the database, not the application, is the source of truth).
- **Server-derived pricing**: patients can never set the amount; the charge is
  always the doctor's consultation fee.
- **HMAC-signed QR check-in tickets** that carry no PII, cannot be replayed or
  forged, and are revoked the moment a newer ticket is issued.
- **Multi-tenant clinic scoping** on every query: staff and admins only ever
  see and touch their own clinic's data.

## 2. Tech stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Runtime        | Node.js ≥ 20 (JavaScript, CommonJS)               |
| Web framework  | Express 4                                           |
| Database       | MongoDB (Mongoose 8)                                |
| Validation     | Zod 3 (request params/query/body)                   |
| Auth           | JWT (`jsonwebtoken`) + bcryptjs password hashing   |
| Logging        | Winston (`winston`)                                 |
| Testing        | Jest + Supertest (integration tests against Mongo)  |
| Infra          | Docker / docker compose                              |

## 3. Features

- Patient registration, login, profile update, password change.
- Doctor directory, specialty list, weekly schedules, and free-slot availability.
- Appointment booking with slot rules, cancellation (with refund), and
  appointment status lifecycle (`PENDING_PAYMENT → CONFIRMED → WAITING →
  IN_CONSULTATION → COMPLETED`).
- Simulated payment gateway (swappable behind a small interface) with
  success / failure / timeout handling.
- QR check-in tickets (HMAC-SHA256) for self or staff-assisted check-in.
- Derived clinic queue: current patient, waiting list with positions, completed
  list, day view, and patient position lookup.
- Admin and staff management: users, clinics, doctors, appointments, payments,
  activation toggles, stats.
- Structured response envelope, centralized error handling, request ids,
  rate limiting on auth, helmet + CORS hardening, health endpoint.

### Out of scope (MVP)

Medical records, prescriptions, insurance, AI features, SMS/WhatsApp delivery,
a real payment gateway, subscriptions, multi-branch support, chat/video,
mobile/web apps, and analytics. The seams exist for most of these; they are
simply not built yet.

## 4. Project structure

```
.
├── server.js                  # Entry point (starts the HTTP server)
├── src/
│   ├── app.js                 # Express app factory (middleware, routes, errors)
│   ├── config/                # env parsing, database connection, logger
│   ├── constants/             # roles, statuses, business-rule enums + values
│   ├── controllers/           # thin HTTP layer (read params, call services)
│   ├── errors/                # AppError class + typed error factories
│   ├── middlewares/           # auth, role checks, validation, error handling
│   ├── models/                # Mongoose schemas (User, Clinic, Doctor, ...)
│   ├── routes/                # Express routers (mounted under /api/v1)
│   ├── scripts/seed.js        # development seed data + demo credentials
│   ├── services/              # business logic (appointment, payment, queue, …)
│   ├── utils/                 # date/time math, tokens, API response helpers
│   └── validators/            # Zod request schemas
├── tests/                     # Jest suites (auth, doctors, appointments, …)
│   ├── helpers/               # factories, login helper, fixtures
│   └── setup/                 # globalSetup/teardown, per-test DB cleanup
├── tests/setup/globalSetup.js # spins up Mongo for the test run
├── Dockerfile / docker-compose.yml
├── .env.example               # all configuration, documented
└── postman/                   # Shifa.postman_collection.json
```

## 5. Prerequisites

- **Node.js ≥ 20** and **npm ≥ 9**.
- **Docker** (for the containerized run and/or the MongoDB used by tests).

## 6. Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env          # then edit MONGO_URI / JWT_SECRET / CORS_ORIGIN

# 3. Start MongoDB (Docker) - host port 27018 avoids clashes with other projects
docker compose up -d mongo

# 4. Point .env at it, e.g.:
#    MONGO_URI=mongodb://127.0.0.1:27018/shifa

# 5. Run the API
npm run dev                   # or: npm start

# 6. (optional) Load demo data
npm run seed
```

## 7. Configuration reference

All settings are environment variables, parsed and validated by
`src/config/env.js`. Copy `.env.example` to `.env`.

| Variable                   | Default                          | Description                                        |
| -------------------------- | -------------------------------- | -------------------------------------------------- |
| `NODE_ENV`                 | `development`                    | `production` flips helmet/CORS/rate-limit defaults |
| `PORT`                     | `4000`                           | HTTP port                                          |
| `LOG_LEVEL`                | `debug`                          | Winston level                                      |
| `MONGO_URI`                | *(required)*                     | MongoDB connection string                          |
| `JWT_SECRET`               | *(required, ≥ 32 chars)*         | JWT signing secret                                 |
| `JWT_EXPIRES_IN`           | `1d`                             | Access-token lifetime                              |
| `CHECKIN_TOKEN_SECRET`     | falls back to `JWT_SECRET`       | HMAC key for check-in tickets                      |
| `CHECKIN_TOKEN_TTL_HOURS`  | `36`                             | Ticket validity (appointment day + grace)          |
| `CORS_ORIGIN`              | `http://localhost:3000,…`       | Comma-separated allowed origins (`*` in dev)       |
| `TRUST_PROXY`              | `0`                              | Trusted proxy hops (set behind a reverse proxy)    |
| `SLOT_DURATION_MINUTES`    | `30`                             | Default slot length                                |
| `BOOKING_CUTOFF_MINUTES`   | `60`                             | Minimum lead time to book a slot                   |
| `CANCELLATION_CUTOFF_MINUTES` | `60`                          | Minimum lead time to cancel                        |
| `DEFAULT_CURRENCY`         | `EGP`                            | Consultation fee currency                          |
| `RATE_LIMIT_WINDOW_MS`     | `900000` (15 min)                | Auth rate-limit window                             |
| `RATE_LIMIT_MAX`           | `100`                            | Requests per window per IP                         |
| `SEED_ALLOW_NON_PRODUCTION`| `true`                           | Guard for `npm run seed`                           |
| `BCRYPT_SALT_ROUNDS`       | `12` (production) / `4` (test)   | Password hashing cost                              |

## 8. Docker

```bash
# Build & run both services (requires a .env with JWT_SECRET etc.)
docker compose up --build

# Or just the database
docker compose up -d mongo

# Run the API standalone against an existing Mongo
docker build -t shifa-api .
docker run --rm -p 4000:4000 --env-file .env shifa-api
```

- MongoDB runs as `shifa-mongo` on host **127.0.0.1:27018** by design, so it
  never collides with other local databases on 27017. Data persists in the
  `shifa_mongo_data` volume; `docker compose down -v` wipes it.
- The API container reads `.env` and overrides `MONGO_URI` to the compose
  network (`mongodb://mongo:27017/shifa`).
- `server.js` retries the initial MongoDB connection, so the API container can
  start before Mongo finishes booting.

## 9. Seed data & demo credentials

```bash
npm run seed
```

Creates 2 clinics (tenant-isolation demo), 4 doctors, 1 admin, 4 staff,
5 patients, and sample appointments covering every lifecycle state
(confirmed, checked-in/waiting, in consultation, completed, cancelled, no-show
and a refunded payment). **All accounts share the password `Passw0rd!23`:**

| Role     | Email                            | Clinic / specialty                        |
| -------- | -------------------------------- | ----------------------------------------- |
| Admin    | `admin@shifa.test`               | —                                         |
| Doctor   | `omar.hassan@shifa.test`         | Cairo Health Hub — Cardiology             |
| Doctor   | `mona.farouk@shifa.test`         | Cairo Health Hub — Dermatology            |
| Doctor   | `karim.adel@shifa.test`          | Alexandria Medical Center — Orthopedics   |
| Doctor   | `salma.nour@shifa.test`          | Alexandria Medical Center — Pediatrics    |
| Staff    | `staff.cairo@shifa.test`         | Cairo Health Hub                          |
| Staff    | `staff.alex@shifa.test`          | Alexandria Medical Center                 |
| Patient  | `ahmed@patient.test` (+ 4 more)  | —                                         |

`npm run seed` refuses to run against a production `NODE_ENV` unless
`SEED_ALLOW_NON_PRODUCTION` is explicitly set.

## 10. Running tests

The suite is a set of integration tests (Jest + Supertest) that exercise the
real HTTP stack against a real MongoDB.

```bash
# Option A - containerized MongoDB (recommended, deterministic)
docker compose up -d mongo
$env:MONGO_TEST_URI="mongodb://127.0.0.1:27018/shifa_test"   # PowerShell
export MONGO_TEST_URI="mongodb://127.0.0.1:27018/shifa_test" # bash
npm test

# Option B - throwaway in-process MongoDB (auto-downloads a binary)
npm test
```

- `tests/setup/globalSetup.js` uses `MONGO_TEST_URI` (or `MONGO_URI`) when set,
  otherwise starts a `mongodb-memory-server` for the run.
- Each test file connects to `shifa_test`, rebuilds indexes (the unique
  slot-guard index is part of the contract under test), and wipes collections
  between tests.
- Run one suite: `npx jest tests/auth.test.js --runInBand`
- Coverage: `npm run test:coverage`

The suite currently passes **111 tests across 6 suites** (`auth`, `doctors`,
`appointments`, `payments`, `checkin`, `queue`).

## 11. API conventions

**Base URL:** `http://localhost:4000/api/v1`

**Response envelope** — every successful response:

```json
{ "success": true, "message": "…", "data": { } }
```

**Errors**:

```json
{
  "success": false,
  "message": "Human readable reason",
  "error": { "code": "MACHINE_READABLE_CODE" },
  "meta": { "requestId": "…" }
}
```

Common status codes: `200` OK · `201` created · `400` bad request ·
`401` unauthorized · `403` forbidden · `404` not found · `409` conflict ·
`422` validation error (Zod). Every response carries an `X-Request-Id` header;
unknown routes return a structured 404. Lists return `data` as the array plus
pagination metadata via `X-Pagination`/`meta` (`page`, `limit`, `total`,
`pages`).

**Auth** — send `Authorization: Bearer <token>` on protected routes.

## 12. Authentication & roles

| Endpoint                    | Access        | Notes                                  |
| --------------------------- | ------------- | -------------------------------------- |
| `POST /auth/register`       | public        | Creates a **patient**; role can't be set by the client |
| `POST /auth/login`          | public        | Returns `{ token, user }`; identical error for unknown user vs wrong password |
| `GET /auth/me`              | any role      | Profile                                |
| `PATCH /auth/me`            | any role      | Update name/phone; requires `currentPassword` to set `newPassword` |

Role authorization is enforced centrally by `requireDoctor`, `requirePatient`,
`requireDoctorOrStaff`, etc. JWT payload embeds the role; deactivated accounts
cannot log in. Patients own only their own data; doctors are scoped to their
clinic and their own appointments; staff scope to their clinic; admin is global.

## 13. API reference

### Doctors & clinics

| Endpoint | Access | Notes |
| -------- | ------ | ----- |
| `GET /doctors` | public | Filters: `specialty`, `clinicId`, `clinicName`, `search`, `sort` (`name\|fee_asc\|fee_desc\|newest`), `page`, `limit` |
| `GET /doctors/specialties` | public | Distinct specialties |
| `GET /doctors/:doctorId` | public | Profile incl. working schedule |
| `GET /doctors/:doctorId/availability?date=YYYY-MM-DD` | public | Free slot times for a date |
| `GET /doctors/me/profile` / `PATCH /doctors/me/profile` | doctor | Own profile (bio, fee, slot duration) |
| `PUT /doctors/me/schedule` | doctor | Replace weekly schedule (`workingSchedule` keyed by lowercase weekday) |
| `GET /clinics` · `GET /clinics/:clinicId` | public | Clinic directory |
| `GET /clinics/me/details` · `GET /clinics/me/staff` | clinic team | Own clinic info / staff list |

### Appointments

| Endpoint | Access | Notes |
| -------- | ------ | ----- |
| `POST /appointments` | patient | Body: `{ doctorId, date, startTime, note? }` — fee is server-derived |
| `GET /appointments/mine` | patient | Own appointments; filters `status`, `date` |
| `GET /appointments/mine/:id/ticket` | patient | Issue/re-issue QR check-in ticket |
| `GET /appointments/mine/:id/status` | patient | Status + queue position |
| `GET /appointments/reference/:reference` | public | Lookup by `SHF-XXXXXX` |
| `GET /appointments/:id` | owner/clinic | Detail |
| `PATCH /appointments/:id/cancel` | patient/staff/admin | Frees the slot; refunds if paid |
| `GET /appointments` | doctor/staff/admin | Clinic list; filters `date`, `doctorId`, `status` |

### Payments (simulated gateway)

| Endpoint | Access | Notes |
| -------- | ------ | ----- |
| `POST /payments/:appointmentId/pay` | patient | Body `{ paymentMethod?, currency? }`; **`amount` is rejected** |
| `GET /payments/mine` | patient | Payment history |

For test/dev, set header `X-Simulate-Payment: failure` or `timeout` to force
gateway outcomes (see §15).

### Check-in & queue

| Endpoint | Access | Notes |
| -------- | ------ | ----- |
| `POST /check-ins` | patient/staff/admin | Submit scanned ticket `{ token }` |
| `POST /check-ins/self` | patient | Self check-in with own ticket |
| `GET /queue` | doctor/staff/admin | `{ current, waiting[], completed[], stats }` |
| `GET /queue/today` | doctor/staff/admin | Schedule + queue + summary for today |
| `GET /queue/my-schedule?days=7` | doctor | Own upcoming slots |
| `POST /queue/:appointmentId/start` | doctor/staff | Start consultation (must be checked in) |
| `POST /queue/:appointmentId/complete` | doctor/staff | Complete consultation |
| `PATCH /queue/:appointmentId/no-show` | doctor/staff | Mark no-show, reason optional |

### Admin

| Endpoint | Access | Notes |
| -------- | ------ | ----- |
| `GET /admin/stats` | admin | Overview counts |
| `GET /admin/users` · `GET /admin/users/:id` · `PATCH /admin/users/:id/status` | admin | Manage users (cannot self-deactivate) |
| `GET /admin/clinics` · `POST /admin/clinics` · `PATCH /admin/clinics/:id` | admin | Manage clinics |
| `GET /admin/doctors` · `POST /admin/doctors` · `PATCH /admin/doctors/:id` · `PATCH /admin/doctors/:id/status` | admin | Manage doctors |
| `POST /admin/staff` · `PATCH /admin/staff/:id` | admin | Manage staff |
| `GET /admin/appointments` · `GET /admin/payments` | admin | Clinic-wide lists with filters |

### System

| Endpoint | Notes |
| -------- | ----- |
| `GET /health` | Service, environment, DB state, uptime |
| `GET /` | API index / resource listing |

## 14. Booking rules & double-booking protection

Every booking request is validated server-side by the slot engine:

1. The slot must be at least `BOOKING_CUTOFF_MINUTES` in the future.
2. It must fit inside the doctor's working hours for that weekday (respecting
   the doctor's `slotDurationMinutes` override).
3. The doctor must be active, and the patient active with the `patient` role.
4. The patient may hold **one consultation per doctor per day**.
5. The slot must be free — and here two layers cooperate:
   - a pre-check for friendly `409 APPOINTMENT_SLOT_UNAVAILABLE` messages, and
   - a **unique partial index** on `(doctor, appointmentDate, startTime)` where
     `slotHeld = true`. When two patients race for the same slot, MongoDB
     commits exactly one insert and the loser receives `E11000`, translated to
     the same 409 code. Cancellation flips `slotHeld` to `false`, freeing the
     slot for history-preserving re-booking.

The fee is always `doctor.consultationFee` in `doctor.currency`, read at
booking time and stored on the appointment; a client-supplied `fee`/`amount` is
rejected with 422.

## 15. Payments (simulated gateway)

`src/services/payment/gateway.js` exposes a tiny provider abstraction
(`createCharge`, `refund`) — swapping in a real PSP means adding one provider
object, no controller/service changes.

- Successful charge: creates a `PAID` payment, marks the appointment
  `CONFIRMED` / `PAID`, and returns a fresh QR check-in ticket in the response.
- `X-Simulate-Payment: failure` → `402 PAYMENT_FAILED`, the appointment stays
  payable and an explicit `FAILED` payment row is recorded.
- `X-Simulate-Payment: timeout` → gateway timeout surfaced as `504`.
- Refunds happen on cancellation of a paid appointment *before* the status
  change, so a failing gateway can never cancel a paid visit.

## 16. QR check-in & clinic queue

- **Ticket**: `createCheckInToken` signs `{ appId, patientId, clinicId, jti, iat, exp }`
  with HMAC-SHA256 (secret `CHECKIN_TOKEN_SECRET` or `JWT_SECRET`). The payload
  contains **internal ids only** — no name, email, phone, or payment data — and
  the signature is compared in constant time. Each issue stores a new `jti` on
  the appointment (`checkInTokenId`, the only ticket data persisted), so a
  screenshot cannot be reused after a newer ticket is issued, and the stored
  `jti` is unique (sparse partial index).
- **Check-in**: must happen on the appointment day (one-day grace window), the
  ticket must be valid & un-revoked, payment must be settled, and the
  appointment must be `CONFIRMED`. Admission is atomic
  (`findOneAndUpdate` with a `NOT_CHECKED_IN`+`CONFIRMED` filter), so concurrent
  scans admit exactly one patient. `CONFIRMED → WAITING` joins the queue.
- **Queue**: derived from appointments — there is no separate queue collection,
  so it cannot drift. Ordering is by `checkedInAt` (first to arrive is first
  served): `WAITING → IN_CONSULTATION → COMPLETED`. `no-show` records the reason
  and frees the slot.

## 17. Postman collection & roadmap

A complete collection is bundled at `postman/Shifa.postman_collection.json`:

1. In Postman: **File → Import** and pick the file.
2. Collection variables: set `baseUrl` (default `http://localhost:4000/api/v1`).
3. Open the **Auth** folder, run *Login* for the role you want, then use
   *Set token from login* (or copy the `token` from the response into the
   collection variable `accessToken`).
4. Run the folders in order: Auth → Doctors → Appointments → Payments →
   Check-in → Queue → Admin. A happy path is chained: register/login → list
   doctors → book → pay (you get a ticket) → check in → start/complete.

**Roadmap / natural next steps** (outside the MVP scope): real payment gateway
integration, SMS/WhatsApp ticket delivery, medical records & prescriptions,
insurance billing, multi-branch support, an admin dashboard and patient app.