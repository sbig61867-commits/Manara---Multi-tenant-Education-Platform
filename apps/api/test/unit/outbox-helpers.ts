import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { OutboxEventPublisher } from '../../src/outbox/domain/events.js';
import type {
  DeadLetterRecord,
  OutboxClaimCriteria,
  OutboxEnqueueCommand,
  OutboxFailure,
  OutboxMessage,
} from '../../src/outbox/domain/types.js';
import type { DeadLetterRepository } from '../../src/outbox/ports/dead-letter.repository.js';
import type { OutboxClock } from '../../src/outbox/ports/outbox-clock.js';
import type { OutboxRepository } from '../../src/outbox/ports/outbox.repository.js';

function isDue(message: OutboxMessage, now: Date): boolean {
  return message.nextAttemptAt === null || message.nextAttemptAt.getTime() <= now.getTime();
}

export class FakeOutboxRepository implements OutboxRepository {
  readonly messages = new Map<string, OutboxMessage>();

  async insert(message: OutboxMessage): Promise<boolean> {
    if (this.findByEventIdSync(message.eventId) !== null) {
      return false;
    }
    this.messages.set(message.id, message);
    return true;
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    return this.messages.get(id) ?? null;
  }

  async findByEventId(eventId: string): Promise<OutboxMessage | null> {
    return this.findByEventIdSync(eventId);
  }

  async claimPending(criteria: OutboxClaimCriteria, now: Date, leaseExpiresAt: Date): Promise<OutboxMessage[]> {
    const claimed: OutboxMessage[] = [];
    for (const message of this.messages.values()) {
      if (claimed.length >= (criteria.limit ?? 10)) {
        break;
      }
      if (message.status !== 'pending' || !isDue(message, now)) {
        continue;
      }
      if (message.scope !== criteria.scope) {
        continue;
      }
      if (criteria.scope === 'tenant' && message.tenantId !== criteria.tenantId) {
        continue;
      }
      const updated: OutboxMessage = {
        ...message,
        status: 'claimed',
        leaseExpiresAt,
        updatedAt: now,
      };
      this.messages.set(message.id, updated);
      claimed.push(updated);
    }
    return claimed;
  }

  async markDelivered(id: string, deliveredAt: Date): Promise<boolean> {
    const message = this.messages.get(id);
    if (message === undefined || message.status === 'delivered') {
      return false;
    }
    if (message.status !== 'claimed') {
      return false;
    }
    this.messages.set(id, { ...message, status: 'delivered', updatedAt: deliveredAt });
    return true;
  }

  async markFailed(id: string, failure: OutboxFailure): Promise<boolean> {
    const message = this.messages.get(id);
    if (message === undefined || message.status !== 'claimed') {
      return false;
    }
    this.messages.set(id, {
      ...message,
      status: 'failed',
      attempts: message.attempts + 1,
      lastError: failure,
      updatedAt: failure.occurredAt,
    });
    return true;
  }

  async scheduleRetry(id: string, nextAttemptAt: Date): Promise<boolean> {
    const message = this.messages.get(id);
    if (message === undefined || message.status !== 'failed') {
      return false;
    }
    this.messages.set(id, {
      ...message,
      status: 'pending',
      nextAttemptAt,
      leaseExpiresAt: null,
      updatedAt: nextAttemptAt,
    });
    return true;
  }

  async markDeadLettered(id: string, deadLetteredAt: Date): Promise<boolean> {
    const message = this.messages.get(id);
    if (message === undefined || message.status !== 'failed') {
      return false;
    }
    this.messages.set(id, { ...message, status: 'dead_letter', updatedAt: deadLetteredAt });
    return true;
  }

  async releaseStaleClaims(now: Date): Promise<number> {
    let released = 0;
    for (const message of this.messages.values()) {
      if (
        message.status === 'claimed' &&
        message.leaseExpiresAt !== null &&
        message.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        this.messages.set(message.id, {
          ...message,
          status: 'pending',
          leaseExpiresAt: null,
          updatedAt: now,
        });
        released += 1;
      }
    }
    return released;
  }

  private findByEventIdSync(eventId: string): OutboxMessage | null {
    for (const message of this.messages.values()) {
      if (message.eventId === eventId) {
        return message;
      }
    }
    return null;
  }
}

export class FakeDeadLetterRepository implements DeadLetterRepository {
  readonly records = new Map<string, DeadLetterRecord>();

  async insert(record: DeadLetterRecord): Promise<boolean> {
    if (this.records.has(record.messageId)) {
      return false;
    }
    this.records.set(record.messageId, record);
    return true;
  }

  async findById(messageId: string): Promise<DeadLetterRecord | null> {
    return this.records.get(messageId) ?? null;
  }
}

export class FakeOutboxClock implements OutboxClock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class RecordingOutboxEventPublisher implements OutboxEventPublisher {
  readonly deliveryFailed: Array<Parameters<OutboxEventPublisher['publishDeliveryFailed']>[0]> = [];
  readonly deadLettered: Array<Parameters<OutboxEventPublisher['publishMessageDeadLettered']>[0]> = [];

  publishDeliveryFailed(event: Parameters<OutboxEventPublisher['publishDeliveryFailed']>[0]): void {
    this.deliveryFailed.push(event);
  }

  publishMessageDeadLettered(event: Parameters<OutboxEventPublisher['publishMessageDeadLettered']>[0]): void {
    this.deadLettered.push(event);
  }
}

export function createOutboxMessage(overrides?: Partial<OutboxMessage>): OutboxMessage {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: randomUUID(),
    eventId: `order:created:tenant-1:${randomUUID()}`,
    source: 'order',
    type: 'created',
    scope: 'tenant',
    tenantId: 'tenant-1',
    payload: { orderId: 'order-1' },
    status: 'pending',
    attempts: 0,
    lastError: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createOutboxEnqueueCommand(overrides?: Partial<OutboxEnqueueCommand>): OutboxEnqueueCommand {
  return {
    scope: 'tenant',
    tenantId: 'tenant-1',
    eventSource: 'order',
    eventType: 'created',
    occurrenceId: randomUUID(),
    payload: { orderId: 'order-1' },
    ...overrides,
  };
}
