'use strict';

const { ZodError } = require('zod');
const { validationError } = require('../errors');

const formatIssues = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));

/**
 * Zod powered request validation.
 *
 *   router.post('/', validate({ body: createSchema }), controller.create)
 *
 * Parsed output *replaces* the raw input, so controllers only ever see coerced,
 * stripped and whitelisted data (unknown keys are dropped by Zod objects).
 */
const validate = (schemas = {}) => (req, _res, next) => {
  try {
    for (const source of ['params', 'query', 'body', 'headers']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source] ?? {});
      if (!result.success) {
        const details = formatIssues(result.error);
        const summary = details
          .map((issue) => `${issue.field}: ${issue.message}`)
          .join('; ');
        throw validationError(`Invalid request ${source} - ${summary}`, details);
      }

      // Express 5 exposes `req.query` through a getter, so assign defensively.
      if (source === 'query') {
        Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true });
        try {
          req.query = result.data;
        } catch {
          /* istanbul ignore next - defensive only */
        }
      } else {
        req[source] = result.data;
      }
    }

    return next();
  } catch (error) {
    if (error instanceof ZodError) {
      return next(validationError('Invalid request', formatIssues(error)));
    }
    return next(error);
  }
};

module.exports = { validate, formatIssues };