import assert from 'node:assert/strict';
import test from 'node:test';
import { InvalidOutboxMessageError } from '../../src/outbox/domain/errors.js';
import {
  isJsonSafeValue,
  isSensitiveKey,
  normalizeKey,
  REDACTED_VALUE,
  sanitizeErrorMessage,
  sanitizeOutboxPayload,
} from '../../src/outbox/application/payload-sanitizer.js';

test('normalizeKey strips separators and lowercases', () => {
  assert.equal(normalizeKey('accessToken'), 'accesstoken');
  assert.equal(normalizeKey('API_KEY'), 'apikey');
  assert.equal(normalizeKey('Authorization-Header'), 'authorizationheader');
});

test('isSensitiveKey matches common secret key patterns', () => {
  assert.equal(isSensitiveKey('password'), true);
  assert.equal(isSensitiveKey('accessToken'), true);
  assert.equal(isSensitiveKey('api_key'), true);
  assert.equal(isSensitiveKey('authorization'), true);
  assert.equal(isSensitiveKey('sessionId'), true);
  assert.equal(isSensitiveKey('userName'), false);
  assert.equal(isSensitiveKey('orderId'), false);
  assert.equal(isSensitiveKey('fileName'), false);
});

test('sanitizeOutboxPayload redacts sensitive keys at any depth', () => {
  const sanitized = sanitizeOutboxPayload({
    orderId: 'order-1',
    customer: { email: 'a@b.co', sessionToken: 'raw-token' },
    payment: { card: { number: '4111', password: 'hunter2' } },
    tags: [{ secret: 's3', label: 'gold' }],
  });
  assert.equal(sanitized.orderId, 'order-1');
  assert.equal(sanitized.customer?.email, 'a@b.co');
  assert.equal(sanitized.customer?.sessionToken, REDACTED_VALUE);
  assert.equal((sanitized.payment as { card: { number: string } })?.card.number, '4111');
  assert.equal((sanitized.payment as { card: { password: string } })?.card.password, REDACTED_VALUE);
  assert.deepEqual(sanitized.tags, [{ secret: REDACTED_VALUE, label: 'gold' }]);
});

test('sanitizeOutboxPayload returns a deep copy and never mutates the input', () => {
  const input = { password: 'raw', nested: { password: 'raw2' } };
  const sanitized = sanitizeOutboxPayload(input);
  assert.notEqual(sanitized, input);
  assert.notEqual(sanitized.nested, input.nested);
  assert.equal(input.password, 'raw');
  assert.equal(input.nested?.password, 'raw2');
});

test('sanitizeOutboxPayload rejects non-object payloads', () => {
  for (const value of ['text', 42, true, null, ['a'], undefined]) {
    assert.throws(
      () => sanitizeOutboxPayload(value),
      (error: unknown) => error instanceof InvalidOutboxMessageError,
    );
  }
});

test('sanitizeOutboxPayload rejects values that are not JSON-safe', () => {
  for (const value of [{ when: new Date() }, { n: Number.NaN }, { fn: () => 1 }]) {
    assert.throws(
      () => sanitizeOutboxPayload(value),
      (error: unknown) => error instanceof InvalidOutboxMessageError,
    );
  }
});

test('isJsonSafeValue accepts only JSON-safe values', () => {
  assert.equal(isJsonSafeValue({ a: [1, 'x', null, { b: true }] }), true);
  assert.equal(isJsonSafeValue({ a: new Date() }), false);
  assert.equal(isJsonSafeValue(Number.POSITIVE_INFINITY), false);
  assert.equal(isJsonSafeValue(undefined), false);
});

test('sanitizeErrorMessage collapses whitespace and truncates to the limit', () => {
  const message = 'a'.repeat(2000);
  const sanitized = sanitizeErrorMessage(message, 1000);
  assert.equal(sanitized.length, 1000);
  assert.equal(sanitizeErrorMessage('  boom\n  boom  ', 100), 'boom boom');
});

test('sanitizeErrorMessage unwraps Error instances and provides a fallback', () => {
  assert.equal(sanitizeErrorMessage(new Error('kaboom'), 100), 'kaboom');
  assert.equal(sanitizeErrorMessage(undefined, 100), 'unknown delivery failure');
  assert.equal(sanitizeErrorMessage('', 100), 'unknown delivery failure');
  assert.equal(sanitizeErrorMessage(123, 100), '123');
});
