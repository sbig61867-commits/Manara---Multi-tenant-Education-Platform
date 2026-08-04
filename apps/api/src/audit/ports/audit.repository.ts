import type { AuditEvent, AuditQueryCriteria } from '../domain/types.js';

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  query(criteria: AuditQueryCriteria): Promise<AuditEvent[]>;
}
