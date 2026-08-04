import type { OutboxFailure, OutboxScope } from './types.js';

export interface OutboxDeliveryFailedEvent {
  readonly messageId: string;
  readonly eventId: string;
  readonly source: string;
  readonly type: string;
  readonly scope: OutboxScope;
  readonly tenantId: string | null;
  readonly attempts: number;
  readonly failure: OutboxFailure;
  readonly occurredAt: Date;
}

export interface OutboxMessageDeadLetteredEvent {
  readonly messageId: string;
  readonly eventId: string;
  readonly source: string;
  readonly type: string;
  readonly scope: OutboxScope;
  readonly tenantId: string | null;
  readonly occurredAt: Date;
}

export interface OutboxEventPublisher {
  publishDeliveryFailed(event: OutboxDeliveryFailedEvent): void;
  publishMessageDeadLettered(event: OutboxMessageDeadLetteredEvent): void;
}

export class NoopOutboxEventPublisher implements OutboxEventPublisher {
  publishDeliveryFailed(_event: OutboxDeliveryFailedEvent): void {}

  publishMessageDeadLettered(_event: OutboxMessageDeadLetteredEvent): void {}
}
