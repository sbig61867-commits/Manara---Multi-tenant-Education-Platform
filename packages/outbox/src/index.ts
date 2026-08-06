export { PostgresDeadLetterRepository } from './adapters/postgres-dead-letter.repository.js';
export { PostgresOutboxRepository } from './adapters/postgres-outbox.repository.js';
export { outboxAttemptsExhausted, outboxRetryDelayMs, OUTBOX_DEFAULT_CLAIM_LEASE_MS, OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_DELAYS_MS } from './application/backoff.js';
export { classifyOutboxEventType, OUTBOX_EVENT_TYPES, OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION } from './application/event-catalog.js';
export type { OutboxEventCatalogPolicy, OutboxEventTypeClassification } from './application/event-catalog.js';
export { deriveOutboxEventId } from './application/event-id.js';
export type { DeriveOutboxEventIdInput } from './application/event-id.js';
export { OutboxService } from './application/outbox.service.js';
export { isJsonSafeValue, isSensitiveKey, normalizeKey, REDACTED_VALUE, sanitizeErrorMessage, sanitizeOutboxPayload } from './application/payload-sanitizer.js';
export { InvalidOutboxClaimError, InvalidOutboxMessageError, MissingTenantContextError, OutboxError, OutboxEventTypeUndeclaredError, OutboxEventTypeUnsupportedError, OutboxMessageNotFoundError } from './domain/errors.js';
export { NoopOutboxEventPublisher } from './domain/events.js';
export type { OutboxDeliveryFailedEvent, OutboxEventPublisher, OutboxMessageDeadLetteredEvent } from './domain/events.js';
export type {
  DeadLetterRecord,
  DispatchResult,
  OutboxClaim,
  OutboxClaimCriteria,
  OutboxClaimedMessage,
  OutboxDeadLetterOutcome,
  OutboxDeliveryAttempt,
  OutboxDeliveryOutcome,
  OutboxEnqueueCommand,
  OutboxEnqueueOutcome,
  OutboxEvent,
  OutboxFailure,
  OutboxFailureOutcome,
  OutboxMessage,
  OutboxPayload,
  OutboxRetryOutcome,
  OutboxScope,
  OutboxStatus,
} from './domain/types.js';
export { OutboxModule } from './outbox.module.js';
export type { OutboxModuleOptions } from './outbox.module.js';
export { OUTBOX_CLOCK, OUTBOX_DEAD_LETTER_REPOSITORY, OUTBOX_EVENT_CATALOG_POLICY, OUTBOX_EVENT_PUBLISHER, OUTBOX_REPOSITORY } from './outbox.tokens.js';
export type { DeadLetterRepository } from './ports/dead-letter.repository.js';
export type { OutboxClock } from './ports/outbox-clock.js';
export type { OutboxDispatcher } from './ports/outbox-dispatcher.js';
export type { OutboxRepository } from './ports/outbox.repository.js';
