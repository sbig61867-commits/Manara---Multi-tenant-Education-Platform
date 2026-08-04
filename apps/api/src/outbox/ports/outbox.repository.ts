import type { OutboxClaimCriteria, OutboxFailure, OutboxMessage } from '../domain/types.js';

/**
 * Provider-neutral outbox persistence contract.
 *
 * Transaction contract (same-transaction enqueue): `insert` must be executed on
 * the caller's ambient database transaction. Producers call `enqueue` inside the
 * transaction that also performs their business write; the outbox row then
 * commits or rolls back atomically with the business action (Decision Log #6).
 * Implementations must join the ambient transaction (e.g., a
 * transactional executor whose queries attach to the active transaction) and
 * must never open, commit, or roll back transactions on their own.
 *
 * Concurrency contract (safe concurrent workers): `claimPending` must claim
 * messages atomically so concurrent claims never deliver the same message
 * twice (e.g., `SELECT ... FOR UPDATE SKIP LOCKED`), granting a lease that
 * expires at `leaseExpiresAt`. Success and failure transitions apply only to
 * the message currently held under its claim lease.
 */
export interface OutboxRepository {
  /** Inserts on the caller's ambient transaction. Returns false when the event id already exists (idempotent enqueue). */
  insert(message: OutboxMessage): Promise<boolean>;

  findById(id: string): Promise<OutboxMessage | null>;

  findByEventId(eventId: string): Promise<OutboxMessage | null>;

  /** Atomically claims due pending messages matching the criteria, leasing them until `leaseExpiresAt`. */
  claimPending(criteria: OutboxClaimCriteria, now: Date, leaseExpiresAt: Date): Promise<OutboxMessage[]>;

  /** Marks a claimed message delivered. Returns false when the message is not claimable (idempotent success). */
  markDelivered(id: string, deliveredAt: Date): Promise<boolean>;

  /** Records a failure on a claimed message, incrementing attempts and moving it to failed. */
  markFailed(id: string, failure: OutboxFailure): Promise<boolean>;

  /** Moves a failed message back to pending with a scheduled next attempt. */
  scheduleRetry(id: string, nextAttemptAt: Date): Promise<boolean>;

  /** Moves a failed message to dead_letter. Returns false when not eligible (exactly-once dead-lettering). */
  markDeadLettered(id: string, deadLetteredAt: Date): Promise<boolean>;

  /** Releases claimed messages whose lease has expired, returning them to pending. Returns the released count. */
  releaseStaleClaims(now: Date): Promise<number>;
}
