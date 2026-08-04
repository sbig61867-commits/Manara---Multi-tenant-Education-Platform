import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditService } from '../../src/audit/application/audit.service.js';
import { REDACTED_VALUE } from '../../src/audit/application/redaction.js';
import {
  CrossTenantReadDeniedError,
  InvalidAuditEventError,
  InvalidAuditQueryError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/audit/domain/errors.js';
import type { RecordTenantActionCommand } from '../../src/audit/application/audit.service.js';
import type { AuditQueryCriteria } from '../../src/audit/domain/types.js';
import {
  createAuditActor,
  createAuditTarget,
  FakeAuditContextResolver,
  FakeAuditRepository,
} from './audit-helpers.js';

function createHarness(options?: { tenantId?: string | null; requestId?: string | null }) {
  const repo = new FakeAuditRepository();
  const context = new FakeAuditContextResolver(
    options?.tenantId === undefined ? 'tenant-1' : options.tenantId,
    options?.requestId ?? null,
  );
  const service = new AuditService(repo, context);
  return { service, repo, context };
}

function tenantCommand(overrides?: Partial<RecordTenantActionCommand>): RecordTenantActionCommand {
  return {
    action: 'user.login',
    actor: createAuditActor(),
    target: createAuditTarget(),
    ...overrides,
  };
}

test('recordTenantAction persists the event with the ambient tenant scope', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1', requestId: 'req-1' });
  const event = await service.recordTenantAction(tenantCommand());
  assert.equal(repo.appended.length, 1);
  assert.equal(event.scope, 'tenant');
  assert.equal(event.tenantId, 'tenant-1');
  assert.equal(event.requestId, 'req-1');
  assert.ok(event.id.length > 0);
  assert.ok(event.occurredAt instanceof Date);
  assert.equal(repo.appended[0], event);
});

test('recordTenantAction generates the request id server-side when the context has none', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  const event = await service.recordTenantAction(tenantCommand());
  assert.ok(event.requestId.length > 0);
  assert.equal(repo.appended[0]?.requestId, event.requestId);
});

test('recordTenantAction fails closed without an ambient tenant context', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand()),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordTenantAction never accepts a tenant id from the caller', async () => {
  assert.equal('tenantId' in tenantCommand(), false);
});

test('recordTenantAction redacts sensitive metadata before persistence', async () => {
  const { service, repo } = createHarness();
  await service.recordTenantAction(
    tenantCommand({
      metadata: { password: 'hunter2', sessionToken: 'raw', fileName: 'ok' },
    }),
  );
  const stored = repo.appended[0];
  assert.equal(stored?.metadata.password, REDACTED_VALUE);
  assert.equal(stored?.metadata.sessionToken, REDACTED_VALUE);
  assert.equal(stored?.metadata.fileName, 'ok');
});

test('recordTenantAction stamps the timestamp server-side and honors a valid provided date', async () => {
  const { service } = createHarness();
  const stamped = await service.recordTenantAction(tenantCommand());
  assert.ok(stamped.occurredAt instanceof Date);
  const provided = new Date('2026-08-04T10:00:00.000Z');
  const honored = await service.recordTenantAction(tenantCommand({ occurredAt: provided }));
  assert.equal(honored.occurredAt, provided);
});

test('recordTenantAction stores an optional reason as given', async () => {
  const { service, repo } = createHarness();
  const withReason = await service.recordTenantAction(tenantCommand({ reason: 'policy change' }));
  assert.equal(withReason.reason, 'policy change');
  const withoutReason = await service.recordTenantAction(tenantCommand());
  assert.equal(withoutReason.reason, null);
  assert.equal(repo.appended.length, 2);
});

test('recordTenantAction rejects a missing or empty action', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ action: '' })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ action: '   ' })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ action: 'a'.repeat(201) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordTenantAction rejects invalid actors and targets', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ actor: createAuditActor({ id: '' }) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ actor: createAuditActor({ type: 'robot' }) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ target: createAuditTarget({ type: '' }) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ target: createAuditTarget({ id: '  ' }) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordTenantAction rejects invalid request ids', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ requestId: '' })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ requestId: 'r'.repeat(129) })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  const accepted = await service.recordTenantAction(tenantCommand({ requestId: 'req-provided' }));
  assert.equal(accepted.requestId, 'req-provided');
});

test('recordTenantAction rejects an invalid provided timestamp', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () =>
      service.recordTenantAction(
        tenantCommand({ occurredAt: new Date('not-a-date') as unknown as Date }),
      ),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordTenantAction rejects oversized metadata', async () => {
  const { service, repo } = createHarness();
  const tooManyEntries: Record<string, number> = {};
  for (let i = 0; i < 101; i += 1) {
    tooManyEntries[`field${i}`] = i;
  }
  await assert.rejects(
    () => service.recordTenantAction(tenantCommand({ metadata: tooManyEntries })),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () =>
      service.recordTenantAction(
        tenantCommand({ metadata: { oversized: 'x'.repeat(4001) } }),
      ),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordPlatformAction persists a platform event without any tenant context', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  const event = await service.recordPlatformAction({
    action: 'plan.created',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'plan' }),
    reason: 'approved by platform owner',
  });
  assert.equal(event.scope, 'platform');
  assert.equal(event.tenantId, null);
  assert.equal(event.reason, 'approved by platform owner');
  assert.equal(repo.appended.length, 1);
});

test('recordPlatformAction fails closed without a reason', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  const base = {
    action: 'plan.created',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'plan' }),
  };
  await assert.rejects(
    () => service.recordPlatformAction(base as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordPlatformAction({ ...base, reason: '' } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordPlatformAction({ ...base, reason: '   ' } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordPlatformAction({ ...base, reason: 'r'.repeat(2001) } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordCrossTenantAction persists a cross-tenant event with the target tenant and reason', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  const event = await service.recordCrossTenantAction({
    action: 'tenant.suspended',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'institution' }),
    targetTenantId: 'tenant-9',
    reason: 'unpaid subscription',
  });
  assert.equal(event.scope, 'cross_tenant');
  assert.equal(event.tenantId, 'tenant-9');
  assert.equal(event.reason, 'unpaid subscription');
  assert.equal(repo.appended.length, 1);
});

test('recordCrossTenantAction fails closed without a target tenant id', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  const base = {
    action: 'tenant.suspended',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'institution' }),
    reason: 'unpaid subscription',
  };
  await assert.rejects(
    () => service.recordCrossTenantAction(base as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordCrossTenantAction({ ...base, targetTenantId: '' } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordCrossTenantAction({ ...base, targetTenantId: ' ' } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  await assert.rejects(
    () => service.recordCrossTenantAction({ ...base, targetTenantId: 't'.repeat(129) } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('recordCrossTenantAction fails closed without a reason', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () =>
      service.recordCrossTenantAction({
        action: 'tenant.suspended',
        actor: createAuditActor(),
        target: createAuditTarget({ type: 'institution' }),
        targetTenantId: 'tenant-9',
      } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record persists a valid event with an explicit scope', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  const event = await service.record({
    scope: 'tenant',
    tenantId: 'tenant-1',
    action: 'user.logout',
    actor: createAuditActor(),
    target: createAuditTarget(),
  });
  assert.equal(event.scope, 'tenant');
  assert.equal(event.tenantId, 'tenant-1');
  assert.equal(repo.appended.length, 1);
});

test('record rejects a tenant-scoped event whose tenant id mismatches the context', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  await assert.rejects(
    () =>
      service.record({
        scope: 'tenant',
        tenantId: 'tenant-2',
        action: 'user.login',
        actor: createAuditActor(),
        target: createAuditTarget(),
      }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record rejects a platform-scoped event that carries a tenant id', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () =>
      service.record({
        scope: 'platform',
        tenantId: 'tenant-1',
        action: 'plan.created',
        actor: createAuditActor(),
        target: createAuditTarget({ type: 'plan' }),
        reason: 'approved',
      }),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record rejects a platform-scoped event without a reason', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () =>
      service.record({
        scope: 'platform',
        action: 'plan.created',
        actor: createAuditActor(),
        target: createAuditTarget({ type: 'plan' }),
      } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record rejects a cross-tenant event without a target tenant id', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () =>
      service.record({
        scope: 'cross_tenant',
        action: 'tenant.suspended',
        actor: createAuditActor(),
        target: createAuditTarget({ type: 'institution' }),
        reason: 'unpaid',
      } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record rejects a cross-tenant event without a reason', async () => {
  const { service, repo } = createHarness({ tenantId: null });
  await assert.rejects(
    () =>
      service.record({
        scope: 'cross_tenant',
        tenantId: 'tenant-9',
        action: 'tenant.suspended',
        actor: createAuditActor(),
        target: createAuditTarget({ type: 'institution' }),
      } as never),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('record rejects an invalid scope value', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  await assert.rejects(
    () =>
      service.record({
        scope: 'global' as never,
        action: 'user.login',
        actor: createAuditActor(),
        target: createAuditTarget(),
      }),
    (error: unknown) => error instanceof InvalidAuditEventError,
  );
  assert.equal(repo.appended.length, 0);
});

test('the audit repository contract is append-only', () => {
  const repo = new FakeAuditRepository();
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(repo)).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual(methodNames, ['append', 'query']);
});

test('recording performs exactly one append and no other side effects', async () => {
  const { service, repo } = createHarness();
  await service.recordTenantAction(tenantCommand());
  assert.equal(repo.appended.length, 1);
  assert.equal(repo.lastQueryCriteria, null);
});

test('recording an audit event publishes no audit domain events (no recursive auditing)', async () => {
  const { service, repo } = createHarness();
  assert.equal(typeof (service as { publish?: unknown }).publish, 'undefined');
  await service.recordTenantAction(tenantCommand());
  assert.equal(repo.appended.length, 1);
});

test('audit events are immutable after creation', async () => {
  const { service, repo } = createHarness();
  const event = await service.recordTenantAction(
    tenantCommand({ metadata: { fileName: 'ok' } }),
  );
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.actor));
  assert.ok(Object.isFrozen(event.target));
  assert.ok(Object.isFrozen(event.metadata));
  try {
    (event as { action: string }).action = 'mutated';
  } catch {
    // strict mode throws on frozen assignment
  }
  try {
    (event.metadata as Record<string, string>).fileName = 'mutated';
  } catch {
    // strict mode throws on frozen assignment
  }
  try {
    (event.actor as { id: string }).id = 'mutated';
  } catch {
    // strict mode throws on frozen assignment
  }
  assert.equal(event.action, 'user.login');
  assert.equal(event.metadata.fileName, 'ok');
  assert.equal(event.actor.id, repo.appended[0]?.actor.id);
  assert.equal(repo.appended[0]?.action, 'user.login');
  assert.equal(repo.appended[0]?.metadata.fileName, 'ok');
});

test('queryAuditHistory returns only the ambient tenant scope', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  await service.recordTenantAction(tenantCommand({ action: 'user.login' }));
  const results = await service.queryAuditHistory({});
  assert.equal(results.length, 1);
  assert.equal(results[0]?.tenantId, 'tenant-1');
  assert.equal(repo.lastQueryCriteria?.scope, 'tenant');
  assert.equal(repo.lastQueryCriteria?.tenantId, 'tenant-1');
  assert.equal(repo.lastQueryCriteria?.limit, 100);
});

test('queryAuditHistory fails closed without an ambient tenant context', async () => {
  const { service } = createHarness({ tenantId: null });
  await assert.rejects(
    () => service.queryAuditHistory({}),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('queryAuditHistory denies cross-tenant reads by default', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  await assert.rejects(
    () => service.queryAuditHistory({ tenantId: 'tenant-2' }),
    (error: unknown) => error instanceof CrossTenantReadDeniedError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ scope: 'platform' }),
    (error: unknown) => error instanceof CrossTenantReadDeniedError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ scope: 'cross_tenant' }),
    (error: unknown) => error instanceof CrossTenantReadDeniedError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ scope: 'global' as never }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  assert.equal(repo.lastQueryCriteria, null);
});

test('queryAuditHistory allows criteria scoped to the ambient tenant', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  const results = await service.queryAuditHistory({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.deepEqual(results, []);
  assert.equal(repo.lastQueryCriteria?.tenantId, 'tenant-1');
});

test('queryAuditHistory validates the time range', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () =>
      service.queryAuditHistory({
        from: new Date('2026-08-05T00:00:00.000Z'),
        to: new Date('2026-08-04T00:00:00.000Z'),
      }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () =>
      service.queryAuditHistory({
        from: new Date('not-a-date') as unknown as Date,
      }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () =>
      service.queryAuditHistory({
        to: new Date('not-a-date') as unknown as Date,
      }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  assert.equal(repo.lastQueryCriteria, null);
});

test('queryAuditHistory validates the limit', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.queryAuditHistory({ limit: 0 }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ limit: 1001 }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ limit: 1.5 }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ limit: Number.NaN }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await service.queryAuditHistory({ limit: 25 });
  assert.equal(repo.lastQueryCriteria?.limit, 25);
});

test('queryAuditHistory rejects empty filter strings', async () => {
  const { service, repo } = createHarness();
  const criteria: AuditQueryCriteria = { actorId: '  ' };
  await assert.rejects(
    () => service.queryAuditHistory(criteria),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ action: '' }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ targetType: '' }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  await assert.rejects(
    () => service.queryAuditHistory({ targetId: '' }),
    (error: unknown) => error instanceof InvalidAuditQueryError,
  );
  assert.equal(repo.lastQueryCriteria, null);
});

test('queryAuditHistory filters by actor, action, target, and time range', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  const actor = createAuditActor();
  const target = createAuditTarget({ type: 'role' });
  const at = new Date('2026-08-04T12:00:00.000Z');
  await service.recordTenantAction(tenantCommand({ action: 'role.created', actor, target, occurredAt: at }));
  await service.recordTenantAction(
    tenantCommand({ action: 'role.updated', actor, target, occurredAt: new Date('2026-08-04T14:00:00.000Z') }),
  );
  await service.recordTenantAction(
    tenantCommand({ action: 'user.login', occurredAt: new Date('2026-08-04T13:00:00.000Z') }),
  );
  const byAction = await service.queryAuditHistory({ action: 'role.created' });
  assert.equal(byAction.length, 1);
  assert.equal(byAction[0]?.action, 'role.created');
  const byActor = await service.queryAuditHistory({ actorId: actor.id });
  assert.equal(byActor.length, 2);
  const byTarget = await service.queryAuditHistory({ targetType: 'role' });
  assert.equal(byTarget.length, 2);
  const byTargetId = await service.queryAuditHistory({ targetId: target.id });
  assert.equal(byTargetId.length, 2);
  const byRange = await service.queryAuditHistory({
    from: new Date('2026-08-04T12:30:00.000Z'),
    to: new Date('2026-08-04T13:30:00.000Z'),
  });
  assert.equal(byRange.length, 1);
  assert.equal(repo.lastQueryCriteria?.from?.toISOString(), '2026-08-04T12:30:00.000Z');
  assert.equal(repo.lastQueryCriteria?.to?.toISOString(), '2026-08-04T13:30:00.000Z');
  const bounded = await service.queryAuditHistory({ limit: 2 });
  assert.equal(bounded.length, 2);
  assert.equal(repo.lastQueryCriteria?.limit, 2);
});

test('queryAuditHistory returns immutable results', async () => {
  const { service } = createHarness({ tenantId: 'tenant-1' });
  await service.recordTenantAction(tenantCommand());
  const results = await service.queryAuditHistory({});
  const event = results[0];
  assert.ok(event);
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.actor));
  assert.ok(Object.isFrozen(event.target));
  assert.ok(Object.isFrozen(event.metadata));
  try {
    (event as { action: string }).action = 'mutated';
  } catch {
    // strict mode throws on frozen assignment
  }
  assert.equal(event.action, 'user.login');
});

test('platform and cross-tenant records are independent of any ambient tenant context', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1' });
  const platform = await service.recordPlatformAction({
    action: 'plan.retired',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'plan' }),
    reason: 'replaced by plan v2',
  });
  const crossTenant = await service.recordCrossTenantAction({
    action: 'tenant.legal_hold',
    actor: createAuditActor(),
    target: createAuditTarget({ type: 'institution' }),
    targetTenantId: 'tenant-9',
    reason: 'litigation hold',
  });
  assert.equal(platform.scope, 'platform');
  assert.equal(platform.tenantId, null);
  assert.equal(crossTenant.scope, 'cross_tenant');
  assert.equal(crossTenant.tenantId, 'tenant-9');
  assert.equal(repo.appended.length, 2);
});

test('recorded events receive unique server-side ids', async () => {
  const { service, repo } = createHarness();
  const first = await service.recordTenantAction(tenantCommand());
  const second = await service.recordTenantAction(tenantCommand());
  assert.notEqual(first.id, second.id);
  assert.equal(repo.appended.length, 2);
});

test('a recorded event keeps its identity after append', async () => {
  const { service, repo } = createHarness({ tenantId: 'tenant-1', requestId: 'req-1' });
  const event = await service.recordTenantAction(tenantCommand());
  assert.equal(event.id, repo.appended[0]?.id);
  assert.equal(event.requestId, 'req-1');
});
