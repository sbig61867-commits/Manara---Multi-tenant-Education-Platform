import type { TransactionalExecutor } from '@manara/database';
import type {
  AuditActor,
  AuditEvent,
  AuditMetadata,
  AuditQueryCriteria,
  AuditScope,
  PlatformAuditQueryCriteria,
} from '../domain/types.js';
import type { AuditRepository } from '../ports/audit.repository.js';

interface AuditLogRow {
  id: string;
  scope: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_platform_role: string | null;
  action: string;
  target_entity_type: string;
  target_entity_id: string;
  reason: string | null;
  request_id: string;
  metadata_json: Record<string, unknown>;
  occurred_at: Date;
}

const AUDIT_COLUMNS =
  'id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at';

function mapActor(row: AuditLogRow): AuditActor {
  if (row.actor_user_id !== null) {
    return { id: row.actor_user_id, type: 'user' };
  }
  return { id: row.actor_platform_role ?? '', type: 'system' };
}

function mapEvent(row: AuditLogRow): AuditEvent {
  return {
    id: row.id,
    scope: row.scope as AuditScope,
    tenantId: row.tenant_id,
    actor: mapActor(row),
    target: { type: row.target_entity_type, id: row.target_entity_id },
    action: row.action,
    reason: row.reason,
    requestId: row.request_id,
    occurredAt: row.occurred_at,
    metadata: row.metadata_json as AuditMetadata,
  };
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async append(event: AuditEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_log (${AUDIT_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        event.id,
        event.scope,
        event.tenantId,
        event.actor.type === 'user' ? event.actor.id : null,
        event.actor.type === 'system' ? event.actor.id : null,
        event.action,
        event.target.type,
        event.target.id,
        event.reason,
        event.requestId,
        event.metadata,
        event.occurredAt,
      ],
    );
  }

  async query(criteria: AuditQueryCriteria): Promise<AuditEvent[]> {
    if (criteria.tenantId === undefined) {
      return [];
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    params.push(criteria.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
    this.appendFilters(conditions, params, criteria);
    const limit = criteria.limit ?? 100;
    params.push(limit);
    const result = await this.database.query<AuditLogRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log
       WHERE ${conditions.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(mapEvent);
  }

  async queryPlatform(criteria: PlatformAuditQueryCriteria): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    conditions.push(`scope = 'platform'`);
    conditions.push(`tenant_id IS NULL`);
    this.appendFilters(conditions, params, criteria);
    const limit = criteria.limit ?? 100;
    params.push(limit);
    const result = await this.database.query<AuditLogRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log
       WHERE ${conditions.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(mapEvent);
  }

  async findTenantEvent(id: string, tenantId: string): Promise<AuditEvent | null> {
    const result = await this.database.query<AuditLogRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [id, tenantId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEvent(row);
  }

  async findPlatformEvent(id: string): Promise<AuditEvent | null> {
    const result = await this.database.query<AuditLogRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log
       WHERE id = $1 AND scope = 'platform' AND tenant_id IS NULL
       LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEvent(row);
  }

  private appendFilters(
    conditions: string[],
    params: unknown[],
    criteria: Pick<
      AuditQueryCriteria,
      | 'actorId'
      | 'actorUserId'
      | 'actorPlatformRole'
      | 'action'
      | 'targetType'
      | 'targetId'
      | 'requestId'
      | 'from'
      | 'to'
      | 'beforeOccurredAt'
      | 'beforeId'
    >,
  ): void {
    if (criteria.actorId !== undefined) {
      params.push(criteria.actorId);
      conditions.push(`(actor_user_id::text = $${params.length} OR actor_platform_role = $${params.length})`);
    }
    if (criteria.actorUserId !== undefined) {
      params.push(criteria.actorUserId);
      conditions.push(`actor_user_id::text = $${params.length}`);
    }
    if (criteria.actorPlatformRole !== undefined) {
      params.push(criteria.actorPlatformRole);
      conditions.push(`actor_platform_role = $${params.length}`);
    }
    if (criteria.action !== undefined) {
      params.push(criteria.action);
      conditions.push(`action = $${params.length}`);
    }
    if (criteria.targetType !== undefined) {
      params.push(criteria.targetType);
      conditions.push(`target_entity_type = $${params.length}`);
    }
    if (criteria.targetId !== undefined) {
      params.push(criteria.targetId);
      conditions.push(`target_entity_id = $${params.length}`);
    }
    if (criteria.requestId !== undefined) {
      params.push(criteria.requestId);
      conditions.push(`request_id = $${params.length}`);
    }
    if (criteria.from !== undefined) {
      params.push(criteria.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (criteria.to !== undefined) {
      params.push(criteria.to);
      conditions.push(`occurred_at <= $${params.length}`);
    }
    if (criteria.beforeOccurredAt !== undefined && criteria.beforeId !== undefined) {
      params.push(criteria.beforeOccurredAt, criteria.beforeId);
      conditions.push(`(occurred_at, id) < ($${params.length - 1}, $${params.length})`);
    }
  }
}
