import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOutboxEventId } from '@manara/outbox';

test('deriveOutboxEventId embeds the tenant id for tenant-scoped events', () => {
  const id = deriveOutboxEventId({
    source: 'order',
    type: 'created',
    tenantId: 'tenant-1',
    occurrenceId: 'occurrence-1',
  });
  assert.equal(id, 'order:created:tenant-1:occurrence-1');
});

test('deriveOutboxEventId uses the platform marker for platform-scoped events', () => {
  const id = deriveOutboxEventId({
    source: 'notification',
    type: 'broadcast',
    tenantId: null,
    occurrenceId: 'occurrence-2',
  });
  assert.equal(id, 'notification:broadcast:platform:occurrence-2');
});

test('deriveOutboxEventId preserves arbitrary occurrence ids', () => {
  const occurrenceId = 'evt_0123456789abcdef';
  const id = deriveOutboxEventId({
    source: 'auth',
    type: 'user.registered',
    tenantId: 'tenant-2',
    occurrenceId,
  });
  assert.equal(id, `auth:user.registered:tenant-2:${occurrenceId}`);
});

test('deriveOutboxEventId is deterministic for the same input', () => {
  const input = {
    source: 'order',
    type: 'created',
    tenantId: 'tenant-1',
    occurrenceId: 'occurrence-1',
  };
  assert.equal(deriveOutboxEventId(input), deriveOutboxEventId(input));
});
