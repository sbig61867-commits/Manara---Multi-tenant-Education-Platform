import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRequestId, isValidRequestId } from '../../src/http/request-id.js';

test('generated request ids are valid uuids', () => {
  const id = generateRequestId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(isValidRequestId(id), true);
});

test('valid uuids pass strict validation', () => {
  assert.equal(isValidRequestId('123e4567-e89b-12d3-a456-426614174000'), true);
});

test('valid custom ids pass strict validation', () => {
  assert.equal(isValidRequestId('req-1234567890'), true);
  assert.equal(isValidRequestId('A'.repeat(64)), true);
});

test('ids shorter than 8 characters are rejected', () => {
  assert.equal(isValidRequestId('short'), false);
  assert.equal(isValidRequestId(''), false);
});

test('ids longer than 64 characters are rejected', () => {
  assert.equal(isValidRequestId('a'.repeat(65)), false);
});

test('ids with forbidden characters are rejected', () => {
  assert.equal(isValidRequestId('req id with spaces'), false);
  assert.equal(isValidRequestId('req_id_underscores'), false);
  assert.equal(isValidRequestId('req.dot.is.forbidden'), false);
  assert.equal(isValidRequestId('req!'), false);
});
