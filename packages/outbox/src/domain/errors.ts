export abstract class OutboxError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingTenantContextError extends OutboxError {
  readonly code = 'outbox.tenant_context_missing';
}

export class InvalidOutboxMessageError extends OutboxError {
  readonly code = 'outbox.invalid_message';
}

export class InvalidOutboxClaimError extends OutboxError {
  readonly code = 'outbox.invalid_claim';
}

export class OutboxMessageNotFoundError extends OutboxError {
  readonly code = 'outbox.message_not_found';
}
