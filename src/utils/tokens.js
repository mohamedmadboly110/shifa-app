'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { unauthorized } = require('../errors');

/* -------------------------------------------------------------------------- */
/* Access token (JWT)                                                          */
/* -------------------------------------------------------------------------- */

const signAccessToken = ({ userId, role, clinic }) =>
  jwt.sign({ role, clinic: clinic ? clinic.toString() : undefined }, env.JWT_SECRET, {
    subject: userId.toString(),
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'shifa-api',
    audience: 'shifa-clients',
  });

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: 'shifa-api',
      audience: 'shifa-clients',
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw unauthorized('Session expired, please sign in again', 'TOKEN_EXPIRED');
    }
    throw unauthorized('Invalid authentication token', 'INVALID_TOKEN');
  }
};

/* -------------------------------------------------------------------------- */
/* Booking reference                                                           */
/* -------------------------------------------------------------------------- */

const BOOKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 ambiguity

/** Human friendly, non-sequential booking reference, e.g. "SHF-7K2QX9". */
const generateBookingReference = (prefix = 'SHF') => {
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let i = 0; i < bytes.length; i += 1) {
    suffix += BOOKING_ALPHABET[bytes[i] % BOOKING_ALPHABET.length];
  }
  return `${prefix}-${suffix}`;
};

/** Provider side transaction reference, e.g. "PAY_mbv9...". */
const generateTransactionReference = (prefix = 'PAY') =>
  `${prefix}_${crypto.randomBytes(12).toString('hex')}`;

/* -------------------------------------------------------------------------- */
/* Check-in ticket (QR payload)                                                */
/* -------------------------------------------------------------------------- */

const b64url = (input) => Buffer.from(input).toString('base64url');

const sign = (data, secret = env.checkInSecret) =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url');

const timingSafeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Build an opaque, signed check-in ticket.
 *
 * The QR payload contains **no** patient name, email, phone or diagnosis - only
 * internal identifiers plus a random token id, so a leaked screenshot cannot be
 * reverse engineered and the ticket can be revoked by clearing `checkInTokenId`.
 *
 * @param {{appointmentId: string, patientId: string, clinicId: string, expiresAt?: Date}} input
 */
const createCheckInToken = ({ appointmentId, patientId, clinicId, expiresAt }) => {
  const tokenId = crypto.randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    aid: appointmentId.toString(),
    pid: patientId.toString(),
    cid: clinicId.toString(),
    jti: tokenId,
    iat: issuedAt,
    exp: expiresAt
      ? Math.floor(new Date(expiresAt).getTime() / 1000)
      : issuedAt + env.CHECKIN_TOKEN_TTL_HOURS * 3600,
  };

  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded)}`, tokenId, expiresAt: new Date(payload.exp * 1000) };
};

/**
 * Verify a check-in ticket signature and shape.
 * Throws `unauthorized` when the ticket is tampered with, malformed or expired.
 */
const verifyCheckInToken = (token) => {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw unauthorized('Malformed check-in ticket', 'INVALID_CHECK_IN_TOKEN');
  }

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !timingSafeEqual(signature, sign(encoded))) {
    throw unauthorized('Check-in ticket signature is invalid', 'INVALID_CHECK_IN_TOKEN');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw unauthorized('Check-in ticket payload is unreadable', 'INVALID_CHECK_IN_TOKEN');
  }

  if (!payload?.aid || !payload?.pid || !payload?.cid || !payload?.jti) {
    throw unauthorized('Check-in ticket payload is incomplete', 'INVALID_CHECK_IN_TOKEN');
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw unauthorized('Check-in ticket has expired', 'CHECK_IN_TOKEN_EXPIRED');
  }

  return payload;
};

/** Random URL-safe secret used by the seeder and tests. */
const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateBookingReference,
  generateTransactionReference,
  createCheckInToken,
  verifyCheckInToken,
  randomSecret,
};