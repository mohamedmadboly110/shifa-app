'use strict';

const path = require('path');
const { z } = require('zod');

const NODE_ENV_VALUES = ['development', 'test', 'production'];

/** Comma separated list -> trimmed non empty array. */
const csvList = (fallback = []) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value.trim() === '') return fallback;
      if (value.trim() === '*') return ['*'];
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    });

const numeric = (fallback) =>
  z.coerce.number().int().min(0).default(fallback);

const booleanish = (fallback) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENV_VALUES).default('development'),
    PORT: numeric(4000),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters long'),
    JWT_EXPIRES_IN: z.string().min(1).default('1d'),
    CHECKIN_TOKEN_SECRET: z.string().optional().default(''),
    CHECKIN_TOKEN_TTL_HOURS: numeric(36),
    CORS_ORIGIN: csvList([]),
    TRUST_PROXY: numeric(0),
    SLOT_DURATION_MINUTES: numeric(30),
    BOOKING_CUTOFF_MINUTES: numeric(60),
    CANCELLATION_CUTOFF_MINUTES: numeric(60),
    DEFAULT_CURRENCY: z.string().length(3).default('EGP'),
    RATE_LIMIT_WINDOW_MS: numeric(15 * 60 * 1000),
    RATE_LIMIT_MAX: numeric(100),
    SEED_ALLOW_NON_PRODUCTION: booleanish(true),
  })
  .superRefine((value, ctx) => {
    // Weak default secrets must never reach production.
    if (value.NODE_ENV === 'production') {
      if (value.JWT_SECRET.includes('change_me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET still uses the placeholder value',
        });
      }
      if (value.CORS_ORIGIN.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN must not be "*" in production',
        });
      }
    }
  });

function parseEnv(source = process.env) {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the missing values.`,
    );
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    checkInSecret: env.CHECKIN_TOKEN_SECRET || env.JWT_SECRET,
    // Allow the seed script / tests to wipe the database it targets.
    mongoDatabaseName: (() => {
      try {
        return new URL(env.MONGO_URI.replace(/^mongodb(\+srv)?:\/\//, 'http://')).pathname.replace(
          '/',
          '',
        );
      } catch {
        return '';
      }
    })(),
    logFilePath: path.resolve(process.cwd(), env.NODE_ENV === 'test' ? 'logs' : 'logs', `${env.NODE_ENV}.log`),
  };
}

const env = parseEnv();

module.exports = { env, parseEnv, envSchema };