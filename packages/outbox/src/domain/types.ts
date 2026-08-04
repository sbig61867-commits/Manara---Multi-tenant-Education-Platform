export type OutboxScope = 'tenant' | 'platform';

export type OutboxStatus = 'pending' | 'claimed' | 'delivered' | 'failed' | 'dead_letter';

export interface OutboxPayload {
  readonly [key: string]:
    | string
    | number
    | boolean
    | null
    | OutboxPayload
    | Array<string | number | boolean | null | OutboxPayload>;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly source: string;
  readonly type: string;
  readonly scope: OutboxScope;
  readonly tenantId: string | null;
  readonly occurredAt: Date;
  readonly payload: OutboxPayload;
}

export interface OutboxFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly occurredAt: Date;
}

export interface OutboxDeliveryAttempt {
  readonly attemptNumber: number;
  readonly attemptedAt: Date;
  readonly outcome: 'delivered' | 'failed';
  readonly failure: OutboxFailure | null;
}

export interface OutboxClaim {
  readonly messageId: string;
  readonly claimedAt: Date;
  readonly leaseExpiresAt: Date;
}

export interface OutboxMessage {
  readonly id: string;
  readonly eventId: string;
  readonly source: string;
  readonly type: string;
  readonly scope: OutboxScope;
  readonly tenantId: string | null;
  readonly payload: OutboxPayload;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly lastError: OutboxFailure | null;
  readonly leaseExpiresAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OutboxClaimedMessage {
  readonly message: OutboxMessage;
  readonly claim: OutboxClaim;
}

export interface DeadLetterRecord {
  readonly messageId: string;
  readonly eventId: string;
  readonly source: string;
  readonly type: string;
  readonly scope: OutboxScope;
  readonly tenantId: string | null;
  readonly attempts: number;
  readonly payload: OutboxPayload;
  readonly failure: OutboxFailure;
  readonly deadLetteredAt: Date;
}

export interface DispatchResult {
  readonly messageId: string;
  readonly status: 'delivered' | 'failed';
  readonly attempt: OutboxDeliveryAttempt;
}

export interface OutboxEnqueueCommand {
  readonly scope: OutboxScope;
  readonly tenantId?: string | null;
  readonly eventSource: string;
  readonly eventType: string;
  readonly occurrenceId: string;
  readonly payload: OutboxPayload;
  readonly scheduledAt?: Date | null;
}

export type OutboxEnqueueOutcome =
  | { readonly status: 'enqueued'; readonly message: OutboxMessage }
  | { readonly status: 'already_exists'; readonly message: OutboxMessage };

export interface OutboxClaimCriteria {
  readonly scope: OutboxScope;
  readonly tenantId?: string;
  readonly limit?: number;
}

export type OutboxDeliveryOutcome =
  | { readonly status: 'delivered'; readonly message: OutboxMessage }
  | { readonly status: 'already_delivered'; readonly message: OutboxMessage }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_applicable'; readonly message: OutboxMessage };

export type OutboxFailureOutcome =
  | { readonly status: 'failure_recorded'; readonly message: OutboxMessage }
  | { readonly status: 'not_applicable'; readonly message: OutboxMessage }
  | { readonly status: 'not_found' };

export type OutboxRetryOutcome =
  | { readonly status: 'scheduled'; readonly message: OutboxMessage }
  | { readonly status: 'exhausted'; readonly message: OutboxMessage }
  | { readonly status: 'not_applicable'; readonly message: OutboxMessage }
  | { readonly status: 'not_found' };

export type OutboxDeadLetterOutcome =
  | { readonly status: 'dead_lettered'; readonly message: OutboxMessage }
  | { readonly status: 'already_dead_lettered'; readonly message: OutboxMessage }
  | { readonly status: 'not_applicable'; readonly message: OutboxMessage }
  | { readonly status: 'not_found' };
