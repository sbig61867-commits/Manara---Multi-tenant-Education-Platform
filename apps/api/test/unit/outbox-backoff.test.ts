import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OUTBOX_DEFAULT_CLAIM_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_RETRY_DELAYS_MS,
  outboxAttemptsExhausted,
  outboxRetryDelayMs,
} from '../../src/outbox/application/backoff.js';

test('outbox exposes the documented delivery schedule', () => {
  assert.equal(OUTBOX_MAX_ATTEMPTS, 5);
  assert.deepEqual(OUTBOX_RETRY_DELAYS_MS, [60_000, 300_000, 900_000, 3_600_000, 21_600_000]);
  assert.equal(OUTBOX_DEFAULT_CLAIM_LEASE_MS, 300_000);
});

test('outboxRetryDelayMs returns deterministic delays for attempts below the max', () => {
  assert.equal(outboxRetryDelayMs(1), 60_000);
  assert.equal(outboxRetryDelayMs(2), 300_000);
  assert.equal(outboxRetryDelayMs(3), 900_000);
  assert.equal(outboxRetryDelayMs(4), 3_600_000);
});

test('outboxRetryDelayMs returns null once the attempt budget is exhausted', () => {
  assert.equal(outboxRetryDelayMs(OUTBOX_MAX_ATTEMPTS), null);
  assert.equal(outboxRetryDelayMs(OUTBOX_MAX_ATTEMPTS + 1), null);
  assert.equal(outboxAttemptsExhausted(OUTBOX_MAX_ATTEMPTS), true);
  assert.equal(outboxAttemptsExhausted(OUTBOX_MAX_ATTEMPTS - 1), false);
});

test('outboxRetryDelayMs rejects non-integer and out-of-range attempt counts', () => {
  assert.equal(outboxRetryDelayMs(0), null);
  assert.equal(outboxRetryDelayMs(-1), null);
  assert.equal(outboxRetryDelayMs(1.5), null);
  assert.equal(outboxRetryDelayMs(Number.NaN), null);
});
