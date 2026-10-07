'use strict';

const winston = require('winston');
const { env } = require('./env');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const SENSITIVE_KEYS = [
  'password',
  'token',
  'authorization',
  'secret',
  'tokenid',
  'transactionreference',
  'note',
  'bio',
];

/**
 * Deep clone that masks sensitive fields so credentials/tickets/clinical notes
 * never reach a log sink.
 */
const redactSensitive = (value, depth = 0) => {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value._id !== undefined && value.constructor?.modelName) return `[${value.constructor.modelName}]`;

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));

  const output = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactSensitive(val, depth + 1);
    }
  }
  return output;
};

const humanFormat = combine(
  colorize({ all: true }),
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf((info) => {
    const { timestamp: ts, level, message, stack, ...meta } = info;
    const rest = Object.keys(meta).length ? ` ${JSON.stringify(redactSensitive(meta))}` : '';
    return `${ts} ${level}: ${stack || message}${rest}`;
  }),
);

const jsonFormat = combine(timestamp(), errors({ stack: true }), json());

const transports = [
  new winston.transports.Console({
    format: env.isProduction ? jsonFormat : humanFormat,
    silent: env.isTest && process.env.LOG_LEVEL === undefined,
  }),
];

if (env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.File({
      filename: env.logFilePath,
      format: jsonFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  );
}

const logger = winston.createLogger({
  level: env.NODE_ENV === 'test' ? process.env.LOG_LEVEL || 'error' : env.LOG_LEVEL,
  defaultMeta: { service: 'shifa-api' },
  format: jsonFormat,
  transports,
  exitOnError: false,
});

/**
 * Minimal replacement for `express-http-logger` / `winston-http`:
 * logs one line per completed request, with headers/body never dumped and the
 * Authorization header masked.
 */
const httpLogger = (options = {}) => {
  const { ignore = () => false, level = 'http' } = options;

  return (req, res, next) => {
    if (env.NODE_ENV === 'test' && process.env.LOG_LEVEL === undefined) return next();

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      if (ignore(req)) return;

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const meta = {
        method: req.method,
        path: req.originalUrl?.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: req.id,
        userId: req.user?.id,
        role: req.user?.role,
        clinic: req.user?.clinic?.toString?.(),
      };

      if (res.statusCode >= 500) logger.error(`${req.method} ${meta.path} ${res.statusCode}`, meta);
      else if (res.statusCode >= 400) logger.warn(`${req.method} ${meta.path} ${res.statusCode}`, meta);
      else logger.log(level, `${req.method} ${meta.path} ${res.statusCode}`, meta);
    });

    return next();
  };
};

module.exports = { logger, httpLogger, redactSensitive };