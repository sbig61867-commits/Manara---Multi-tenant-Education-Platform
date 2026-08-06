import type {
  AuditEvent,
  AuditQueryCriteria,
  PlatformAuditQueryCriteria,
} from '../domain/types.js';

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  query(criteria: AuditQueryCriteria): Promise<AuditEvent[]>;
  queryPlatform(criteria: PlatformAuditQueryCriteria): Promise<AuditEvent[]>;
  findTenantEvent(id: string, tenantId: string): Promise<AuditEvent | null>;
  findPlatformEvent(id: string): Promise<AuditEvent | null>;
}
