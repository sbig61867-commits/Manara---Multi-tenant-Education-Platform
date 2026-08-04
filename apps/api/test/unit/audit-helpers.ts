import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type {
  AuditActor,
  AuditContext,
  AuditEvent,
  AuditQueryCriteria,
  AuditTarget,
} from '../../src/audit/domain/types.js';
import type { AuditContextResolver } from '../../src/audit/ports/audit-context.js';
import type { AuditRepository } from '../../src/audit/ports/audit.repository.js';

export class FakeAuditRepository implements AuditRepository {
  readonly appended: AuditEvent[] = [];
  lastQueryCriteria: AuditQueryCriteria | null = null;

  append(event: AuditEvent): Promise<void> {
    this.appended.push(event);
    return Promise.resolve();
  }

  async query(criteria: AuditQueryCriteria): Promise<AuditEvent[]> {
    this.lastQueryCriteria = criteria;
    return this.appended.filter((event) => {
      if (criteria.scope !== undefined && event.scope !== criteria.scope) {
        return false;
      }
      if (criteria.tenantId !== undefined && event.tenantId !== criteria.tenantId) {
        return false;
      }
      if (criteria.actorId !== undefined && event.actor.id !== criteria.actorId) {
        return false;
      }
      if (criteria.action !== undefined && event.action !== criteria.action) {
        return false;
      }
      if (criteria.targetType !== undefined && event.target.type !== criteria.targetType) {
        return false;
      }
      if (criteria.targetId !== undefined && event.target.id !== criteria.targetId) {
        return false;
      }
      if (criteria.from !== undefined && event.occurredAt.getTime() < criteria.from.getTime()) {
        return false;
      }
      if (criteria.to !== undefined && event.occurredAt.getTime() > criteria.to.getTime()) {
        return false;
      }
      return true;
    }).slice(0, criteria.limit);
  }
}

export class FakeAuditContextResolver implements AuditContextResolver {
  private readonly tenantId: string | null;
  private readonly requestId: string | null;

  constructor(tenantId: string | null, requestId: string | null = null) {
    this.tenantId = tenantId;
    this.requestId = requestId;
  }

  resolveAuditContext(): AuditContext {
    return { tenantId: this.tenantId, requestId: this.requestId };
  }
}

export function createAuditActor(overrides?: Partial<AuditActor>): AuditActor {
  return {
    id: randomUUID(),
    type: 'user',
    ...overrides,
  };
}

export function createAuditTarget(overrides?: Partial<AuditTarget>): AuditTarget {
  return {
    type: 'institution',
    id: randomUUID(),
    ...overrides,
  };
}

export function createAuditEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  const now = new Date();
  return {
    id: randomUUID(),
    scope: 'tenant',
    tenantId: 'tenant-1',
    actor: createAuditActor(),
    target: createAuditTarget(),
    action: 'user.login',
    reason: null,
    requestId: 'req-123',
    occurredAt: now,
    metadata: {},
    ...overrides,
  };
}
