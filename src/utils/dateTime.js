'use strict';

const { WEEK_DAYS } = require('../constants');
const { badRequest } = require('../errors');

/*
 * ---------------------------------------------------------------------------
 * Date/time conventions (MVP)
 * ---------------------------------------------------------------------------
 * All clinic times are stored as wall-clock strings and are interpreted in a
 * single frame of reference (UTC) so that the server's local timezone can never
 * shift a slot by a few hours:
 *
 *   appointmentDate : "YYYY-MM-DD"
 *   startTime/endTime: "HH:mm"
 *
 * A future iteration should add an IANA timezone to `Clinic` and convert on
 * read/write. Everything below is deliberately timezone-free so that change
 * stays contained in this module.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (value) => String(value).padStart(2, '0');

/** Is the value a syntactically valid, real calendar date key? */
const isValidDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const isValidTime = (value) => typeof value === 'string' && TIME_RE.test(value);

/** "HH:mm" -> minutes since midnight */
const toMinutes = (time) => {
  if (!isValidTime(time)) {
    throw badRequest(`Invalid time format "${time}". Expected HH:mm`, 'INVALID_TIME');
  }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** minutes since midnight -> "HH:mm" */
const fromMinutes = (totalMinutes) => {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
};

/** "YYYY-MM-DD" -> Date at UTC midnight */
const parseDateKey = (dateKey) => {
  if (!isValidDateKey(dateKey)) {
    throw badRequest(`Invalid date "${dateKey}". Expected YYYY-MM-DD`, 'INVALID_DATE');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toDateKey = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Weekday name (lowercase) for a date key, e.g. "monday". */
const getWeekDay = (dateKey) => WEEK_DAYS[parseDateKey(dateKey).getUTCDay()];

/** Combine a date key and a wall-clock time into a comparable UTC Date. */
const toDateTime = (dateKey, time) => {
  const base = parseDateKey(dateKey);
  const minutes = toMinutes(time);
  return new Date(base.getTime() + minutes * 60 * 1000);
};

/** Whole minutes between now and the given slot start (negative = in the past). */
const minutesUntil = (dateKey, time, now = new Date()) =>
  Math.floor((toDateTime(dateKey, time).getTime() - now.getTime()) / 60_000);

/** Does `[startA, endA)` overlap `[startB, endB)`? */
const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const addDays = (dateKey, days) => {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
};

const todayKey = (now = new Date()) => toDateKey(now);

/** Is the moment `minutesBefore` minutes prior to the slot start already reached? */
const isPastWindow = (dateKey, time, minutesBefore, now = new Date()) =>
  minutesUntil(dateKey, time, now) <= minutesBefore;

module.exports = {
  DATE_KEY_RE,
  TIME_RE,
  isValidDateKey,
  isValidTime,
  toMinutes,
  fromMinutes,
  parseDateKey,
  toDateKey,
  getWeekDay,
  toDateTime,
  minutesUntil,
  rangesOverlap,
  addDays,
  todayKey,
  isPastWindow,
};