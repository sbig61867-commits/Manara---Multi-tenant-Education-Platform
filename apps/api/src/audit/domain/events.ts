import type { AuditEvent } from './types.js';

export interface AuditEventRecorded {
  readonly type: 'audit.recorded';
  readonly event: AuditEvent;
  readonly occurredAt: Date;
}

export interface AuditEventPublisher {
  publish(event: AuditEventRecorded): Promise<void> | void;
}
