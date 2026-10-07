'use strict';

const { User } = require('../models');
const { asyncHandler } = require('../utils/ApiResponse');
const { unauthorized, forbidden } = require('../errors');
const { verifyAccessToken } = require('../utils/tokens');

const extractBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
};

/**
 * Verify the JWT, load the user and attach it to `req.user`.
 * Always re-reads the user so deactivated accounts or role changes take effect
 * immediately instead of persisting until the token expires.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) throw unauthorized('Missing or malformed Authorization header', 'MISSING_TOKEN');

  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Account no longer exists', 'ACCOUNT_NOT_FOUND');
  if (!user.isActive) throw forbidden('This account has been deactivated', 'ACCOUNT_INACTIVE');

  req.user = user;
  req.auth = { tokenId: payload.jti, issuedAt: payload.iat };

  return next();
});

/** Attaches the user when a valid token is present, but never rejects. */
const optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user?.isActive) req.user = user;
  } catch {
    // Intentionally ignored: the route decides whether auth was mandatory.
  }

  return next();
});

module.exports = { authenticate, optionalAuthenticate, extractBearerToken };