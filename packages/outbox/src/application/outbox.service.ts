import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OutboxEventPublisher } from '../domain/events.js';
import {
  InvalidOutboxClaimError,
  InvalidOutboxMessageError,
  MissingTenantContextError,
  OutboxMessageNotFoundError,
} from '../domain/errors.js';
import type {
  DeadLetterRecord,
  OutboxClaimCriteria,
  OutboxClaimedMessage,
  OutboxDeadLetterOutcome,
  OutboxDeliveryOutcome,
  OutboxEnqueueCommand,
  OutboxEnqueueOutcome,
  OutboxFailure,
  OutboxFailureOutcome,
  OutboxMessage,
  OutboxRetryOutcome,
} from '../domain/types.js';
import { OUTBOX_CLOCK, OUTBOX_DEAD_LETTER_REPOSITORY, OUTBOX_EVENT_PUBLISHER, OUTBOX_REPOSITORY } from '../outbox.tokens.js';
import type { DeadLetterRepository } from '../ports/dead-letter.repository.js';
import type { OutboxClock } from '../ports/outbox-clock.js';
import type { OutboxRepository } from '../ports/outbox.repository.js';
import { OUTBOX_DEFAULT_CLAIM_LEASE_MS, outboxRetryDelayMs } from './backoff.js';
import { deriveOutboxEventId } from './event-id.js';
import { sanitizeErrorMessage, sanitizeOutboxPayload } from './payload-sanitizer.js';

const MAX_EVENT_SOURCE_LENGTH = 32;
const MAX_EVENT_TYPE_LENGTH = 128;
const MAX_OCCURRENCE_ID_LENGTH = 200;
const MAX_TENANT_ID_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 512;
const MAX_PAYLOAD_JSON_LENGTH = 65_536;
const MAX_FAILURE_MESSAGE_LENGTH = 1000;
const DEFAULT_CLAIM_LIMIT = 10;
const MAX_CLAIM_LIMIT = 100;
const DEFAULT_FAILURE_CODE = 'outbox.delivery_failed';

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

@Injectable()
export class OutboxService {
  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repository: OutboxRepository,
    @Inject(OUTBOX_DEAD_LETTER_REPOSITORY) private readonly deadLetterRepository: DeadLetterRepository,
    @Inject(OUTBOX_EVENT_PUBLISHER) private readonly eventPublisher: OutboxEventPublisher,
    @Inject(OUTBOX_CLOCK) private readonly clock: OutboxClock,
  ) {}

  /**
   * Enqueues a message for at-least-once delivery. Must be called inside the
   * originating business transaction: the insert joins the caller's ambient
   * transaction, so the message commits or rolls back with the business write.
   * Re-enqueuing the same deterministic event id is an idempotent no-op.
   */
  async enqueue(command: OutboxEnqueueCommand): Promise<OutboxEnqueueOutcome> {
    if (command.scope !== 'tenant' && command.scope !== 'platform') {
      throw new InvalidOutboxMessageError('Outbox scope must be tenant or platform');
    }
    const tenantId = this.resolveTenantId(command.scope, command.tenantId);
    this.assertIdentifier(command.eventSource, 'event source', MAX_EVENT_SOURCE_LENGTH);
    this.assertIdentifier(command.eventType, 'event type', MAX_EVENT_TYPE_LENGTH);
    this.assertIdentifier(command.occurrenceId, 'occurrence id', MAX_OCCURRENCE_ID_LENGTH);
    const payload = sanitizeOutboxPayload(command.payload);
    if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON_LENGTH) {
      throw new InvalidOutboxMessageError('Outbox payload exceeds the maximum allowed size');
    }
    let scheduledAt: Date | null = null;
    if (command.scheduledAt !== undefined && command.scheduledAt !== null) {
      if (!this.isValidDate(command.scheduledAt)) {
        throw new InvalidOutboxMessageError('Outbox scheduled at must be a valid date');
      }
      scheduledAt = command.scheduledAt;
    }
    const eventId = deriveOutboxEventId({
      source: command.eventSource,
      type: command.eventType,
      tenantId,
      occurrenceId: command.occurrenceId,
    });
    if (eventId.length > MAX_EVENT_ID_LENGTH) {
      throw new InvalidOutboxMessageError('Outbox event id exceeds the maximum allowed length');
    }
    const now = this.clock.now();
    const message: OutboxMessage = {
      id: randomUUID(),
      eventId,
      source: command.eventSource,
      type: command.eventType,
      scope: command.scope,
      tenantId,
      payload,
      status: 'pending',
      attempts: 0,
      lastError: null,
      leaseExpiresAt: null,
      nextAttemptAt: scheduledAt,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.repository.insert(message);
    if (!inserted) {
      const existing = await this.repository.findByEventId(eventId);
      if (existing === null) {
        throw new OutboxMessageNotFoundError('Duplicate event id without a persisted message');
      }
      return { status: 'already_exists', message: existing };
    }
    return { status: 'enqueued', message };
  }

  /**
   * Atomically claims due pending messages for safe concurrent workers.
   * Tenant-scoped claims require an explicit tenant id; cross-tenant claims
   * are denied by default. Claims grant a lease that expires after the
   * configured lease duration.
   */
  async claimPending(criteria: OutboxClaimCriteria): Promise<OutboxClaimedMessage[]> {
    if (criteria.scope !== 'tenant' && criteria.scope !== 'platform') {
      throw new InvalidOutboxClaimError('Outbox claim scope must be tenant or platform');
    }
    if (criteria.scope === 'tenant' && !isNonEmptyString(criteria.tenantId)) {
      throw new InvalidOutboxClaimError(
        'Tenant-scoped claims require a tenant id; cross-tenant claims are denied by default',
      );
    }
    if (criteria.scope === 'platform' && criteria.tenantId !== undefined && criteria.tenantId !== null) {
      throw new InvalidOutboxClaimError('Platform-scoped claims must not carry a tenant id');
    }
    const limit = criteria.limit ?? DEFAULT_CLAIM_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM_LIMIT) {
      throw new InvalidOutboxClaimError('Outbox claim limit must be an integer between 1 and 100');
    }
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + OUTBOX_DEFAULT_CLAIM_LEASE_MS);
    const messages = await this.repository.claimPending(criteria, now, leaseExpiresAt);
    return messages.map((message) => ({
      message,
      claim: { messageId: message.id, claimedAt: now, leaseExpiresAt },
    }));
  }

  /** Marks a claimed message delivered. Success is idempotent. */
  async markDelivered(messageId: string): Promise<OutboxDeliveryOutcome> {
    const message = await this.repository.findById(messageId);
    if (message === null) {
      return { status: 'not_found' };
    }
    if (message.status === 'delivered') {
      return { status: 'already_delivered', message };
    }
    const delivered = await this.repository.markDelivered(messageId, this.clock.now());
    if (!delivered) {
      return { status: 'not_applicable', message };
    }
    const updated = await this.repository.findById(messageId);
    if (updated === null) {
      return { status: 'not_found' };
    }
    return { status: 'delivered', message: updated };
  }

  /** Records a delivery failure: increments the attempt count and stores a sanitized error. */
  async markFailed(messageId: string, error: unknown): Promise<OutboxFailureOutcome> {
    const message = await this.repository.findById(messageId);
    if (message === null) {
      return { status: 'not_found' };
    }
    if (message.status === 'delivered' || message.status === 'dead_letter') {
      return { status: 'not_applicable', message };
    }
    const failure = this.buildFailure(error);
    const recorded = await this.repository.markFailed(messageId, failure);
    if (!recorded) {
      return { status: 'not_applicable', message };
    }
    const updated = await this.repository.findById(messageId);
    if (updated === null) {
      return { status: 'not_found' };
    }
    this.eventPublisher.publishDeliveryFailed({
      messageId: updated.id,
      eventId: updated.eventId,
      source: updated.source,
      type: updated.type,
      scope: updated.scope,
      tenantId: updated.tenantId,
      attempts: updated.attempts,
      failure,
      occurredAt: this.clock.now(),
    });
    return { status: 'failure_recorded', message: updated };
  }

  /** Schedules the next attempt with deterministic exponential backoff. */
  async scheduleRetry(messageId: string): Promise<OutboxRetryOutcome> {
    const message = await this.repository.findById(messageId);
    if (message === null) {
      return { status: 'not_found' };
    }
    if (message.status !== 'failed') {
      return { status: 'not_applicable', message };
    }
    const delayMs = outboxRetryDelayMs(message.attempts);
    if (delayMs === null) {
      return { status: 'exhausted', message };
    }
    const nextAttemptAt = new Date(this.clock.now().getTime() + delayMs);
    const scheduled = await this.repository.scheduleRetry(messageId, nextAttemptAt);
    if (!scheduled) {
      return { status: 'not_applicable', message };
    }
    const updated = await this.repository.findById(messageId);
    if (updated === null) {
      return { status: 'not_found' };
    }
    return { status: 'scheduled', message: updated };
  }

  /** Moves an exhausted message to the dead letter exactly once. */
  async moveToDeadLetter(messageId: string): Promise<OutboxDeadLetterOutcome> {
    const message = await this.repository.findById(messageId);
    if (message === null) {
      return { status: 'not_found' };
    }
    if (message.status === 'dead_letter') {
      return { status: 'already_dead_lettered', message };
    }
    if (message.status !== 'failed') {
      return { status: 'not_applicable', message };
    }
    const now = this.clock.now();
    const failure =
      message.lastError ??
      ({
        code: 'outbox.dead_lettered',
        message: 'message dead-lettered without a recorded failure',
        retryable: false,
        occurredAt: now,
      } satisfies OutboxFailure);
    const record: DeadLetterRecord = {
      messageId: message.id,
      eventId: message.eventId,
      source: message.source,
      type: message.type,
      scope: message.scope,
      tenantId: message.tenantId,
      attempts: message.attempts,
      payload: message.payload,
      failure,
      deadLetteredAt: now,
    };
    const recorded = await this.deadLetterRepository.insert(record);
    if (!recorded) {
      return { status: 'already_dead_lettered', message };
    }
    await this.repository.markDeadLettered(messageId, now);
    this.eventPublisher.publishMessageDeadLettered({
      messageId: message.id,
      eventId: message.eventId,
      source: message.source,
      type: message.type,
      scope: message.scope,
      tenantId: message.tenantId,
      occurredAt: now,
    });
    const updated = await this.repository.findById(messageId);
    return { status: 'dead_lettered', message: updated ?? message };
  }

  /** Releases claimed messages whose lease has expired, returning them to pending. */
  async releaseStaleClaims(): Promise<number> {
    return this.repository.releaseStaleClaims(this.clock.now());
  }

  private resolveTenantId(scope: OutboxEnqueueCommand['scope'], tenantId: string | null | undefined): string | null {
    if (scope === 'tenant') {
      if (!isNonEmptyString(tenantId)) {
        throw new MissingTenantContextError(
          'Tenant-scoped outbox messages require a tenant id; the operation fails closed',
        );
      }
      if (tenantId.length > MAX_TENANT_ID_LENGTH) {
        throw new InvalidOutboxMessageError('Outbox tenant id exceeds the maximum allowed length');
      }
      return tenantId;
    }
    if (tenantId !== undefined && tenantId !== null) {
      throw new InvalidOutboxMessageError('Platform-scoped outbox messages must not carry a tenant id');
    }
    return null;
  }

  private assertIdentifier(value: string, label: string, maxLength: number): void {
    if (!isNonEmptyString(value)) {
      throw new InvalidOutboxMessageError(`Outbox ${label} is required and must be a non-empty string`);
    }
    if (value.length > maxLength) {
      throw new InvalidOutboxMessageError(`Outbox ${label} exceeds the maximum allowed length`);
    }
  }

  private buildFailure(error: unknown): OutboxFailure {
    const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
    const code =
      typeof candidate.code === 'string' && candidate.code.trim() !== ''
        ? candidate.code
        : DEFAULT_FAILURE_CODE;
    const retryable = typeof candidate.retryable === 'boolean' ? candidate.retryable : true;
    const message =
      typeof candidate.message === 'string' && candidate.message.trim() !== ''
        ? candidate.message
        : error;
    return {
      code,
      message: sanitizeErrorMessage(message, MAX_FAILURE_MESSAGE_LENGTH),
      retryable,
      occurredAt: this.clock.now(),
    };
  }

  private isValidDate(value: Date): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }
}
