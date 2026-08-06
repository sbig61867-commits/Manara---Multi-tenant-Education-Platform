import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OutboxDispatcher } from '@manara/outbox';
import {
  assertDispatcherCoverage,
  buildOutboxDispatcherRegistry,
  OUTBOX_EVENT_TYPES,
  OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION,
} from '../../src/outbox-event-catalog.js';
import { WorkerMetrics } from '../../src/metrics.js';
import { OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE, UnsupportedOutboxDispatcher } from '../../src/unsupported-event-dispatcher.js';
import {
  CollectingRuntimeLogger,
  createOutboxMessage,
  FakeOutboxClock,
  StubDispatcher,
} from './outbox-test-helpers.js';

function createUnsupportedHarness() {
  const logger = new CollectingRuntimeLogger();
  const metrics = new WorkerMetrics();
  const clock = new FakeOutboxClock();
  const dispatcher = new UnsupportedOutboxDispatcher({ logger, metrics, clock });
  return { logger, metrics, clock, dispatcher };
}

function deliveredDispatcher(): OutboxDispatcher {
  return new StubDispatcher(async (message) => ({
    messageId: message.id,
    status: 'delivered',
    attempt: {
      attemptNumber: 1,
      attemptedAt: new Date(),
      outcome: 'delivered',
      failure: null,
    },
  }));
}

test('the catalog classifies every emitted event type exactly once', () => {
  const emitted = new Set(OUTBOX_EVENT_TYPES);
  const required = new Set<string>();
  const optional = new Set(OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION);
  assert.doesNotThrow(() => assertDispatcherCoverage({ emitted, required, optional }));
  for (const type of emitted) {
    assert.ok(!required.has(type));
    assert.ok(optional.has(type));
  }
  assert.equal(emitted.size, 24);
});

test('coverage validation rejects required types that are not emitted', () => {
  assert.throws(
    () => assertDispatcherCoverage({ emitted: new Set(['a']), required: new Set(['a', 'ghost']), optional: new Set() }),
    /"ghost" is required but is not an emitted event type/,
  );
});

test('coverage validation rejects optional types that are not emitted', () => {
  assert.throws(
    () => assertDispatcherCoverage({ emitted: new Set(['a']), required: new Set(), optional: new Set(['ghost']) }),
    /"ghost" is optional but is not an emitted event type/,
  );
});

test('coverage validation rejects types classified as both required and optional', () => {
  assert.throws(
    () => assertDispatcherCoverage({ emitted: new Set(['a']), required: new Set(['a']), optional: new Set(['a']) }),
    /"a" is classified as both required and optional/,
  );
});

test('coverage validation rejects emitted types with no classification', () => {
  assert.throws(
    () => assertDispatcherCoverage({ emitted: new Set(['a', 'b']), required: new Set(['a']), optional: new Set() }),
    /"b" has no dispatcher and is not explicitly optional/,
  );
});

test('the registry built from the catalog routes every emitted type to the unsupported policy', () => {
  const harness = createUnsupportedHarness();
  const registry = buildOutboxDispatcherRegistry({
    logger: harness.logger,
    metrics: harness.metrics,
    clock: harness.clock,
  });

  assert.equal(registry.size, OUTBOX_EVENT_TYPES.length);
  for (const type of OUTBOX_EVENT_TYPES) {
    assert.ok(registry.get(type) instanceof UnsupportedOutboxDispatcher, `expected a dispatcher for ${type}`);
  }
  assert.equal(registry.get('never.emitted.anywhere'), null);
});

test('the catalog fails fast when a required dispatcher is missing', () => {
  const harness = createUnsupportedHarness();
  const requiredDispatchers = new Map<string, OutboxDispatcher>([
    ['membership.created', deliveredDispatcher()],
  ]);

  assert.throws(
    () =>
      buildOutboxDispatcherRegistry({
        logger: harness.logger,
        metrics: harness.metrics,
        clock: harness.clock,
        requiredDispatchers,
      }),
    /classified as both required and optional/,
  );
});

test('the catalog fails fast when a required dispatcher is not an emitted type', () => {
  const harness = createUnsupportedHarness();
  const requiredDispatchers = new Map<string, OutboxDispatcher>([
    ['typo.events.membership', deliveredDispatcher()],
  ]);

  assert.throws(
    () =>
      buildOutboxDispatcherRegistry({
        logger: harness.logger,
        metrics: harness.metrics,
        clock: harness.clock,
        requiredDispatchers,
      }),
    /"typo.events.membership" is required but is not an emitted event type/,
  );
});

test('an unsupported event fails retryable with a dedicated code, without touching the payload', async () => {
  const { logger, metrics, dispatcher } = createUnsupportedHarness();
  const message = createOutboxMessage({
    type: 'membership.created',
    payload: { secretToken: 'do-not-leak', userId: 'user-1' },
  });

  const result = await dispatcher.dispatch(message);

  assert.equal(result.status, 'failed');
  assert.equal(result.messageId, message.id);
  assert.equal(result.attempt.outcome, 'failed');
  assert.equal(result.attempt.failure?.code, OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE);
  assert.equal(result.attempt.failure?.retryable, true);
  assert.equal(metrics.getSnapshot().unsupported, 1);
  assert.ok(logger.entries.some((entry) => entry.object.event === 'worker_message_unsupported'));
  for (const entry of logger.entries) {
    assert.equal(Object.hasOwn(entry.object, 'payload'), false, 'payload must never be logged');
    assert.equal(Object.hasOwn(entry.object, 'secretToken'), false, 'payload contents must never be logged');
    assert.equal(entry.object.messageId, message.id);
    assert.equal(entry.object.type, 'membership.created');
  }
});
