'use strict';

/**
 * Boots a MongoDB instance for the whole test run.
 *
 * Resolution order:
 *   1. `MONGO_TEST_URI` (or `MONGO_URI`) already set -> reuse it as-is.
 *      Handy with a container or a local mongod: `npm test` then needs no
 *      download of the mongodb-memory-server binary.
 *   2. Otherwise start a throwaway `mongodb-memory-server`.
 *
 * The chosen URI is exported so every Jest worker process connects to the same
 * server, and printed on stdout because workers do not share `process.env`.
 */
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_secret_key_that_is_at_least_32_characters_long';

  const externalUri = process.env.MONGO_TEST_URI || process.env.MONGO_URI;

  if (externalUri) {
    process.env.MONGO_URI = externalUri;
    process.env.MONGO_TEST_URI = externalUri;

    // Nothing to tear down when we do not own the server.
    globalThis.__SHIFA_MONGO__ = null;

    // eslint-disable-next-line no-console
    console.log(`\n[test] Using external MongoDB at ${externalUri}`);
    // eslint-disable-next-line no-console
    console.log(`MONGO_TEST_URI=${externalUri}`);
    return;
  }

  // eslint-disable-next-line global-require
  const { MongoMemoryServer } = require('mongodb-memory-server');

  const mongo = await MongoMemoryServer.create({
    binary: { version: process.env.MONGOMS_VERSION || '7.0.14' },
    instance: { dbName: 'shifa_test' },
  });

  const uri = mongo.getUri('shifa_test');
  process.env.MONGO_URI = uri;
  process.env.MONGO_TEST_URI = uri;

  // Consumed by globalTeardown.
  globalThis.__SHIFA_MONGO__ = mongo;

  // eslint-disable-next-line no-console
  console.log(`\n[test] MongoDB ready at ${uri}`);

  // Jest workers are separate processes, so hand the URI over on stdout.
  // eslint-disable-next-line no-console
  console.log(`MONGO_TEST_URI=${uri}`);
};