export type AuditScope = 'tenant' | 'platform' | 'cross_tenant';

export type AuditActorType = 'user' | 'system';

export interface AuditActor {
  readonly id: string;
  readonly type: AuditActorType;
}

export type AuditTargetType = string;

export interface AuditTarget {
  readonly type: AuditTargetType;
  readonly id: string;
}

export type AuditAction = string;

export type AuditMetadataValue = string | number | boolean | null;

export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export interface AuditContext {
  readonly tenantId: string | null;
  readonly requestId: string | null;
}

export interface AuditEvent {
  readonly id: string;
  readonly scope: AuditScope;
  readonly tenantId: string | null;
  readonly actor: AuditActor;
  readonly target: AuditTarget;
  readonly action: AuditAction;
  readonly reason: string | null;
  readonly requestId: string;
  readonly occurredAt: Date;
  readonly metadata: AuditMetadata;
}

export interface AuditQueryCriteria {
  readonly scope?: AuditScope;
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly actorUserId?: string;
  readonly actorPlatformRole?: string;
  readonly action?: AuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly requestId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly beforeOccurredAt?: Date;
  readonly beforeId?: string;
  readonly limit?: number;
}

/**
 * Criteria for a platform-scoped audit query. Structurally cannot carry a
 * tenant id or scope: platform queries are hard-filtered to
 * `scope = 'platform' AND tenant_id IS NULL` in the repository and can never
 * silently downgrade into tenant queries.
 */
export interface PlatformAuditQueryCriteria {
  readonly actorUserId?: string;
  readonly actorPlatformRole?: string;
  readonly action?: AuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly requestId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly beforeOccurredAt?: Date;
  readonly beforeId?: string;
  readonly limit?: number;
}
