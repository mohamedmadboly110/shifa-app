'use strict';

require('dotenv').config();

const { env } = require('./src/config/env');
const { logger } = require('./src/config/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const { createApp } = require('./src/app');

let server;
let shuttingDown = false;

const start = async () => {
  try {
    await connectDatabase();
    logger.info('Starting Shifa API', {
      environment: env.NODE_ENV,
      port: env.PORT,
      nodeVersion: process.version,
    });

    const app = createApp();
    server = app.listen(env.PORT, () => {
      logger.info(`Shifa API listening on port ${env.PORT} (${env.NODE_ENV})`, {
        baseUrl: `http://localhost:${env.PORT}`,
      });
    });

    server.on('error', (error) => {
      logger.error('HTTP server error', { error: error.message });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start the server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

/** Graceful shutdown: stop accepting connections, then close the database. */
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
};

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason?.message ?? reason });
});

start();

module.exports = { start, shutdown };
