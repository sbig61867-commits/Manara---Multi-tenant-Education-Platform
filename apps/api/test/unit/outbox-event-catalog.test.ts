import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NoopOutboxEventPublisher,
  OUTBOX_EVENT_TYPES,
  OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION,
  OutboxEventTypeUndeclaredError,
  OutboxEventTypeUnsupportedError,
  OutboxService,
  classifyOutboxEventType,
} from '@manara/outbox';
import {
  createOutboxEnqueueCommand,
  FakeDeadLetterRepository,
  FakeOutboxClock,
  FakeOutboxRepository,
} from './outbox-helpers.js';

function createService(policy: 'open' | 'strict' | undefined) {
  const service = new OutboxService(
    new FakeOutboxRepository(),
    new FakeDeadLetterRepository(),
    new NoopOutboxEventPublisher(),
    new FakeOutboxClock(),
    policy,
  );
  return service;
}

test('the catalog classifies all 24 emitted event types as without destination', () => {
  assert.equal(OUTBOX_EVENT_TYPES.length, 24);
  assert.deepEqual(OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION, OUTBOX_EVENT_TYPES);
  for (const type of OUTBOX_EVENT_TYPES) {
    assert.equal(classifyOutboxEventType(type), 'without-destination');
  }
  assert.equal(classifyOutboxEventType('tenant.createdd'), 'undeclared');
  assert.equal(classifyOutboxEventType('nobody.handles'), 'undeclared');
});

test('strict policy rejects an undeclared event type (typo fails fast)', async () => {
  const service = createService('strict');
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ eventType: 'tenant.createdd' })),
    (error: unknown) => {
      assert.ok(error instanceof OutboxEventTypeUndeclaredError);
      assert.equal((error as { code: string }).code, 'outbox.event_type_undeclared');
      assert.match((error as Error).message, /not declared in the outbox event catalog/);
      return true;
    },
  );
});

test('strict policy rejects every emitted event type without a destination', async () => {
  const service = createService('strict');
  for (const type of OUTBOX_EVENT_TYPES) {
    await assert.rejects(
      () => service.enqueue(createOutboxEnqueueCommand({ eventType: type })),
      (error: unknown) => {
        assert.ok(error instanceof OutboxEventTypeUnsupportedError);
        assert.equal((error as { code: string }).code, 'outbox.event_type_unsupported');
        assert.match((error as Error).message, /would guarantee a dead letter/);
        return true;
      },
    );
  }
});

test('strict policy never writes a rejected message', async () => {
  const repo = new FakeOutboxRepository();
  const service = new OutboxService(
    repo,
    new FakeDeadLetterRepository(),
    new NoopOutboxEventPublisher(),
    new FakeOutboxClock(),
    'strict',
  );
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ eventType: 'membership.created' })),
    OutboxEventTypeUnsupportedError,
  );
  assert.equal(repo.messages.size, 0);
});

test('open policy (default) still accepts undeclared types, preserving infrastructure behavior', async () => {
  const service = createService(undefined);
  const outcome = await service.enqueue(
    createOutboxEnqueueCommand({ eventSource: 'order', eventType: 'created', occurrenceId: 'occ-open-1' }),
  );
  assert.equal(outcome.status, 'enqueued');
});
