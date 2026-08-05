import assert from 'node:assert/strict';
import test from 'node:test';
import { errorResponseSchema } from '@manara/contracts';
import { buildErrorResponse } from '../../src/http/error-response.js';

test('error responses have the single documented shape', () => {
  const response = buildErrorResponse({ code: 'http.not_found', message: 'Resource not found', requestId: 'req-1234567890' });
  assert.deepEqual(response, { error: { code: 'http.not_found', message: 'Resource not found', requestId: 'req-1234567890' } });
  assert.equal(errorResponseSchema.safeParse(response).success, true);
});

test('validation errors include details', () => {
  const response = buildErrorResponse({
    code: 'http.validation_failed',
    message: 'Validation failed',
    requestId: 'req-1234567890',
    details: [{ path: 'email', code: 'invalid_string', message: 'Invalid email' }],
  });
  assert.equal(errorResponseSchema.safeParse(response).success, true);
  assert.equal(response.error.details?.[0]?.path, 'email');
});

test('request id and details are optional', () => {
  const response = buildErrorResponse({ code: 'http.internal_error', message: 'Internal server error' });
  assert.deepEqual(response, { error: { code: 'http.internal_error', message: 'Internal server error' } });
  assert.equal(errorResponseSchema.safeParse(response).success, true);
});

test('null request id and details are omitted', () => {
  const response = buildErrorResponse({ code: 'http.conflict', message: 'Conflict', requestId: null, details: null });
  assert.equal(response.error.requestId, undefined);
  assert.equal(response.error.details, undefined);
});
