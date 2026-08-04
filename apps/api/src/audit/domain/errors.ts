export abstract class AuditError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingTenantContextError extends AuditError {
  readonly code = 'audit.context_missing';
}

export class TenantContextMismatchError extends AuditError {
  readonly code = 'audit.context_mismatch';
}

export class CrossTenantReadDeniedError extends AuditError {
  readonly code = 'audit.cross_tenant_read_denied';
}

export class InvalidAuditEventError extends AuditError {
  readonly code = 'audit.invalid_event';
}

export class InvalidAuditQueryError extends AuditError {
  readonly code = 'audit.invalid_query';
}
