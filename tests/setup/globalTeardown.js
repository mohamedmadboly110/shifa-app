'use strict';

/**
 * Stops the in-memory MongoDB instance started by globalSetup.
 */
module.exports = async () => {
  const mongo = globalThis.__SHIFA_MONGO__;
  if (mongo) {
    await mongo.stop();
    // eslint-disable-next-line no-console
    console.log('[test] MongoDB stopped');
  }
};
