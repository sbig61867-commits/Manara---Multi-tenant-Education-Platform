import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import {
  NoopOutboxEventPublisher,
  OutboxService,
  PostgresDeadLetterRepository,
  PostgresOutboxRepository,
} from '@manara/outbox';
import type { OutboxClock } from '@manara/outbox';
import { OutboxDispatcherRegistry } from '../../src/dispatcher-registry.js';
import { createHealthServer } from '../../src/health-server.js';
import { WorkerMetrics } from '../../src/metrics.js';
import { buildOutboxDispatcherRegistry } from '../../src/outbox-event-catalog.js';
import { OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE } from '../../src/unsupported-event-dispatcher.js';
import {
  OutboxDispatcherRuntime,
  type OutboxDispatcherRuntimeOptions,
} from '../../src/outbox-dispatcher-runtime.js';
import { CollectingRuntimeLogger, StubDispatcher } from '../unit/outbox-test-helpers.js';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

class SystemOutboxClock implements OutboxClock {
  now(): Date {
    return new Date();
  }
}

function deliveredResult(messageId: string) {
  return {
    messageId,
    status: 'delivered' as const,
    attempt: { attemptNumber: 1, attemptedAt: new Date(), outcome: 'delivered' as const, failure: null },
  };
}

describe('outbox dispatcher runtime (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let tenantA = '';
  let userA = '';

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE outbox_messages CASCADE');
    await database.query("DELETE FROM institutions WHERE name = 'Worker Outbox University'");
    await database.query("DELETE FROM users WHERE email = 'worker-outbox-user@test.local'");
    tenantA = randomUUID();
    userA = randomUUID();
    await database.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userA, 'worker-outbox-user@test.local']);
    await database.query(
      'INSERT INTO institutions (id, name, type, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5)',
      [tenantA, 'Worker Outbox University', 'university', 'active', userA],
    );
  });

  beforeEach(async () => {
    await requireDb().query('TRUNCATE TABLE outbox_messages CASCADE');
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE outbox_messages CASCADE');
        await database.query("DELETE FROM institutions WHERE name = 'Worker Outbox University'");
      } finally {
        await database.close();
      }
    }
  });

  function requireDb(): PostgresDatabase {
    if (database === undefined) {
      throw new Error('before hook did not create the database');
    }
    return database;
  }

  function createRuntime(
    db: PostgresDatabase,
    registry: OutboxDispatcherRegistry,
    overrides?: Partial<OutboxDispatcherRuntimeOptions>,
    shared?: { metrics?: WorkerMetrics; logger?: CollectingRuntimeLogger },
  ) {
    const repository = new PostgresOutboxRepository(db);
    const deadLetters = new PostgresDeadLetterRepository(db);
    const service = new OutboxService(repository, deadLetters, new NoopOutboxEventPublisher(), new SystemOutboxClock());
    const metrics = shared?.metrics ?? new WorkerMetrics();
    const logger = shared?.logger ?? new CollectingRuntimeLogger();
    const runtime = new OutboxDispatcherRuntime(
      {
        pollIntervalMs: 60_000,
        batchSize: 10,
        claimLeaseMs: 60_000,
        staleClaimReleaseIntervalMs: 60_000,
        shutdownTimeoutMs: 2_000,
        claimScope: 'platform',
        claimTenantId: null,
        workerId: 'integration-test',
        ...overrides,
      },
      { repository, service, clock: new SystemOutboxClock(), registry, metrics, logger },
    );
    return { runtime, repository, service, metrics, logger };
  }
  async function enqueuePlatform(db: PostgresDatabase, service: OutboxService, eventType: string, occurrenceId: string) {
    const outcome = await service.enqueue({
      scope: 'platform',
      tenantId: null,
      eventSource: 'worker-test',
      eventType,
      occurrenceId,
      payload: { orderId: 'order-1' },
    });
    assert.equal(outcome.status, 'enqueued');
    if (outcome.status === 'enqueued') {
      return outcome.message;
    }
    throw new Error('enqueue failed');
  }

  async function makeDue(db: PostgresDatabase, messageId: string): Promise<void> {
    await db.query("UPDATE outbox_messages SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [messageId]);
  }

  test('delivers a platform message end to end and records metrics', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, service, metrics } = createRuntime(db, registry);
    const message = await enqueuePlatform(db, service, 'dispatch.me', randomUUID());
    registry.register('dispatch.me', new StubDispatcher(async () => deliveredResult(message.id)));

    const summary = await runtime.runCycle();

    assert.equal(summary.claimed, 1);
    assert.equal(summary.delivered, 1);
    const [row] = (
      await db.query<{ status: string; delivered_at: Date | null; lease_owner: string | null }>(
        'SELECT status, delivered_at, lease_owner FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.equal(row?.status, 'delivered');
    assert.ok(row?.delivered_at instanceof Date);
    assert.equal(row?.lease_owner, null);
    const snapshot = metrics.getSnapshot();
    assert.equal(snapshot.claimed, 1);
    assert.equal(snapshot.delivered, 1);
  });

  test('retries with backoff and dead-letters exactly once after five attempts', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, service } = createRuntime(db, registry);
    const message = await enqueuePlatform(db, service, 'always.fails', randomUUID());
    registry.register('always.fails', new StubDispatcher(async () => ({
      messageId: message.id,
      status: 'failed',
      attempt: {
        attemptNumber: 1,
        attemptedAt: new Date(),
        outcome: 'failed',
        failure: { code: 'upstream.timeout', message: 'boom', retryable: true, occurredAt: new Date() },
      },
    })));

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) {
        await makeDue(db, message.id);
      }
      const summary = await runtime.runCycle();
      assert.equal(summary.claimed, 1);
      assert.equal(summary.failed, 1);
      const [row] = (
        await db.query<{ status: string; attempt_count: number; next_attempt_at: Date | null }>(
          'SELECT status, attempt_count, next_attempt_at FROM outbox_messages WHERE id = $1',
          [message.id],
        )
      ).rows;
      assert.equal(row?.attempt_count, attempt);
      if (attempt < 5) {
        assert.equal(row?.status, 'pending');
        assert.ok(row?.next_attempt_at instanceof Date);
      } else {
        assert.equal(row?.status, 'dead_letter');
      }
    }

    const deadLetterCount = await db.query('SELECT count(*)::int AS total FROM outbox_dead_letters WHERE message_id = $1', [message.id]);
    assert.equal(deadLetterCount.rows[0]?.total, 1);
    const [record] = (
      await db.query<{ attempt_count: number; failure: Record<string, unknown> }>(
        'SELECT attempt_count, failure FROM outbox_dead_letters WHERE message_id = $1',
        [message.id],
      )
    ).rows;
    assert.equal(record?.attempt_count, 5);
    assert.equal(record?.failure.code, 'upstream.timeout');

    const after = await runtime.runCycle();
    assert.equal(after.claimed, 0);
    const final = await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [message.id]);
    assert.equal(final.rows[0]?.status, 'dead_letter');
  });

  test('an unknown event type fails safely into retry', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, service } = createRuntime(db, registry);
    const message = await enqueuePlatform(db, service, 'nobody.handles', randomUUID());

    const summary = await runtime.runCycle();

    assert.equal(summary.claimed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.deadLettered, 0);
    const [row] = (
      await db.query<{ status: string; attempt_count: number; last_error: Record<string, unknown> | null }>(
        'SELECT status, attempt_count, last_error FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.equal(row?.status, 'pending');
    assert.equal(row?.attempt_count, 1);
    assert.equal(row?.last_error?.code, 'outbox.dispatcher_not_found');
  });

  test('a non-retryable failure is dead-lettered on the first attempt', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, service } = createRuntime(db, registry);
    const message = await enqueuePlatform(db, service, 'permanent.failure', randomUUID());
    registry.register('permanent.failure', new StubDispatcher(async () => ({
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
    assert.equal(summary.deadLettered, 1);
    const [row] = (
      await db.query<{ status: string; attempt_count: number }>(
        'SELECT status, attempt_count FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.equal(row?.status, 'dead_letter');
    assert.equal(row?.attempt_count, 1);
  });

  test('a claim held by another instance is never dispatched', async () => {
    const db = requireDb();
    const firstRegistry = new OutboxDispatcherRegistry();
    const first = createRuntime(db, firstRegistry);
    const message = await enqueuePlatform(db, first.service, 'owned.by.first', randomUUID());
    firstRegistry.register('owned.by.first', new StubDispatcher(async () => deliveredResult(message.id)));

    const claimed = await first.runtime.runCycle();
    assert.equal(claimed.claimed, 1);
    assert.equal(claimed.delivered, 1);

    const second = createRuntime(db, new OutboxDispatcherRegistry());
    const other = await second.runtime.runCycle();
    assert.equal(other.claimed, 0);
    assert.equal(other.delivered, 0);
  });

  test('expired claims are released back to pending and redelivered', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, repository, service } = createRuntime(db, registry, { staleClaimReleaseIntervalMs: 0 });
    const message = await enqueuePlatform(db, service, 'retry.after.lease', randomUUID());
    registry.register('retry.after.lease', new StubDispatcher(async () => deliveredResult(message.id)));

    const now = new Date();
    await repository.claimPending({ scope: 'platform', limit: 10 }, now, new Date(now.getTime() - 1_000));
    const [row] = (
      await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [message.id])
    ).rows;
    assert.equal(row?.status, 'claimed');

    const summary = await runtime.runCycle();
    assert.equal(summary.staleClaimsReleased, 1);
    assert.equal(summary.claimed, 1);
    assert.equal(summary.delivered, 1);
    const [after] = (
      await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [message.id])
    ).rows;
    assert.equal(after?.status, 'delivered');
  });

  test('a platform-scoped runtime never dispatches tenant messages', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime, service } = createRuntime(db, registry);
    const platform = await enqueuePlatform(db, service, 'tenant.isolation', randomUUID());
    const tenantOutcome = await service.enqueue({
      scope: 'tenant',
      tenantId: tenantA,
      eventSource: 'worker-test',
      eventType: 'tenant.isolation',
      occurrenceId: randomUUID(),
      payload: { orderId: 'order-1' },
    });
    assert.equal(tenantOutcome.status, 'enqueued');
    registry.register('tenant.isolation', new StubDispatcher(async (message) => deliveredResult(message.id)));

    const summary = await runtime.runCycle();

    assert.equal(summary.claimed, 1);
    assert.equal(summary.delivered, 1);
    const platformRow = await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [platform.id]);
    const tenantRow = await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [
      tenantOutcome.status === 'enqueued' ? tenantOutcome.message.id : '',
    ]);
    assert.equal(platformRow.rows[0]?.status, 'delivered');
    assert.equal(tenantRow.rows[0]?.status, 'pending');
  });

  test('an explicitly unsupported emitted event type retries and dead-letters with the unsupported code', async () => {
    const db = requireDb();
    const metrics = new WorkerMetrics();
    const logger = new CollectingRuntimeLogger();
    const { runtime, service } = createRuntime(
      db,
      buildOutboxDispatcherRegistry({ logger, metrics, clock: new SystemOutboxClock() }),
      undefined,
      { metrics, logger },
    );
    const message = await enqueuePlatform(db, service, 'membership.created', randomUUID());

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) {
        await makeDue(db, message.id);
      }
      const summary = await runtime.runCycle();
      assert.equal(summary.claimed, 1);
      assert.equal(summary.failed, 1);
      const [row] = (
        await db.query<{ status: string; attempt_count: number; last_error: Record<string, unknown> | null }>(
          'SELECT status, attempt_count, last_error FROM outbox_messages WHERE id = $1',
          [message.id],
        )
      ).rows;
      assert.equal(row?.attempt_count, attempt);
      assert.equal(row?.last_error?.code, OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE);
      assert.equal(row?.last_error?.retryable, true);
      if (attempt < 5) {
        assert.equal(row?.status, 'pending');
      } else {
        assert.equal(row?.status, 'dead_letter');
      }
    }

    const deadLetterCount = await db.query('SELECT count(*)::int AS total FROM outbox_dead_letters WHERE message_id = $1', [message.id]);
    assert.equal(deadLetterCount.rows[0]?.total, 1);
    const snapshot = metrics.getSnapshot();
    assert.equal(snapshot.unsupported, 5);
    const unsupportedLogs = logger.entries.filter((entry) => entry.object.event === 'worker_message_unsupported');
    assert.equal(unsupportedLogs.length, 5);
    for (const entry of unsupportedLogs) {
      assert.equal(Object.hasOwn(entry.object, 'payload'), false);
      assert.equal(entry.object.type, 'membership.created');
    }
  });

  test('liveness and readiness reflect the runtime and database state', async () => {
    const db = requireDb();
    const registry = new OutboxDispatcherRegistry();
    const { runtime } = createRuntime(db, registry);

    const server = createHealthServer({
      database: db,
      getReadiness: () => {
        const state = runtime.getState();
        return { loopInitialized: state.loopInitialized, shutdownStarted: state.shutdownStarted };
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const liveness = await fetch(`${baseUrl}/health`);
      assert.equal(liveness.status, 200);
      const livenessBody = (await liveness.json()) as { service: string; status: string };
      assert.equal(livenessBody.service, 'worker');
      assert.equal(livenessBody.status, 'ok');

      const notReady = await fetch(`${baseUrl}/health/ready`);
      assert.equal(notReady.status, 503);
      const notReadyBody = (await notReady.json()) as { status: string; database: { status: string } };
      assert.equal(notReadyBody.status, 'unavailable');
      assert.equal(notReadyBody.database.status, 'ready');

      await runtime.start();
      const ready = await fetch(`${baseUrl}/health/ready`);
      assert.equal(ready.status, 200);
      const readyBody = (await ready.json()) as { status: string; service: string };
      assert.equal(readyBody.status, 'ready');
      assert.equal(readyBody.service, 'worker');

      await runtime.stop();
      const afterStop = await fetch(`${baseUrl}/health/ready`);
      assert.equal(afterStop.status, 503);

      const unknown = await fetch(`${baseUrl}/nope`);
      assert.equal(unknown.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
