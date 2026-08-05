import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { decodeCursor, encodeCursor } from '../../src/tenant/pagination.js';

test('cursor round-trips a createdAt/id pair', () => {
  const createdAt = new Date('2026-08-05T12:34:56.789Z');
  const id = randomUUID();
  const decoded = decodeCursor(encodeCursor(createdAt, id));
  assert.ok(decoded);
  assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(decoded.id, id);
});

test('cursor output is opaque base64url and contains no raw identifiers', () => {
  const createdAt = new Date('2026-08-05T12:34:56.789Z');
  const id = randomUUID();
  const encoded = encodeCursor(createdAt, id);
  assert.ok(!encoded.includes(createdAt.toISOString()));
  assert.ok(!encoded.includes(id));
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test('malformed cursors decode to null', () => {
  assert.equal(decodeCursor('not-base64url-!!'), null);
  assert.equal(decodeCursor(''), null);
  assert.equal(decodeCursor(Buffer.from('no-separator', 'utf8').toString('base64url')), null);
  assert.equal(decodeCursor(Buffer.from('not-a-date:uuid', 'utf8').toString('base64url')), null);
  assert.equal(decodeCursor(Buffer.from('2026-08-05T12:34:56.789Z:', 'utf8').toString('base64url')), null);
});
