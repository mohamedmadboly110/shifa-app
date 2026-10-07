'use strict';

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { env } = require('../../src/config/env');

/** Connect once per test file and keep the collection empty between suites. */
beforeAll(async () => {
  const uri = process.env.MONGO_TEST_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_TEST_URI is not set - globalSetup must run first');

  await connectDatabase(uri);
  // Indexes are part of the contract under test (unique doctor slot guard).
  await mongoose.syncIndexes();

  // Start from a clean slate even if a previous --forceExit run left documents
  // behind: without this, stale rows poison the first tests of a suite and the
  // whole run flakes (duplicate emails, phantom booked slots, ...).
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await disconnectDatabase();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

jest.setTimeout(30000);

// Surface unexpected logs during debugging without spamming the suite.
if (process.env.LOG_LEVEL) {
  // eslint-disable-next-line global-require
  const { logger } = require('../../src/config/logger');
  logger.level = process.env.LOG_LEVEL;
}

module.exports = { env };
