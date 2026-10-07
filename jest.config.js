'use strict';

module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/setupTests.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/scripts/**',
    '!src/config/env.js',
    '!src/routes/**',
    '!src/validators/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
