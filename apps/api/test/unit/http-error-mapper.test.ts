import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpStatus } from '@nestjs/common';
import { mapDomainError, toHttpApiError } from '../../src/http/error-mapper.js';
import { HttpApiError } from '../../src/http/errors.js';

test('not_found codes map to 404', () => {
  const mapped = mapDomainError({ code: 'tenant.institution_not_found', message: 'gone' });
  assert.equal(mapped.statusCode, HttpStatus.NOT_FOUND);
  assert.equal(mapped.code, 'tenant.institution_not_found');
  assert.equal(mapped.message, 'gone');
});

test('conflict-style codes map to 409', () => {
  for (const code of ['tenant.membership_already_exists', 'tenant.membership_already_active', 'tenant.invalid_membership_transition', 'tenant.invitation_acceptance_rejected']) {
    assert.equal(mapDomainError({ code, message: 'x' }).statusCode, HttpStatus.CONFLICT, code);
  }
});

test('auth codes map to 401', () => {
  assert.equal(mapDomainError({ code: 'auth.invalid_credentials', message: 'x' }).statusCode, HttpStatus.UNAUTHORIZED);
  assert.equal(mapDomainError({ code: 'session.expired', message: 'x' }).statusCode, HttpStatus.UNAUTHORIZED);
});

test('authorization codes map to 403', () => {
  assert.equal(mapDomainError({ code: 'authorization.permission_denied', message: 'x' }).statusCode, HttpStatus.FORBIDDEN);
  assert.equal(mapDomainError({ code: 'permission.denied', message: 'x' }).statusCode, HttpStatus.FORBIDDEN);
});

test('quota and rate codes map to 429', () => {
  assert.equal(mapDomainError({ code: 'quota.exceeded', message: 'x' }).statusCode, HttpStatus.TOO_MANY_REQUESTS);
  assert.equal(mapDomainError({ code: 'rate.limited', message: 'x' }).statusCode, HttpStatus.TOO_MANY_REQUESTS);
});

test('fail-closed codes map to 503', () => {
  assert.equal(mapDomainError({ code: 'unavailable.rate_limit_backend', message: 'x' }).statusCode, HttpStatus.SERVICE_UNAVAILABLE);
  assert.equal(mapDomainError({ code: 'provider.unavailable', message: 'x' }).statusCode, HttpStatus.SERVICE_UNAVAILABLE);
});

test('unknown codes map to 500 without leaking the message', () => {
  const mapped = mapDomainError({ code: 'billing.some_failure', message: 'driver detail: connection refused' });
  assert.equal(mapped.statusCode, HttpStatus.INTERNAL_SERVER_ERROR);
  assert.equal(mapped.message, 'Internal server error');
});

test('errors without a code map to 500 with the generic code', () => {
  const mapped = mapDomainError({ message: 'boom' });
  assert.equal(mapped.statusCode, HttpStatus.INTERNAL_SERVER_ERROR);
  assert.equal(mapped.code, 'http.internal_error');
});

test('toHttpApiError preserves an existing HttpApiError', () => {
  const original = new HttpApiError({ code: 'http.not_found', statusCode: 404, message: 'nope' });
  const converted = toHttpApiError(original);
  assert.equal(converted, original);
});

test('toHttpApiError converts domain errors with their mapped status and code', () => {
  const converted = toHttpApiError({ code: 'tenant.institution_not_found', message: 'gone' });
  assert.ok(converted instanceof HttpApiError);
  assert.equal(converted.statusCode, 404);
  assert.equal(converted.code, 'tenant.institution_not_found');
});

test('toHttpApiError converts unknown errors to a generic 500', () => {
  const converted = toHttpApiError(new Error('stack trace here'));
  assert.ok(converted instanceof HttpApiError);
  assert.equal(converted.statusCode, 500);
  assert.equal(converted.code, 'http.internal_error');
  assert.equal(converted.message, 'Internal server error');
});

test('audit not_found codes map to 404', () => {
  const mapped = mapDomainError({ code: 'audit.event_not_found', message: 'gone' });
  assert.equal(mapped.statusCode, HttpStatus.NOT_FOUND);
  assert.equal(mapped.code, 'audit.event_not_found');
  assert.equal(mapped.message, 'gone');
});

test('audit context failures map to 403', () => {
  for (const code of ['audit.context_missing', 'audit.context_mismatch', 'audit.cross_tenant_read_denied']) {
    assert.equal(mapDomainError({ code, message: 'x' }).statusCode, HttpStatus.FORBIDDEN, code);
  }
});

test('audit invalid event and query codes map to 400', () => {
  assert.equal(mapDomainError({ code: 'audit.invalid_event', message: 'x' }).statusCode, HttpStatus.BAD_REQUEST);
  assert.equal(mapDomainError({ code: 'audit.invalid_query', message: 'x' }).statusCode, HttpStatus.BAD_REQUEST);
});

test('unknown audit codes map to 409', () => {
  assert.equal(mapDomainError({ code: 'audit.unknown_state', message: 'x' }).statusCode, HttpStatus.CONFLICT);
});
