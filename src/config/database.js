'use strict';

const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('./logger');

mongoose.set('strictQuery', true);
// Fail fast instead of buffering commands for 10s when Mongo is unreachable.
mongoose.set('bufferCommands', false);

let connectionPromise = null;

async function connectDatabase(uri = env.MONGO_URI) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  mongoose.connection.on('connected', () => logger.info('MongoDB connection established'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', { error: err.message }));

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      minPoolSize: env.isTest ? 0 : 2,
      autoIndex: !env.isProduction, // rely on explicit migration/sync in production
    })
    .then((m) => {
      if (!env.isProduction) logger.info('Mongoose indexes ensured');
      return m.connection;
    })
    .catch((err) => {
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

async function disconnectDatabase() {
  connectionPromise = null;
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
}

function getDatabaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDatabase, disconnectDatabase, getDatabaseState, mongoose };