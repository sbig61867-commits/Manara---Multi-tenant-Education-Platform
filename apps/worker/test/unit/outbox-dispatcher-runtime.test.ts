import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  NoopOutboxEventPublisher,
  OUTBOX_DEFAULT_CLAIM_LEASE_MS,
  OutboxService,
} from '@manara/outbox';
import { OutboxDispatcherRegistry } from '../../src/dispatcher-registry.js';
import { WorkerMetrics } from '../../src/metrics.js';
import {
  OutboxDispatcherRuntime,
  type CycleSummary,
  type OutboxDispatcherRuntimeOptions,
} from '../../src/outbox-dispatcher-runtime.js';
import {
  CollectingRuntimeLogger,
  createOutboxMessage,
  FakeDeadLetterRepository,
  FakeOutboxClock,
  FakeOutboxRepository,
  StubDispatcher,
} from './outbox-test-helpers.js';

function createHarness(overrides?: Partial<OutboxDispatcherRuntimeOptions>) {
  const repo = new FakeOutboxRepository();
  const deadLetters = new FakeDeadLetterRepository();
  const clock = new FakeOutboxClock();
  const registry = new OutboxDispatcherRegistry();
  const metrics = new WorkerMetrics();
  const logger = new CollectingRuntimeLogger();
  const service = new OutboxService(repo, deadLetters, new NoopOutboxEventPublisher(), clock);
  const options: OutboxDispatcherRuntimeOptions = {
    pollIntervalMs: 5_000,
    batchSize: 10,
    claimLeaseMs: OUTBOX_DEFAULT_CLAIM_LEASE_MS,
    staleClaimReleaseIntervalMs: 60_000,
    shutdownTimeoutMs: 2_000,
    claimScope: 'platform',
    claimTenantId: null,
    workerId: 'test-worker',
    ...overrides,
  };
  const runtime = new OutboxDispatcherRuntime(options, {
    repository: repo,
    service,
    clock,
    registry,
    metrics,
    logger,
  });
  return { runtime, repo, deadLetters, clock, registry, metrics, logger, service, options };
}

class CountingRuntime extends OutboxDispatcherRuntime {
  public cycleCount = 0;

  override async runCycle(): Promise<CycleSummary> {
    this.cycleCount += 1;
    return super.runCycle();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deliveredResult(messageId: string) {
  return {
    messageId,
    status: 'delivered' as const,
    attempt: { attemptNumber: 1, attemptedAt: new Date(), outcome: 'delivered' as const, failure: null },
  };
}

test('registry routes dispatchers by event type', () => {
  const registry = new OutboxDispatcherRegistry();
  const dispatcher = new StubDispatcher(async () => deliveredResult('m'));
  assert.equal(registry.size, 0);
  assert.equal(registry.get('order.created'), null);
  registry.register('order.created', dispatcher);
  assert.equal(registry.size, 1);
  assert.equal(registry.get('order.created'), dispatcher);
  assert.throws(() => registry.register('', dispatcher), /non-empty/);
});

test('a delivered message is marked delivered with metrics and latency', async () => {
  const { runtime, repo, registry, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null });
  repo.messages.set(message.id, message);
  registry.register(message.type, new StubDispatcher(async () => deliveredResult(message.id)));

  const summary = await runtime.runCycle();

  assert.equal(summary.claimed, 1);
  assert.equal(summary.delivered, 1);
  assert.equal(repo.messages.get(message.id)?.status, 'delivered');
  const snapshot = metrics.getSnapshot();
  assert.equal(snapshot.claimed, 1);
  assert.equal(snapshot.delivered, 1);
  assert.equal(snapshot.failed, 0);
  assert.equal(snapshot.dispatchLatency.count, 1);
  assert.ok(snapshot.dispatchLatency.minMs <= snapshot.dispatchLatency.maxMs);
});

test('an unknown event type fails safely into retry, then dead-letter after max attempts', async () => {
  const { runtime, repo, deadLetters, clock, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null, type: 'unknown.event' });
  repo.messages.set(message.id, message);

  const first = await runtime.runCycle();
  assert.equal(first.claimed, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.deadLettered, 0);
  const afterFirst = repo.messages.get(message.id);
  assert.equal(afterFirst?.status, 'pending');
  assert.equal(afterFirst?.attempts, 1);
  assert.equal(afterFirst?.lastError?.code, 'outbox.dispatcher_not_found');
  assert.equal(afterFirst?.lastError?.retryable, true);
  assert.ok(afterFirst?.nextAttemptAt instanceof Date);

  const delays = [60_000, 300_000, 900_000, 3_600_000];
  for (const delay of delays) {
    clock.advanceBy(delay);
    const summary = await runtime.runCycle();
    assert.equal(summary.failed, 1);
  }
  const exhausted = repo.messages.get(message.id);
  assert.equal(exhausted?.status, 'dead_letter');
  assert.equal(exhausted?.attempts, 5);
  assert.equal(deadLetters.records.size, 1);
  assert.equal(metrics.getSnapshot().deadLettered, 1);
  assert.equal(deadLetters.records.get(message.id)?.attempts, 5);
});

test('a non-retryable failure is dead-lettered on the first attempt', async () => {
  const { runtime, repo, registry, deadLetters, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null, type: 'order.created' });
  repo.messages.set(message.id, message);
  registry.register('order.created', new StubDispatcher(async () => ({
    messageId: message.id,
    status: 'failed',
    attempt: {
      attemptNumber: 1,
      attemptedAt: new Date(),
      outcome: 'failed',
      failure: { code: 'order.rejected', message: 'permanently rejected', retryable: false, occurredAt: new Date() },
    },
  })));

  const summary = await runtime.runCycle();

  assert.equal(summary.failed, 1);
  assert.equal(summary.retried, 0);
  assert.equal(summary.deadLettered, 1);
  assert.equal(repo.messages.get(message.id)?.status, 'dead_letter');
  assert.equal(deadLetters.records.get(message.id)?.failure.code, 'order.rejected');
  assert.equal(metrics.getSnapshot().deadLettered, 1);
});

test('a dispatcher failure is recorded with a sanitized error and retried with backoff', async () => {
  const { runtime, repo, registry, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null, type: 'order.created' });
  repo.messages.set(message.id, message);
  registry.register('order.created', new StubDispatcher(async () => ({
    messageId: message.id,
    status: 'failed',
    attempt: {
      attemptNumber: 1,
      attemptedAt: new Date(),
      outcome: 'failed',
      failure: {
        code: 'order.dispatch_timeout',
        message: '  upstream\n timeout  ',
        retryable: true,
        occurredAt: new Date(),
      },
    },
  })));

  await runtime.runCycle();

  const updated = repo.messages.get(message.id);
  assert.equal(updated?.status, 'pending');
  assert.equal(updated?.attempts, 1);
  assert.equal(updated?.lastError?.code, 'order.dispatch_timeout');
  assert.equal(updated?.lastError?.message, 'upstream timeout');
  assert.equal(metrics.getSnapshot().failed, 1);
  assert.equal(metrics.getSnapshot().retried, 1);
});

test('a throwing dispatcher is isolated: the rest of the batch still delivers', async () => {
  const { runtime, repo, registry, metrics } = createHarness();
  const poison = createOutboxMessage({
    scope: 'platform',
    tenantId: null,
    type: 'poison.type',
    eventId: `x:y:platform:${randomUUID()}`,
  });
  const healthy = createOutboxMessage({
    scope: 'platform',
    tenantId: null,
    type: 'healthy.type',
    eventId: `x:y:platform:${randomUUID()}`,
  });
  repo.messages.set(poison.id, poison);
  repo.messages.set(healthy.id, healthy);
  registry.register('poison.type', new StubDispatcher(async () => {
    throw new Error('kaboom');
  }));
  registry.register('healthy.type', new StubDispatcher(async () => deliveredResult(healthy.id)));

  const summary = await runtime.runCycle();

  assert.equal(summary.claimed, 2);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.dispatchErrors, 1);
  assert.equal(repo.messages.get(healthy.id)?.status, 'delivered');
  assert.equal(repo.messages.get(poison.id)?.status, 'pending');
  assert.equal(repo.messages.get(poison.id)?.attempts, 1);
  assert.equal(repo.messages.get(poison.id)?.lastError?.code, 'outbox.dispatch_error');
  assert.equal(metrics.getSnapshot().delivered, 1);
});

test('a lease that expires mid-dispatch never completes: the message is redelivered', async () => {
  const { runtime, repo, clock, registry, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null, type: 'slow.type' });
  repo.messages.set(message.id, message);
  let dispatches = 0;
  registry.register('slow.type', new StubDispatcher(async () => {
    dispatches += 1;
    if (dispatches === 1) {
      clock.advanceBy(OUTBOX_DEFAULT_CLAIM_LEASE_MS + 1);
    }
    return deliveredResult(message.id);
  }));

  const first = await runtime.runCycle();
  assert.equal(first.delivered, 0);
  assert.equal(repo.messages.get(message.id)?.status, 'claimed');

  const second = await runtime.runCycle();
  assert.equal(second.staleClaimsReleased, 1);
  assert.equal(second.delivered, 1);
  assert.equal(dispatches, 2);
  assert.equal(repo.messages.get(message.id)?.status, 'delivered');
  assert.equal(metrics.getSnapshot().delivered, 1);
});

test('tenant-scoped runtimes claim only their tenant and platform runtimes claim only platform messages', async () => {
  const { runtime, repo, clock, registry, service } = createHarness({
    claimScope: 'tenant',
    claimTenantId: 'tenant-1',
  });
  const tenantOne = createOutboxMessage({ tenantId: 'tenant-1', eventId: `o:created:tenant-1:${randomUUID()}` });
  const tenantTwo = createOutboxMessage({ tenantId: 'tenant-2', eventId: `o:created:tenant-2:${randomUUID()}` });
  const platform = createOutboxMessage({ scope: 'platform', tenantId: null, eventId: `p:b:platform:${randomUUID()}` });
  for (const message of [tenantOne, tenantTwo, platform]) {
    repo.messages.set(message.id, message);
  }
  const deliverAll = new StubDispatcher(async (message) => deliveredResult(message.id));
  registry.register('created', deliverAll);
  registry.register('b', deliverAll);

  const summary = await runtime.runCycle();
  assert.equal(summary.claimed, 1);
  assert.equal(repo.messages.get(tenantOne.id)?.status, 'delivered');
  assert.equal(repo.messages.get(tenantTwo.id)?.status, 'pending');
  assert.equal(repo.messages.get(platform.id)?.status, 'pending');

  const platformRuntime = new OutboxDispatcherRuntime(
    {
      pollIntervalMs: 5_000,
      batchSize: 10,
      claimLeaseMs: OUTBOX_DEFAULT_CLAIM_LEASE_MS,
      staleClaimReleaseIntervalMs: 60_000,
      shutdownTimeoutMs: 2_000,
      claimScope: 'platform',
      claimTenantId: null,
      workerId: 'test-worker',
    },
    { repository: repo, service, clock, registry, metrics: new WorkerMetrics(), logger: new CollectingRuntimeLogger() },
  );
  const platformSummary = await platformRuntime.runCycle();
  assert.equal(platformSummary.claimed, 1);
  assert.equal(repo.messages.get(platform.id)?.status, 'delivered');
  assert.equal(repo.messages.get(tenantTwo.id)?.status, 'pending');
});

test('the loop initializes, waits while idle (no busy loop), and stops promptly', async () => {
  const { repo, deadLetters, clock, registry, metrics, logger } = createHarness();
  const runtime = new CountingRuntime(
    {
      pollIntervalMs: 60_000,
      batchSize: 10,
      claimLeaseMs: OUTBOX_DEFAULT_CLAIM_LEASE_MS,
      staleClaimReleaseIntervalMs: 60_000,
      shutdownTimeoutMs: 2_000,
      claimScope: 'platform',
      claimTenantId: null,
      workerId: 'test-worker',
    },
    {
      repository: repo,
      service: new OutboxService(repo, deadLetters, new NoopOutboxEventPublisher(), clock),
      clock,
      registry,
      metrics,
      logger,
    },
  );

  await runtime.start();
  assert.equal(runtime.getState().loopInitialized, true);
  const cyclesWhileIdle = runtime.cycleCount;
  await sleep(200);
  assert.equal(runtime.cycleCount, cyclesWhileIdle);

  const startedAt = Date.now();
  await runtime.stop();
  assert.ok(Date.now() - startedAt < 2_000);
  assert.equal(runtime.getState().phase, 'stopped');
  assert.equal(runtime.getState().shutdownStarted, true);
});

test('a stopped runtime makes no new claims', async () => {
  const { runtime, repo } = createHarness();
  await runtime.start();
  await runtime.stop();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null });
  repo.messages.set(message.id, message);
  await sleep(150);
  assert.equal(repo.messages.get(message.id)?.status, 'pending');
});

test('metrics snapshots aggregate counters across cycles', async () => {
  const { runtime, repo, registry, metrics } = createHarness();
  const message = createOutboxMessage({ scope: 'platform', tenantId: null, type: 'order.created' });
  repo.messages.set(message.id, message);
  registry.register('order.created', new StubDispatcher(async () => deliveredResult(message.id)));

  await runtime.runCycle();
  await runtime.runCycle();

  const snapshot = metrics.getSnapshot();
  assert.equal(snapshot.claimed, 1);
  assert.equal(snapshot.delivered, 1);
  assert.equal(snapshot.failed, 0);
  assert.equal(snapshot.retried, 0);
  assert.equal(snapshot.deadLettered, 0);
  assert.equal(snapshot.staleClaimsReleased, 0);
  assert.equal(snapshot.dispatchLatency.count, 1);
  assert.equal(snapshot.dispatchLatency.sumMs > 0, true);
});

test('runtime logs never include the message payload', async () => {
  const { runtime, repo, registry, logger } = createHarness();
  const message = createOutboxMessage({
    scope: 'platform',
    tenantId: null,
    type: 'order.created',
    payload: { orderId: 'order-1', sessionToken: 'super-secret-token', password: 'hunter2' },
  });
  repo.messages.set(message.id, message);
  registry.register('order.created', new StubDispatcher(async () => deliveredResult(message.id)));

  await runtime.runCycle();

  const serialized = JSON.stringify(logger.entries);
  assert.ok(!serialized.includes('super-secret-token'));
  assert.ok(!serialized.includes('hunter2'));
  assert.ok(!serialized.includes('order-1'));
});
