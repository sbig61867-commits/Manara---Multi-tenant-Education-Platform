import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import {
  NoopOutboxEventPublisher,
  OUTBOX_DEFAULT_CLAIM_LEASE_MS,
  OutboxService,
  PostgresDeadLetterRepository,
  PostgresOutboxRepository,
} from '@manara/outbox';
import type { OutboxClock, OutboxEnqueueCommand, OutboxMessage } from '@manara/outbox';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

class TestClock implements OutboxClock {
  private current: Date;

  constructor(start: Date = new Date('2026-08-04T00:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('outbox persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let tenantA = '';
  let tenantB = '';
  let userA = '';
  let userB = '';

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE outbox_messages CASCADE');
    await database.query(
      "DELETE FROM institutions WHERE name IN ('Outbox University A', 'Outbox University B')",
    );
    await database.query(
      "DELETE FROM users WHERE email IN ('outbox-user-a@test.local', 'outbox-user-b@test.local')",
    );
    tenantA = randomUUID();
    tenantB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    await database.query(
      'INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)',
      [userA, 'outbox-user-a@test.local', userB, 'outbox-user-b@test.local'],
    );
    await database.query(
      'INSERT INTO institutions (id, name, type, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        tenantA,
        'Outbox University A',
        'university',
        'active',
        userA,
        tenantB,
        'Outbox University B',
        'university',
        'active',
        userB,
      ],
    );
  });

  beforeEach(async () => {
    await requireDb().query('TRUNCATE TABLE outbox_messages CASCADE');
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE outbox_messages CASCADE');
        await database.query(
          "DELETE FROM institutions WHERE name IN ('Outbox University A', 'Outbox University B')",
        );
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

  function createServices(db: PostgresDatabase, clock = new TestClock()): {
    repository: PostgresOutboxRepository;
    deadLetters: PostgresDeadLetterRepository;
    service: OutboxService;
    clock: TestClock;
  } {
    const repository = new PostgresOutboxRepository(db);
    const deadLetters = new PostgresDeadLetterRepository(db);
    const service = new OutboxService(repository, deadLetters, new NoopOutboxEventPublisher(), clock);
    return { repository, deadLetters, service, clock };
  }

  function createMessage(tenantId: string | null, overrides?: Partial<OutboxMessage>): OutboxMessage {
    const now = new Date('2026-08-04T00:00:00.000Z');
    return {
      id: randomUUID(),
      eventId: `${tenantId === null ? 'platform' : 'order'}:created:${tenantId ?? 'platform'}:${randomUUID()}`,
      source: tenantId === null ? 'platform' : 'order',
      type: 'created',
      scope: tenantId === null ? 'platform' : 'tenant',
      tenantId,
      payload: { orderId: 'order-1' },
      status: 'pending',
      attempts: 0,
      lastError: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function enqueueCommand(tenantId: string | null, overrides?: Partial<OutboxEnqueueCommand>): OutboxEnqueueCommand {
    return {
      scope: tenantId === null ? 'platform' : 'tenant',
      tenantId,
      eventSource: tenantId === null ? 'platform' : 'order',
      eventType: 'created',
      occurrenceId: randomUUID(),
      payload: { orderId: 'order-1' },
      ...overrides,
    };
  }

  test('outbox migration creates both tables with the expected columns', async () => {
    const db = requireDb();
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('outbox_messages', 'outbox_dead_letters')
       ORDER BY table_name`,
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), ['outbox_dead_letters', 'outbox_messages']);
    const messageColumns = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outbox_messages'
       ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      messageColumns.rows.map((row) => row.column_name),
      [
        'id',
        'event_id',
        'source',
        'type',
        'scope',
        'tenant_id',
        'status',
        'attempt_count',
        'payload',
        'metadata_json',
        'last_error',
        'lease_owner',
        'lease_expires_at',
        'next_attempt_at',
        'delivered_at',
        'created_at',
        'updated_at',
      ],
    );
    const deadLetterColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outbox_dead_letters'
       ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      deadLetterColumns.rows.map((row) => row.column_name),
      [
        'message_id',
        'event_id',
        'source',
        'type',
        'scope',
        'tenant_id',
        'attempt_count',
        'payload',
        'failure',
        'dead_lettered_at',
      ],
    );
  });

  test('outbox migration creates the required indexes and constraints', async () => {
    const db = requireDb();
    const messageIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'outbox_messages'`,
    );
    const byName = new Map(messageIndexes.rows.map((row) => [row.indexname, row.indexdef]));
    const eventIdIndex = byName.get('outbox_messages_event_id_unique');
    assert.ok(eventIdIndex);
    assert.match(eventIdIndex, /CREATE UNIQUE INDEX/);
    assert.match(eventIdIndex, /USING btree \(event_id\)/);
    const pendingDispatch = byName.get('outbox_messages_pending_dispatch_idx');
    assert.ok(pendingDispatch);
    assert.match(pendingDispatch, /USING btree \(tenant_id, status, next_attempt_at\)/);
    const leaseExpiry = byName.get('outbox_messages_lease_expiry_idx');
    assert.ok(leaseExpiry);
    assert.match(leaseExpiry, /USING btree \(lease_expires_at\)/);
    assert.match(leaseExpiry, /status = 'claimed'/);
    const tenantIndex = byName.get('outbox_messages_tenant_idx');
    assert.ok(tenantIndex);
    assert.match(tenantIndex, /USING btree \(tenant_id\)/);
    const nextAttempt = byName.get('outbox_messages_next_attempt_idx');
    assert.ok(nextAttempt);
    assert.match(nextAttempt, /USING btree \(next_attempt_at\)/);
    assert.match(nextAttempt, /status = 'pending'/);
    const deadLetterIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'outbox_dead_letters'`,
    );
    const deadLetterByName = new Map(deadLetterIndexes.rows.map((row) => [row.indexname, row.indexdef]));
    const deadLetterEventId = deadLetterByName.get('outbox_dead_letters_event_id_idx');
    assert.ok(deadLetterEventId);
    assert.match(deadLetterEventId, /USING btree \(event_id\)/);
  });

  test('outbox migration enforces scope, status, and platform tenant marking', async () => {
    const db = requireDb();
    const base = createMessage(tenantA, { eventId: `order:created:${tenantA}:scope-check` });
    await assert.rejects(
      db.query(
        `INSERT INTO outbox_messages (id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'global', $5, 'pending', 0, '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL, NULL, NULL, now(), now())`,
        [base.id, base.eventId, base.source, base.type, tenantA],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'outbox_messages_scope_check',
    );
    await assert.rejects(
      db.query(
        `INSERT INTO outbox_messages (id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'tenant', $5, 'bogus', 0, '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL, NULL, NULL, now(), now())`,
        [randomUUID(), `${base.eventId}-status`, base.source, base.type, tenantA],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'outbox_messages_status_check',
    );
    await assert.rejects(
      db.query(
        `INSERT INTO outbox_messages (id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'platform', $5, 'pending', 0, '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL, NULL, NULL, now(), now())`,
        [randomUUID(), `${base.eventId}-platform-mark`, base.source, base.type, tenantA],
      ),
      (error: unknown) =>
        (error as { constraint?: string }).constraint === 'outbox_messages_platform_tenant_mark_check',
    );
  });

  test('enqueue persists a message with pending status and empty metadata', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const message = createMessage(tenantA);
    const inserted = await repository.insert(message);
    assert.equal(inserted, true);
    const [row] = (
      await db.query<{ status: string; metadata_json: Record<string, unknown>; tenant_id: string | null }>(
        'SELECT status, metadata_json, tenant_id FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.status, 'pending');
    assert.deepEqual(row.metadata_json, {});
    assert.equal(row.tenant_id, tenantA);
  });

  test('duplicate event ids are rejected at the repository and database level', async () => {
    const db = requireDb();
    const { repository, service } = createServices(db);
    const message = createMessage(tenantA, { eventId: `order:created:${tenantA}:dup-1` });
    assert.equal(await repository.insert(message), true);
    assert.equal(await repository.insert(message), false);
    await assert.rejects(
      db.query(
        `INSERT INTO outbox_messages (id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'tenant', $5, 'pending', 0, '{}'::jsonb, '{}'::jsonb, NULL, NULL, NULL, NULL, NULL, now(), now())`,
        [randomUUID(), message.eventId, message.source, message.type, tenantA],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'outbox_messages_event_id_unique',
    );
    const outcome = await service.enqueue(
      enqueueCommand(tenantA, { eventSource: 'order', eventType: 'created', occurrenceId: 'dup-1' }),
    );
    assert.equal(outcome.status, 'already_exists');
  });

  test('lookup by event id round-trips the full message', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const message = createMessage(tenantA, {
      eventId: `order:created:${tenantA}:lookup-1`,
      source: 'order',
      type: 'created',
      payload: { orderId: 'order-77', tags: ['a', 'b'] },
      createdAt: new Date('2026-08-04T08:00:00.000Z'),
      updatedAt: new Date('2026-08-04T08:00:00.000Z'),
    });
    await repository.insert(message);
    const found = await repository.findByEventId(message.eventId);
    assert.notEqual(found, null);
    assert.equal(found?.id, message.id);
    assert.equal(found?.eventId, message.eventId);
    assert.equal(found?.source, 'order');
    assert.equal(found?.type, 'created');
    assert.equal(found?.scope, 'tenant');
    assert.equal(found?.tenantId, tenantA);
    assert.equal(found?.status, 'pending');
    assert.equal(found?.attempts, 0);
    assert.deepEqual(found?.payload, { orderId: 'order-77', tags: ['a', 'b'] });
    assert.equal(found?.lastError, null);
    assert.equal(found?.leaseExpiresAt, null);
    assert.equal(found?.nextAttemptAt, null);
  });

  test('enqueue joins the ambient transaction: commits and rolls back with the caller', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const committed = createMessage(tenantA, { eventId: `order:created:${tenantA}:tx-1` });
    const rolledBack = createMessage(tenantA, { eventId: `order:created:${tenantA}:tx-2` });
    await assert.rejects(
      db.withTransaction(async () => {
        await repository.insert(committed);
        await repository.insert(rolledBack);
        throw new Error('business write failed');
      }),
      /business write failed/,
    );
    assert.equal(await repository.findByEventId(committed.eventId), null);
    assert.equal(await repository.findByEventId(rolledBack.eventId), null);
    await db.withTransaction(async () => {
      await repository.insert(committed);
    });
    assert.notEqual(await repository.findByEventId(committed.eventId), null);
  });

  test('claimPending leases due messages and never double-claims', async () => {
    const db = requireDb();
    const { repository, service, clock } = createServices(db);
    const message = createMessage(tenantA);
    await repository.insert(message);
    const claimed = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.message.id, message.id);
    assert.equal(claimed[0]?.message.status, 'claimed');
    const [row] = (
      await db.query<{ status: string; lease_owner: string | null; lease_expires_at: Date | null }>(
        'SELECT status, lease_owner, lease_expires_at FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.status, 'claimed');
    assert.ok(typeof row.lease_owner === 'string' && row.lease_owner.length > 0);
    assert.equal(row.lease_expires_at?.getTime(), clock.now().getTime() + OUTBOX_DEFAULT_CLAIM_LEASE_MS);
    const again = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.equal(again.length, 0);
  });

  test('concurrent claims never deliver the same message twice', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const messages = Array.from({ length: 10 }, (_, index) =>
      createMessage(tenantA, { eventId: `order:created:${tenantA}:concurrent-${index}` }),
    );
    for (const message of messages) {
      await repository.insert(message);
    }
    const first = new PostgresOutboxRepository(db);
    const second = new PostgresOutboxRepository(db);
    const now = new Date('2026-08-04T00:00:00.000Z');
    const leaseExpiresAt = new Date(now.getTime() + OUTBOX_DEFAULT_CLAIM_LEASE_MS);
    const [fromFirst, fromSecond] = await Promise.all([
      first.claimPending({ scope: 'tenant', tenantId: tenantA, limit: 10 }, now, leaseExpiresAt),
      second.claimPending({ scope: 'tenant', tenantId: tenantA, limit: 10 }, now, leaseExpiresAt),
    ]);
    const claimedIds = [...fromFirst.map((item) => item.id), ...fromSecond.map((item) => item.id)];
    assert.equal(claimedIds.length, 10);
    assert.equal(new Set(claimedIds).size, 10);
    const claimedRows = await db.query<{ id: string; lease_owner: string | null }>(
      "SELECT id, lease_owner FROM outbox_messages WHERE status = 'claimed'",
    );
    assert.equal(claimedRows.rows.length, 10);
    assert.ok(claimedRows.rows.every((row) => typeof row.lease_owner === 'string' && row.lease_owner.length > 0));
  });

  test('lease safety: only the claiming owner can complete a transition', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const message = createMessage(tenantA);
    await repository.insert(message);
    const now = new Date('2026-08-04T00:00:00.000Z');
    const withinLease = new Date(now.getTime() + 60_000);
    const [claimed] = await repository.claimPending(
      { scope: 'tenant', tenantId: tenantA, limit: 10 },
      now,
      new Date(now.getTime() + OUTBOX_DEFAULT_CLAIM_LEASE_MS),
    );
    const other = new PostgresOutboxRepository(db);
    assert.equal(await other.markDelivered(claimed?.id ?? 'missing', withinLease), false);
    assert.equal(await other.markFailed(claimed?.id ?? 'missing', {
      code: 'outbox.delivery_failed',
      message: 'stolen attempt',
      retryable: true,
      occurredAt: withinLease,
    }), false);
    assert.equal(await repository.markDelivered(claimed?.id ?? 'missing', withinLease), true);
    const [row] = (
      await db.query<{ status: string; delivered_at: Date | null }>(
        'SELECT status, delivered_at FROM outbox_messages WHERE id = $1',
        [claimed?.id ?? 'missing'],
      )
    ).rows;
    assert.equal(row?.status, 'delivered');
    assert.ok(row?.delivered_at instanceof Date);
  });

  test('lease expiration and stale release return messages to pending', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const message = createMessage(tenantA);
    await repository.insert(message);
    const claimedAt = new Date('2026-08-04T00:00:00.000Z');
    const shortLease = new Date(claimedAt.getTime() + 1_000);
    const [claimed] = await repository.claimPending({ scope: 'tenant', tenantId: tenantA }, claimedAt, shortLease);
    assert.ok(claimed);
    assert.equal(await repository.releaseStaleClaims(new Date(claimedAt.getTime() + 500)), 0);
    const released = await repository.releaseStaleClaims(new Date(claimedAt.getTime() + 1_001));
    assert.equal(released, 1);
    const [row] = (
      await db.query<{ status: string; lease_owner: string | null; lease_expires_at: Date | null }>(
        'SELECT status, lease_owner, lease_expires_at FROM outbox_messages WHERE id = $1',
        [message.id],
      )
    ).rows;
    assert.equal(row?.status, 'pending');
    assert.equal(row?.lease_owner, null);
    assert.equal(row?.lease_expires_at, null);
    const [reclaimed] = await repository.claimPending(
      { scope: 'tenant', tenantId: tenantA },
      new Date(claimedAt.getTime() + 1_001),
      new Date(claimedAt.getTime() + 1_001 + OUTBOX_DEFAULT_CLAIM_LEASE_MS),
    );
    assert.equal(reclaimed?.id, message.id);
  });

  test('success transition marks the message delivered and is idempotent', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'deliver-1' }));
    const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.ok(claimed);
    const outcome = await service.markDelivered(claimed.message.id);
    assert.equal(outcome.status, 'delivered');
    const [row] = (
      await db.query<{ status: string; delivered_at: Date | null; lease_owner: string | null }>(
        'SELECT status, delivered_at, lease_owner FROM outbox_messages WHERE id = $1',
        [claimed.message.id],
      )
    ).rows;
    assert.equal(row?.status, 'delivered');
    assert.ok(row?.delivered_at instanceof Date);
    assert.equal(row?.lease_owner, null);
    const again = await service.markDelivered(claimed.message.id);
    assert.equal(again.status, 'already_delivered');
  });

  test('retry transition reschedules the message with a future next_attempt_at', async () => {
    const db = requireDb();
    const { service, clock } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'retry-1' }));
    const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.ok(claimed);
    const failed = await service.markFailed(claimed.message.id, {
      code: 'order.dispatch_timeout',
      message: 'upstream timeout',
      retryable: true,
    });
    assert.equal(failed.status, 'failure_recorded');
    const [failedRow] = (
      await db.query<{ status: string; attempt_count: number; last_error: Record<string, unknown> | null }>(
        'SELECT status, attempt_count, last_error FROM outbox_messages WHERE id = $1',
        [claimed.message.id],
      )
    ).rows;
    assert.equal(failedRow?.status, 'failed');
    assert.equal(failedRow?.attempt_count, 1);
    assert.equal(failedRow?.last_error?.code, 'order.dispatch_timeout');
    assert.equal(failedRow?.last_error?.message, 'upstream timeout');
    const retry = await service.scheduleRetry(claimed.message.id);
    assert.equal(retry.status, 'scheduled');
    const [scheduledRow] = (
      await db.query<{ status: string; next_attempt_at: Date | null }>(
        'SELECT status, next_attempt_at FROM outbox_messages WHERE id = $1',
        [claimed.message.id],
      )
    ).rows;
    assert.equal(scheduledRow?.status, 'pending');
    assert.equal(scheduledRow?.next_attempt_at?.getTime(), clock.now().getTime() + 60_000);
  });

  test('exponential backoff applies deterministic delays and exhausts at five attempts', async () => {
    const db = requireDb();
    const { service, clock } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'backoff-1' }));
    const delays = [60_000, 300_000, 900_000, 3_600_000];
    let messageId: string | undefined;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
      assert.equal(claimed.length, 1);
      messageId = claimed[0]?.message.id;
      const failed = await service.markFailed(messageId ?? 'missing', {
        code: 'order.dispatch_timeout',
        message: `boom-${attempt}`,
        retryable: true,
      });
      assert.equal(failed.status, 'failure_recorded');
      const retry = await service.scheduleRetry(messageId ?? 'missing');
      if (attempt < 5) {
        assert.equal(retry.status, 'scheduled');
        if (retry.status === 'scheduled') {
          const delayMs = delays[attempt - 1] as number;
          assert.equal(retry.message.nextAttemptAt?.getTime(), clock.now().getTime() + delayMs);
        }
        clock.advanceBy(delays[attempt - 1] as number);
      } else {
        assert.equal(retry.status, 'exhausted');
      }
    }
    const [row] = (
      await db.query<{ status: string; attempt_count: number }>(
        'SELECT status, attempt_count FROM outbox_messages WHERE id = $1',
        [messageId ?? 'missing'],
      )
    ).rows;
    assert.equal(row?.status, 'failed');
    assert.equal(row?.attempt_count, 5);
  });

  test('dead-letter transition persists the record exactly once', async () => {
    const db = requireDb();
    const { service, deadLetters } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'dead-letter-1' }));
    const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.ok(claimed);
    await service.markFailed(claimed.message.id, {
      code: 'order.dispatch_timeout',
      message: 'boom',
      retryable: false,
    });
    const outcome = await service.moveToDeadLetter(claimed.message.id);
    assert.equal(outcome.status, 'dead_lettered');
    const [messageRow] = (
      await db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [claimed.message.id])
    ).rows;
    assert.equal(messageRow?.status, 'dead_letter');
    const [recordRow] = (
      await db.query<{
        event_id: string;
        tenant_id: string | null;
        attempt_count: number;
        failure: Record<string, unknown>;
      }>('SELECT event_id, tenant_id, attempt_count, failure FROM outbox_dead_letters WHERE message_id = $1', [
        claimed.message.id,
      ])
    ).rows;
    assert.ok(recordRow);
    assert.equal(recordRow.event_id, claimed.message.eventId);
    assert.equal(recordRow.tenant_id, tenantA);
    assert.equal(recordRow.attempt_count, 1);
    assert.equal(recordRow.failure.code, 'order.dispatch_timeout');
    const readBack = await deadLetters.findById(claimed.message.id);
    assert.notEqual(readBack, null);
    assert.equal(readBack?.failure.code, 'order.dispatch_timeout');
    assert.equal(readBack?.failure.retryable, false);
    const again = await service.moveToDeadLetter(claimed.message.id);
    assert.equal(again.status, 'already_dead_lettered');
    const count = await db.query('SELECT count(*)::int AS total FROM outbox_dead_letters');
    assert.equal(count.rows[0]?.total, 1);
  });

  test('tenant claims are isolated and never leak platform messages', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'iso-a-1' }));
    await service.enqueue(enqueueCommand(tenantB, { occurrenceId: 'iso-b-1' }));
    await service.enqueue(enqueueCommand(null, { occurrenceId: 'iso-plat-1' }));
    const tenantAClaimed = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
    assert.equal(tenantAClaimed.length, 1);
    assert.equal(tenantAClaimed[0]?.message.tenantId, tenantA);
    const tenantBClaimed = await service.claimPending({ scope: 'tenant', tenantId: tenantB });
    assert.equal(tenantBClaimed.length, 1);
    assert.equal(tenantBClaimed[0]?.message.tenantId, tenantB);
    const platformClaimed = await service.claimPending({ scope: 'platform' });
    assert.equal(platformClaimed.length, 1);
    assert.equal(platformClaimed[0]?.message.tenantId, null);
  });

  test('platform messages persist with a null tenant and claim under the platform scope', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await service.enqueue(
      enqueueCommand(null, { occurrenceId: 'platform-1', eventSource: 'notification', eventType: 'broadcast' }),
    );
    const [row] = (
      await db.query<{ scope: string; tenant_id: string | null; event_id: string }>(
        'SELECT scope, tenant_id, event_id FROM outbox_messages',
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.scope, 'platform');
    assert.equal(row.tenant_id, null);
    const claimed = await service.claimPending({ scope: 'platform' });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.message.eventId, row.event_id);
  });

  test('sensitive payload keys are redacted before persistence', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await service.enqueue(
      enqueueCommand(tenantA, {
        occurrenceId: 'redact-1',
        payload: { orderId: 'o-1', sessionToken: 'raw-token', apiKey: 'raw-key' },
      }),
    );
    const [row] = (
      await db.query<{ payload: Record<string, unknown> }>('SELECT payload FROM outbox_messages')
    ).rows;
    assert.ok(row);
    assert.equal(row.payload.orderId, 'o-1');
    assert.equal(row.payload.sessionToken, '[REDACTED]');
    assert.equal(row.payload.apiKey, '[REDACTED]');
  });

  test('a full lifecycle through the service reaches the dead letter exactly once', async () => {
    const db = requireDb();
    const { service, deadLetters, clock } = createServices(db);
    await service.enqueue(enqueueCommand(tenantA, { occurrenceId: 'lifecycle-1' }));
    const delays = [60_000, 300_000, 900_000, 3_600_000];
    let messageId: string | undefined;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await service.claimPending({ scope: 'tenant', tenantId: tenantA });
      messageId = claimed[0]?.message.id;
      await service.markFailed(messageId ?? 'missing', new Error(`boom-${attempt}`));
      const retry = await service.scheduleRetry(messageId ?? 'missing');
      if (attempt < 5) {
        assert.equal(retry.status, 'scheduled');
        clock.advanceBy(delays[attempt - 1] as number);
      } else {
        assert.equal(retry.status, 'exhausted');
      }
    }
    const deadLettered = await service.moveToDeadLetter(messageId ?? 'missing');
    assert.equal(deadLettered.status, 'dead_lettered');
    const record = await deadLetters.findById(messageId ?? 'missing');
    assert.notEqual(record, null);
    assert.equal(record?.attempts, 5);
    assert.equal(record?.payload.orderId, 'order-1');
    const again = await service.moveToDeadLetter(messageId ?? 'missing');
    assert.equal(again.status, 'already_dead_lettered');
  });
});
