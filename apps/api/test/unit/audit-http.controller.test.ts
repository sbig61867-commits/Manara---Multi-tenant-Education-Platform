import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { HttpNotFoundError } from '../../src/http/errors.js';
import type { AuditService } from '../../src/audit/application/audit.service.js';
import type { AuditEvent, AuditQueryCriteria, PlatformAuditQueryCriteria } from '../../src/audit/domain/types.js';
import { encodeCursor } from '../../src/tenant/pagination.js';
import { PlatformAuditController, TenantAuditController } from '../../src/audit-http/audit.controller.js';
import type { AuditListQuery } from '../../src/audit-http/audit.dto.js';
import { createAuditActor, createAuditTarget } from './audit-helpers.js';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

function createAuditEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    id: randomUUID(),
    scope: 'tenant',
    tenantId: TENANT_ID,
    actor: createAuditActor(),
    target: createAuditTarget(),
    action: 'user.login',
    reason: null,
    requestId: 'req-1',
    occurredAt: new Date('2026-08-04T12:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

function createQuery(overrides?: Partial<AuditListQuery>): AuditListQuery {
  return { limit: 20, cursor: null, ...overrides };
}

function rowsBeforeCursor(rows: AuditEvent[], criteria: AuditQueryCriteria & PlatformAuditQueryCriteria): AuditEvent[] {
  if (criteria.beforeOccurredAt === undefined || criteria.beforeId === undefined) {
    return rows;
  }
  return rows.filter(
    (row) =>
      row.occurredAt.getTime() < criteria.beforeOccurredAt!.getTime() ||
      (row.occurredAt.getTime() === criteria.beforeOccurredAt!.getTime() && row.id < criteria.beforeId!),
  );
}

interface ServiceStubs {
  queryAuditHistory?: AuditService['queryAuditHistory'];
  queryPlatformAuditHistory?: AuditService['queryPlatformAuditHistory'];
  findTenantAuditEventById?: AuditService['findTenantAuditEventById'];
  findPlatformAuditEventById?: AuditService['findPlatformAuditEventById'];
}

function createControllers(overrides: ServiceStubs = {}): {
  tenant: TenantAuditController;
  platform: PlatformAuditController;
} {
  const service = {
    queryAuditHistory: overrides.queryAuditHistory ?? (async () => []),
    queryPlatformAuditHistory: overrides.queryPlatformAuditHistory ?? (async () => []),
    findTenantAuditEventById: overrides.findTenantAuditEventById ?? (async () => null),
    findPlatformAuditEventById: overrides.findPlatformAuditEventById ?? (async () => null),
  } as unknown as AuditService;
  return {
    tenant: new TenantAuditController(service),
    platform: new PlatformAuditController(service),
  };
}

test('listAuditEvents maps the query filters and fetches limit + 1 rows', async () => {
  let received: AuditQueryCriteria | undefined;
  const event = createAuditEvent();
  const { tenant } = createControllers({
    queryAuditHistory: async (criteria) => {
      received = criteria;
      return [event];
    },
  });
  const from = new Date('2026-08-01T00:00:00.000Z');
  const to = new Date('2026-08-05T00:00:00.000Z');
  const response = await tenant.listAuditEvents(
    { tenantId: TENANT_ID },
    createQuery({
      limit: 5,
      actorUserId: event.actor.id,
      actorPlatformRole: 'owner',
      action: 'user.login',
      targetEntityType: 'user',
      targetEntityId: event.target.id,
      requestId: 'req-1',
      occurredFrom: from,
      occurredTo: to,
    }),
  );
  assert.deepEqual(received, {
    actorUserId: event.actor.id,
    actorPlatformRole: 'owner',
    action: 'user.login',
    targetType: 'user',
    targetId: event.target.id,
    requestId: 'req-1',
    from,
    to,
    beforeOccurredAt: undefined,
    beforeId: undefined,
    limit: 6,
  });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.id, event.id);
  assert.equal(response.items[0]?.occurredAt, event.occurredAt.toISOString());
  assert.deepEqual(response.items[0]?.actor, event.actor);
  assert.equal(response.nextCursor, null);
});

test('listAuditEvents paginates with an opaque cursor', async () => {
  const rows = [
    createAuditEvent({ id: randomUUID(), occurredAt: new Date('2026-08-04T14:00:00.000Z') }),
    createAuditEvent({ id: randomUUID(), occurredAt: new Date('2026-08-04T13:00:00.000Z') }),
    createAuditEvent({ id: randomUUID(), occurredAt: new Date('2026-08-04T12:00:00.000Z') }),
  ];
  let received: AuditQueryCriteria | undefined;
  const { tenant } = createControllers({
    queryAuditHistory: async (criteria) => {
      received = criteria;
      return rowsBeforeCursor(rows, criteria);
    },
  });
  const first = await tenant.listAuditEvents({ tenantId: TENANT_ID }, createQuery({ limit: 2 }));
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor !== null);

  const second = await tenant.listAuditEvents({ tenantId: TENANT_ID }, createQuery({ limit: 2, cursor: first.nextCursor }));
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(received?.limit, 3);
  assert.equal(received?.beforeOccurredAt?.toISOString(), '2026-08-04T13:00:00.000Z');
  assert.equal(received?.beforeId, rows[1]?.id);
});

test('listAuditEvents decodes a cursor produced by encodeCursor', async () => {
  let received: AuditQueryCriteria | undefined;
  const { tenant } = createControllers({
    queryAuditHistory: async (criteria) => {
      received = criteria;
      return [createAuditEvent()];
    },
  });
  const cursor = encodeCursor(new Date('2026-08-04T13:00:00.000Z'), 'evt-1');
  await tenant.listAuditEvents({ tenantId: TENANT_ID }, createQuery({ limit: 2, cursor }));
  assert.equal(received?.beforeOccurredAt?.toISOString(), '2026-08-04T13:00:00.000Z');
  assert.equal(received?.beforeId, 'evt-1');
});

test('getAuditEvent returns the event view', async () => {
  const event = createAuditEvent();
  const { tenant } = createControllers({ findTenantAuditEventById: async () => event });
  const response = await tenant.getAuditEvent({ tenantId: TENANT_ID, eventId: event.id });
  assert.equal(response.event.id, event.id);
  assert.equal(response.event.scope, 'tenant');
  assert.equal(response.event.tenantId, TENANT_ID);
  assert.equal(response.event.requestId, 'req-1');
});

test('getAuditEvent throws 404 when the event is missing', async () => {
  const { tenant } = createControllers({ findTenantAuditEventById: async () => null });
  await assert.rejects(tenant.getAuditEvent({ tenantId: TENANT_ID, eventId: randomUUID() }), HttpNotFoundError);
});

test('listPlatformAuditEvents maps the query and fetches limit + 1 rows', async () => {
  let received: PlatformAuditQueryCriteria | undefined;
  const event = createAuditEvent({ scope: 'platform', tenantId: null, action: 'plan.retired' });
  const { platform } = createControllers({
    queryPlatformAuditHistory: async (criteria) => {
      received = criteria;
      return [event];
    },
  });
  const response = await platform.listPlatformAuditEvents(
    createQuery({ limit: 3, actorPlatformRole: 'owner', requestId: 'req-9' }),
  );
  assert.deepEqual(received, {
    actorUserId: undefined,
    actorPlatformRole: 'owner',
    action: undefined,
    targetType: undefined,
    targetId: undefined,
    requestId: 'req-9',
    from: undefined,
    to: undefined,
    beforeOccurredAt: undefined,
    beforeId: undefined,
    limit: 4,
  });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.scope, 'platform');
  assert.equal(response.items[0]?.tenantId, null);
  assert.equal(response.items[0]?.action, 'plan.retired');
  assert.equal(response.nextCursor, null);
});

test('listPlatformAuditEvents paginates with a nextCursor', async () => {
  const rows = [
    createAuditEvent({ scope: 'platform', tenantId: null, occurredAt: new Date('2026-08-04T13:00:00.000Z') }),
    createAuditEvent({ scope: 'platform', tenantId: null, occurredAt: new Date('2026-08-04T12:00:00.000Z') }),
  ];
  const { platform } = createControllers({
    queryPlatformAuditHistory: async (criteria) => rowsBeforeCursor(rows, criteria),
  });
  const first = await platform.listPlatformAuditEvents(createQuery({ limit: 1 }));
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor !== null);
  const second = await platform.listPlatformAuditEvents(createQuery({ limit: 1, cursor: first.nextCursor }));
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
});

test('getPlatformAuditEvent returns the event view', async () => {
  const event = createAuditEvent({ scope: 'platform', tenantId: null, action: 'plan.retired' });
  const { platform } = createControllers({ findPlatformAuditEventById: async () => event });
  const response = await platform.getPlatformAuditEvent({ eventId: event.id });
  assert.equal(response.event.id, event.id);
  assert.equal(response.event.scope, 'platform');
  assert.equal(response.event.tenantId, null);
});

test('getPlatformAuditEvent throws 404 when the event is missing', async () => {
  const { platform } = createControllers({ findPlatformAuditEventById: async () => null });
  await assert.rejects(platform.getPlatformAuditEvent({ eventId: randomUUID() }), HttpNotFoundError);
});
