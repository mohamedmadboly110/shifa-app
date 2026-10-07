'use strict';

const crypto = require('crypto');
const { PAYMENT_PROVIDER } = require('../../constants');
const { env } = require('../../config/env');
const { generateTransactionReference } = require('../../utils/tokens');

/**
 * SIMULATED PAYMENT GATEWAY (MVP)
 * ---------------------------------------------------------------------------
 * Mimics the shape of a real PSP integration (create charge + refund) so that
 * swapping in Stripe / Paymob / Fawry later means writing one new module that
 * implements `createCharge` and `refund`, plus a provider entry below.
 *
 * No real money moves. Outcomes are deterministic so tests are stable:
 *   - `simulate: 'success'` (default) -> succeeds
 *   - `simulate: 'failure'`           -> declines with PROVIDER_DECLINED
 *   - `simulate: 'timeout'`           -> transient error, payment stays PENDING
 */
const simulatedGateway = {
  name: PAYMENT_PROVIDER.SIMULATED,

  /**
   * @param {{amount: number, currency: string, reference: string, simulate?: 'success'|'failure'|'timeout', metadata?: object}} input
   * @returns {Promise<{success: boolean, transactionReference: string, provider: string, amount: number, currency: string, status: 'PAID'|'FAILED'|'PENDING', message?: string, raw: object}>}
   */
  async createCharge({ amount, currency, reference, simulate = 'success', metadata = {} }) {
    // Simulated network latency so async behaviour is realistic.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const transactionReference = generateTransactionReference('SIMPAY');

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Gateway called with an invalid amount');
    }

    const fingerprint = crypto
      .createHash('sha256')
      .update(`${reference}:${amount}:${currency}`)
      .digest('hex')
      .slice(0, 12);

    if (simulate === 'failure') {
      return {
        success: false,
        status: 'FAILED',
        transactionReference,
        provider: PAYMENT_PROVIDER.SIMULATED,
        message: 'Your card was declined',
        raw: { fingerprint, declineCode: 'card_declined' },
      };
    }

    if (simulate === 'timeout') {
      return {
        success: false,
        status: 'PENDING',
        transactionReference,
        provider: PAYMENT_PROVIDER.SIMULATED,
        message: 'The payment provider did not respond in time',
        raw: { fingerprint, declineCode: 'provider_timeout' },
      };
    }

    return {
      success: true,
      status: 'PAID',
      transactionReference,
      provider: PAYMENT_PROVIDER.SIMULATED,
      amount,
      currency,
      message: 'Payment successful',
      raw: { fingerprint, method: 'simulated_card' },
    };
  },

  /**
   * @param {{amount: number, currency: string, transactionReference: string, metadata?: object}} input
   */
  async refund({ amount, currency, transactionReference, metadata = {} }) {
    await new Promise((resolve) => setTimeout(resolve, 5));

    return {
      success: true,
      status: 'REFUNDED',
      refundReference: generateTransactionReference('SIMREF'),
      provider: PAYMENT_PROVIDER.SIMULATED,
      amount,
      currency,
      originalTransactionReference: transactionReference,
      message: 'Refund successful',
      raw: { method: 'simulated_refund', appointmentId: metadata.appointmentId },
    };
  },
};

/**
 * Provider registry. Add a new provider here and the payment service needs no
 * changes to use it.
 */
const gateways = {
  [PAYMENT_PROVIDER.SIMULATED]: simulatedGateway,
};

const getGateway = (provider = env.PAYMENT_PROVIDER || PAYMENT_PROVIDER.SIMULATED) => {
  const gateway = gateways[provider];
  if (!gateway) throw new Error(`Unsupported payment provider "${provider}"`);
  return gateway;
};

/**
 * Development/testing hook: lets the suite force a provider outcome through a
 * request header. Compiled out of production builds entirely.
 */
const resolveSimulationFromHeader = (headers = {}) => {
  if (env.isProduction) return 'success';
  const requested = headers['x-simulate-payment'] || headers['X-Simulate-Payment'];
  if (requested === 'failure' || requested === 'timeout') return requested;
  return 'success';
};

module.exports = { simulatedGateway, getGateway, gateways, resolveSimulationFromHeader };