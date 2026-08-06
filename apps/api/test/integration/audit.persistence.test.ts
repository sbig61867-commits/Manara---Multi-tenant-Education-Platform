import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { AlsAuditContextResolver } from '../../src/audit/adapters/als-audit-context.resolver.js';
import { PostgresAuditRepository } from '../../src/audit/adapters/postgres-audit.repository.js';
import { AuditService } from '../../src/audit/application/audit.service.js';
import { CrossTenantReadDeniedError } from '../../src/audit/domain/errors.js';
import type { AuditEvent } from '../../src/audit/domain/types.js';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

describe('audit persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let tenantA = '';
  let tenantB = '';
  let userA = '';
  let userB = '';

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE audit_log CASCADE');
    await database.query(
      "DELETE FROM institutions WHERE name IN ('Audit University A', 'Audit University B')",
    );
    await database.query(
      "DELETE FROM users WHERE email IN ('audit-user-a@test.local', 'audit-user-b@test.local')",
    );
    tenantA = randomUUID();
    tenantB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    await database.query(
      'INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)',
      [userA, 'audit-user-a@test.local', userB, 'audit-user-b@test.local'],
    );
    await database.query(
      'INSERT INTO institutions (id, name, type, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        tenantA,
        'Audit University A',
        'university',
        'active',
        userA,
        tenantB,
        'Audit University B',
        'university',
        'active',
        userB,
      ],
    );
  });

  beforeEach(async () => {
    const db = requireDb();
    await db.query('TRUNCATE TABLE audit_log CASCADE');
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE audit_log CASCADE');
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

  function createServices(db: PostgresDatabase): {
    repository: PostgresAuditRepository;
    service: AuditService;
  } {
    const repository = new PostgresAuditRepository(db);
    const service = new AuditService(repository, new AlsAuditContextResolver());
    return { repository, service };
  }

  async function recordTenantAction(
    db: PostgresDatabase,
    tenantId: string,
    overrides?: Partial<Parameters<AuditService['recordTenantAction']>[0]>,
  ): Promise<AuditEvent> {
    const { service } = createServices(db);
    return AlsAuditContextResolver.runWithAuditContext({ tenantId, requestId: 'req-1' }, () =>
      service.recordTenantAction({
        action: 'user.login',
        actor: { id: userA, type: 'user' },
        target: { type: 'user', id: userA },
        requestId: 'req-1',
        ...overrides,
      }),
    );
  }

  async function queryAsTenant<T>(
    db: PostgresDatabase,
    tenantId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return AlsAuditContextResolver.runWithAuditContext({ tenantId }, work);
  }

  test('audit migration creates the audit_log table with a default partition', async () => {
    const db = requireDb();
    const table = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'audit_log'`,
    );
    assert.equal(table.rows.length, 1);
    const columns = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_log'
       ORDER BY ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.deepEqual(names, [
      'id',
      'scope',
      'tenant_id',
      'actor_user_id',
      'actor_platform_role',
      'action',
      'target_entity_type',
      'target_entity_id',
      'reason',
      'request_id',
      'metadata_json',
      'occurred_at',
    ]);
    const partition = await db.query<{ relname: string }>(
      `SELECT child.relname FROM pg_inherits
       JOIN pg_class child ON child.oid = pg_inherits.inhrelid
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       WHERE parent.relname = 'audit_log'`,
    );
    assert.deepEqual(partition.rows.map((row) => row.relname).sort(), ['audit_log_default']);
  });

  test('audit migration creates the required indexes', async () => {
    const db = requireDb();
    const indexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'audit_log'`,
    );
    const byName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    const tenantIndex = byName.get('audit_log_tenant_id_occurred_at_idx');
    assert.ok(tenantIndex);
    assert.match(tenantIndex, /USING btree \(tenant_id, occurred_at\)/);
    const actorIndex = byName.get('audit_log_actor_user_id_occurred_at_idx');
    assert.ok(actorIndex);
    assert.match(actorIndex, /USING btree \(actor_user_id, occurred_at\)/);
    const targetIndex = byName.get('audit_log_target_entity_idx');
    assert.ok(targetIndex);
    assert.match(targetIndex, /USING btree \(target_entity_type, target_entity_id, occurred_at\)/);
    const requestIndex = byName.get('audit_log_request_id_idx');
    assert.ok(requestIndex);
    assert.match(requestIndex, /USING btree \(request_id\)/);
  });

  test('tenant events persist through the service and round-trip', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    const event = await recordTenantAction(db, tenantA, {
      action: 'role.updated',
      target: { type: 'role', id: randomUUID() },
      metadata: { attemptCount: 3, note: 'ok' },
    });
    const [row] = (
      await db.query<{ action: string; tenant_id: string | null; scope: string; metadata_json: Record<string, unknown> }>(
        'SELECT action, tenant_id, scope, metadata_json FROM audit_log WHERE id = $1',
        [event.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.action, 'role.updated');
    assert.equal(row.tenant_id, tenantA);
    assert.equal(row.scope, 'tenant');
    assert.deepEqual(row.metadata_json, { attemptCount: 3, note: 'ok' });
    const [read] = await queryAsTenant(db, tenantA, () =>
      service.queryAuditHistory({ action: 'role.updated' }),
    );
    assert.ok(read);
    assert.equal(read.id, event.id);
    assert.equal(read.tenantId, tenantA);
    assert.deepEqual(read.metadata, { attemptCount: 3, note: 'ok' });
  });

  test('sensitive metadata is redacted before persistence', async () => {
    const db = requireDb();
    const event = await recordTenantAction(db, tenantA, {
      action: 'auth.password_changed',
      metadata: { token: 'secret-token', fileName: 'ok.txt' },
    });
    const [row] = (
      await db.query<{ metadata_json: Record<string, unknown> }>(
        'SELECT metadata_json FROM audit_log WHERE id = $1',
        [event.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.metadata_json.token, '[REDACTED]');
    assert.equal(row.metadata_json.fileName, 'ok.txt');
  });

  test('platform events are explicitly marked with a null tenant and require a reason', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    const event = await service.recordPlatformAction({
      action: 'plan.retired',
      actor: { id: 'scheduler', type: 'system' },
      target: { type: 'plan', id: randomUUID() },
      reason: 'retirement window reached',
      requestId: 'req-platform',
    });
    const [row] = (
      await db.query<{
        scope: string;
        tenant_id: string | null;
        actor_user_id: string | null;
        actor_platform_role: string | null;
        reason: string | null;
        request_id: string;
      }>(
        'SELECT scope, tenant_id, actor_user_id, actor_platform_role, reason, request_id FROM audit_log WHERE id = $1',
        [event.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.scope, 'platform');
    assert.equal(row.tenant_id, null);
    assert.equal(row.actor_user_id, null);
    assert.equal(row.actor_platform_role, 'scheduler');
    assert.equal(row.reason, 'retirement window reached');
    assert.equal(row.request_id, 'req-platform');
  });

  test('system actors persist via actor_platform_role and round-trip for tenant events', async () => {
    const db = requireDb();
    const { service, repository } = createServices(db);
    const event = await AlsAuditContextResolver.runWithAuditContext({ tenantId: tenantA }, () =>
      service.recordTenantAction({
        action: 'attendance.rollup',
        actor: { id: 'rollup-worker', type: 'system' },
        target: { type: 'attendance', id: randomUUID() },
      }),
    );
    const [row] = (
      await db.query<{ actor_user_id: string | null; actor_platform_role: string | null }>(
        'SELECT actor_user_id, actor_platform_role FROM audit_log WHERE id = $1',
        [event.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.actor_user_id, null);
    assert.equal(row.actor_platform_role, 'rollup-worker');
    const [read] = await repository.query({ tenantId: tenantA, limit: 10 });
    assert.ok(read);
    assert.equal(read.actor.type, 'system');
    assert.equal(read.actor.id, 'rollup-worker');
  });

  test('cross-tenant privileged events store actor, tenant, action, reason, request id, and timestamp', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    const occurredAt = new Date('2026-08-04T10:00:00.000Z');
    const targetTenantId = tenantB;
    const event = await service.recordCrossTenantAction({
      action: 'tenant.suspended',
      actor: { id: userA, type: 'user' },
      target: { type: 'tenant', id: targetTenantId },
      targetTenantId,
      reason: 'unpaid invoices',
      requestId: 'req-cross',
      occurredAt,
    });
    const [row] = (
      await db.query<{
        scope: string;
        tenant_id: string | null;
        actor_user_id: string | null;
        action: string;
        reason: string | null;
        request_id: string;
        occurred_at: Date;
      }>(
        'SELECT scope, tenant_id, actor_user_id, action, reason, request_id, occurred_at FROM audit_log WHERE id = $1',
        [event.id],
      )
    ).rows;
    assert.ok(row);
    assert.equal(row.scope, 'cross_tenant');
    assert.equal(row.tenant_id, targetTenantId);
    assert.equal(row.actor_user_id, userA);
    assert.equal(row.action, 'tenant.suspended');
    assert.equal(row.reason, 'unpaid invoices');
    assert.equal(row.request_id, 'req-cross');
    assert.equal(row.occurred_at.toISOString(), occurredAt.toISOString());
  });

  test('the database rejects a platform row that carries a tenant id', async () => {
    const db = requireDb();
    await assert.rejects(
      db.query(
        `INSERT INTO audit_log (id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at)
         VALUES ($1, 'platform', $2, NULL, 'breaker', 'break.glass', 'tenant', $3, 'test', 'req-1', '{}'::jsonb, now())`,
        [randomUUID(), tenantA, tenantA],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'audit_log_platform_tenant_mark_check',
    );
  });

  test('audit queries are tenant-isolated', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    await recordTenantAction(db, tenantA, { action: 'user.login' });
    await recordTenantAction(db, tenantB, { action: 'user.login' });
    const tenantAList = await new PostgresAuditRepository(db).query({ tenantId: tenantA, limit: 10 });
    assert.equal(tenantAList.length, 1);
    assert.equal(tenantAList[0]?.tenantId, tenantA);
    const tenantBList = await repository.query({ tenantId: tenantB, limit: 10 });
    assert.equal(tenantBList.length, 1);
    assert.equal(tenantBList[0]?.tenantId, tenantB);
  });

  test('a repository query without a tenant id fails closed with zero rows', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    await recordTenantAction(db, tenantA);
    const rows = await repository.query({});
    assert.deepEqual(rows, []);
  });

  test('cross-tenant reads are rejected by the service', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await recordTenantAction(db, tenantA);
    await assert.rejects(
      () =>
        AlsAuditContextResolver.runWithAuditContext({ tenantId: tenantA }, () =>
          service.queryAuditHistory({ tenantId: tenantB }),
        ),
      (error: unknown) => error instanceof CrossTenantReadDeniedError,
    );
    await assert.rejects(
      () =>
        AlsAuditContextResolver.runWithAuditContext({ tenantId: tenantA }, () =>
          service.queryAuditHistory({ scope: 'cross_tenant' }),
        ),
      (error: unknown) => error instanceof CrossTenantReadDeniedError,
    );
  });

  test('update and delete are impossible at the database level', async () => {
    const db = requireDb();
    const event = await recordTenantAction(db, tenantA);
    await assert.rejects(
      db.query('UPDATE audit_log SET reason = $2 WHERE id = $1', [event.id, 'tampered']),
      (error: unknown) => (error as Error).message.includes('audit_log is append-only'),
    );
    await assert.rejects(
      db.query('DELETE FROM audit_log WHERE id = $1', [event.id]),
      (error: unknown) => (error as Error).message.includes('audit_log is append-only'),
    );
    const [row] = (
      await db.query<{ action: string }>('SELECT action FROM audit_log WHERE id = $1', [event.id])
    ).rows;
    assert.equal(row?.action, 'user.login');
  });

  test('time-range queries filter by occurred_at and respect the limit', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    const first = await recordTenantAction(db, tenantA, {
      action: 'role.created',
      occurredAt: new Date('2026-08-04T12:00:00.000Z'),
    });
    await recordTenantAction(db, tenantA, {
      action: 'user.login',
      occurredAt: new Date('2026-08-04T13:00:00.000Z'),
    });
    await recordTenantAction(db, tenantA, {
      action: 'role.updated',
      occurredAt: new Date('2026-08-04T14:00:00.000Z'),
    });
    const inRange = await queryAsTenant(db, tenantA, () =>
      service.queryAuditHistory({
        from: new Date('2026-08-04T12:30:00.000Z'),
        to: new Date('2026-08-04T13:30:00.000Z'),
      }),
    );
    assert.equal(inRange.length, 1);
    assert.equal(inRange[0]?.action, 'user.login');
    const bounded = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ limit: 2 }));
    assert.equal(bounded.length, 2);
    assert.equal(bounded[0]?.action, 'role.updated');
    const before = await queryAsTenant(db, tenantA, () =>
      service.queryAuditHistory({ to: new Date('2026-08-04T12:30:00.000Z') }),
    );
    assert.equal(before.length, 1);
    assert.equal(before[0]?.id, first.id);
  });

  test('actor and target filters work against the persisted rows', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    const targetId = randomUUID();
    await recordTenantAction(db, tenantA, { action: 'role.assigned', target: { type: 'role', id: targetId } });
    await recordTenantAction(db, tenantA, { action: 'user.login' });
    const byActor = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ actorId: userA }));
    assert.equal(byActor.length, 2);
    const byTargetType = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ targetType: 'role' }));
    assert.equal(byTargetType.length, 1);
    const byTargetId = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ targetId }));
    assert.equal(byTargetId.length, 1);
    assert.equal(byTargetId[0]?.action, 'role.assigned');
    const byAction = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ action: 'user.login' }));
    assert.equal(byAction.length, 1);
  });

  test('audit events are immutable even when read back from the database', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await recordTenantAction(db, tenantA);
    const [read] = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({}));
    assert.ok(read);
    assert.ok(Object.isFrozen(read));
    assert.ok(Object.isFrozen(read.actor));
    assert.ok(Object.isFrozen(read.target));
    assert.ok(Object.isFrozen(read.metadata));
  });

  test('platform queries return only platform events with a null tenant', async () => {
    const db = requireDb();
    const { repository, service } = createServices(db);
    await recordTenantAction(db, tenantA, { action: 'user.login' });
    await service.recordPlatformAction({
      action: 'plan.retired',
      actor: { id: 'scheduler', type: 'system' },
      target: { type: 'plan', id: randomUUID() },
      reason: 'retirement window reached',
      requestId: 'req-p1',
    });
    const platform = await repository.queryPlatform({ limit: 10 });
    assert.equal(platform.length, 1);
    assert.equal(platform[0]?.scope, 'platform');
    assert.equal(platform[0]?.tenantId, null);
    assert.equal(platform[0]?.action, 'plan.retired');
    const tenant = await repository.query({ tenantId: tenantA, limit: 10 });
    assert.equal(tenant.length, 1);
    assert.equal(tenant[0]?.scope, 'tenant');
  });

  test('platform queries filter by actor platform role and request id', async () => {
    const db = requireDb();
    const { repository, service } = createServices(db);
    await service.recordPlatformAction({
      action: 'plan.retired',
      actor: { id: 'scheduler', type: 'system' },
      target: { type: 'plan', id: randomUUID() },
      reason: 'retirement window reached',
      requestId: 'req-p1',
    });
    await service.recordPlatformAction({
      action: 'tenant.frozen',
      actor: { id: 'fraud-scanner', type: 'system' },
      target: { type: 'tenant', id: randomUUID() },
      reason: 'anomaly detected',
      requestId: 'req-p2',
    });
    const byRole = await repository.queryPlatform({ actorPlatformRole: 'scheduler' });
    assert.equal(byRole.length, 1);
    assert.equal(byRole[0]?.action, 'plan.retired');
    const byRequest = await repository.queryPlatform({ requestId: 'req-p2' });
    assert.equal(byRequest.length, 1);
    assert.equal(byRequest[0]?.action, 'tenant.frozen');
    const noMatch = await repository.queryPlatform({ requestId: 'nope' });
    assert.deepEqual(noMatch, []);
  });

  test('tenant queries filter by actor user id and request id', async () => {
    const db = requireDb();
    const { service } = createServices(db);
    await recordTenantAction(db, tenantA, { action: 'user.login', requestId: 'req-a1' });
    await recordTenantAction(db, tenantA, {
      action: 'role.created',
      actor: { id: userB, type: 'user' },
      requestId: 'req-a2',
    });
    const byUser = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ actorUserId: userB }));
    assert.equal(byUser.length, 1);
    assert.equal(byUser[0]?.action, 'role.created');
    const byRequest = await queryAsTenant(db, tenantA, () => service.queryAuditHistory({ requestId: 'req-a2' }));
    assert.equal(byRequest.length, 1);
    assert.equal(byRequest[0]?.action, 'role.created');
  });

  test('findTenantEvent scopes the lookup to the given tenant', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const eventA = await recordTenantAction(db, tenantA, { action: 'user.login' });
    await recordTenantAction(db, tenantB, { action: 'user.login' });
    const found = await repository.findTenantEvent(eventA.id, tenantA);
    assert.ok(found);
    assert.equal(found.id, eventA.id);
    assert.equal(found.scope, 'tenant');
    const crossTenant = await repository.findTenantEvent(eventA.id, tenantB);
    assert.equal(crossTenant, null);
    const unknown = await repository.findTenantEvent('00000000-0000-4000-8000-000000000000', tenantA);
    assert.equal(unknown, null);
  });

  test('findPlatformEvent returns only platform events', async () => {
    const db = requireDb();
    const { repository, service } = createServices(db);
    const platform = await service.recordPlatformAction({
      action: 'plan.retired',
      actor: { id: 'scheduler', type: 'system' },
      target: { type: 'plan', id: randomUUID() },
      reason: 'retirement window reached',
      requestId: 'req-p1',
    });
    const tenantEvent = await recordTenantAction(db, tenantA, { action: 'user.login' });
    const found = await repository.findPlatformEvent(platform.id);
    assert.ok(found);
    assert.equal(found.id, platform.id);
    assert.equal(found.scope, 'platform');
    assert.equal(await repository.findPlatformEvent(tenantEvent.id), null);
    assert.equal(await repository.findPlatformEvent('00000000-0000-4000-8000-000000000000'), null);
  });

  test('cursor pagination orders by occurred_at desc and id desc', async () => {
    const db = requireDb();
    const { repository } = createServices(db);
    const first = await recordTenantAction(db, tenantA, {
      action: 'one',
      occurredAt: new Date('2026-08-04T12:00:00.000Z'),
    });
    const second = await recordTenantAction(db, tenantA, {
      action: 'two',
      occurredAt: new Date('2026-08-04T13:00:00.000Z'),
    });
    const third = await recordTenantAction(db, tenantA, {
      action: 'three',
      occurredAt: new Date('2026-08-04T14:00:00.000Z'),
    });
    const full = await repository.query({ tenantId: tenantA, limit: 10 });
    assert.deepEqual(
      full.map((event) => event.action),
      ['three', 'two', 'one'],
    );
    const page = await repository.query({
      tenantId: tenantA,
      limit: 2,
      beforeOccurredAt: third.occurredAt,
      beforeId: third.id,
    });
    assert.deepEqual(
      page.map((event) => event.action),
      ['two', 'one'],
    );
    const beforeSecond = await repository.query({
      tenantId: tenantA,
      limit: 1,
      beforeOccurredAt: second.occurredAt,
      beforeId: second.id,
    });
    assert.deepEqual(
      beforeSecond.map((event) => event.action),
      ['one'],
    );
    assert.equal(beforeSecond[0]?.id, first.id);
  });
});
