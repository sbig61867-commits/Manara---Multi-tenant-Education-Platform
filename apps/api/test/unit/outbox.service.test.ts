import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTBOX_DEFAULT_CLAIM_LEASE_MS } from '../../src/outbox/application/backoff.js';
import {
  InvalidOutboxClaimError,
  InvalidOutboxMessageError,
  MissingTenantContextError,
} from '../../src/outbox/domain/errors.js';
import type { OutboxClaimCriteria, OutboxFailure, OutboxMessage } from '../../src/outbox/domain/types.js';
import { OutboxService } from '../../src/outbox/application/outbox.service.js';
import type { DeadLetterRepository } from '../../src/outbox/ports/dead-letter.repository.js';
import type { OutboxClock } from '../../src/outbox/ports/outbox-clock.js';
import type { OutboxEventPublisher } from '../../src/outbox/domain/events.js';
import type { OutboxRepository } from '../../src/outbox/ports/outbox.repository.js';
import {
  createOutboxEnqueueCommand,
  createOutboxMessage,
  FakeDeadLetterRepository,
  FakeOutboxClock,
  FakeOutboxRepository,
  RecordingOutboxEventPublisher,
} from './outbox-helpers.js';

function createHarness<TR extends OutboxRepository = FakeOutboxRepository>(options?: {
  repo?: TR;
  deadLetters?: DeadLetterRepository;
  clock?: OutboxClock;
  publisher?: OutboxEventPublisher;
}) {
  const repo = options?.repo ?? new FakeOutboxRepository();
  const deadLetters = options?.deadLetters ?? new FakeDeadLetterRepository();
  const clock = options?.clock ?? new FakeOutboxClock();
  const publisher = options?.publisher ?? new RecordingOutboxEventPublisher();
  const service = new OutboxService(repo, deadLetters, publisher, clock);
  return { service, repo, deadLetters, clock, publisher };
}

test('enqueue persists a tenant-scoped message with a deterministic event id', async () => {
  const { service, repo } = createHarness();
  const outcome = await service.enqueue(
    createOutboxEnqueueCommand({ eventSource: 'order', eventType: 'created', occurrenceId: 'occ-1' }),
  );
  assert.equal(outcome.status, 'enqueued');
  if (outcome.status !== 'enqueued') {
    return;
  }
  assert.equal(outcome.message.scope, 'tenant');
  assert.equal(outcome.message.tenantId, 'tenant-1');
  assert.equal(outcome.message.status, 'pending');
  assert.equal(outcome.message.attempts, 0);
  assert.equal(outcome.message.eventId, 'order:created:tenant-1:occ-1');
  assert.equal(repo.messages.size, 1);
});

test('enqueue is idempotent for the same deterministic event id', async () => {
  const { service, repo } = createHarness();
  const command = createOutboxEnqueueCommand({ occurrenceId: 'occ-1' });
  const first = await service.enqueue(command);
  const second = await service.enqueue(command);
  assert.equal(first.status, 'enqueued');
  assert.equal(second.status, 'already_exists');
  if (second.status === 'already_exists' && first.status === 'enqueued') {
    assert.equal(second.message.eventId, first.message.eventId);
  }
  assert.equal(repo.messages.size, 1);
});

test('enqueue fails closed when a tenant-scoped message has no tenant id', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ tenantId: null })),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
  assert.equal(repo.messages.size, 0);
});

test('enqueue rejects a platform-scoped message that carries a tenant id', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ scope: 'platform', tenantId: 'tenant-1' })),
    (error: unknown) => error instanceof InvalidOutboxMessageError,
  );
  assert.equal(repo.messages.size, 0);
});

test('enqueue supports platform-scoped messages without a tenant id', async () => {
  const { service } = createHarness();
  const outcome = await service.enqueue(
    createOutboxEnqueueCommand({ scope: 'platform', tenantId: null, eventType: 'broadcast' }),
  );
  assert.equal(outcome.status, 'enqueued');
  if (outcome.status === 'enqueued') {
    assert.equal(outcome.message.tenantId, null);
    assert.equal(outcome.message.scope, 'platform');
    assert.ok(outcome.message.eventId.includes(':platform:'));
  }
});

test('enqueue validates identifiers and rejects invalid or oversized values', async () => {
  const { service } = createHarness();
  const overSizedSource = createOutboxEnqueueCommand({ eventSource: 'x'.repeat(33) });
  const overSizedType = createOutboxEnqueueCommand({ eventType: 'x'.repeat(129) });
  const overSizedOccurrence = createOutboxEnqueueCommand({ occurrenceId: 'x'.repeat(201) });
  for (const command of [
    createOutboxEnqueueCommand({ eventSource: '' }),
    createOutboxEnqueueCommand({ eventType: '  ' }),
    createOutboxEnqueueCommand({ occurrenceId: '' }),
    overSizedSource,
    overSizedType,
    overSizedOccurrence,
  ]) {
    await assert.rejects(
      () => service.enqueue(command),
      (error: unknown) => error instanceof InvalidOutboxMessageError,
    );
  }
});

test('enqueue rejects payloads over the maximum allowed size', async () => {
  const { service, repo } = createHarness();
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ payload: { data: 'x'.repeat(70_000) } })),
    (error: unknown) => error instanceof InvalidOutboxMessageError,
  );
  assert.equal(repo.messages.size, 0);
});

test('enqueue accepts payloads within the allowed size', async () => {
  const { service } = createHarness();
  const outcome = await service.enqueue(
    createOutboxEnqueueCommand({ payload: { data: 'x'.repeat(60_000) } }),
  );
  assert.equal(outcome.status, 'enqueued');
});

test('enqueue honors a future scheduledAt and rejects invalid dates', async () => {
  const { service } = createHarness();
  const future = new Date('2030-01-01T00:00:00.000Z');
  const scheduled = await service.enqueue(createOutboxEnqueueCommand({ scheduledAt: future }));
  assert.equal(scheduled.status, 'enqueued');
  if (scheduled.status === 'enqueued') {
    assert.equal(scheduled.message.nextAttemptAt?.getTime(), future.getTime());
  }
  await assert.rejects(
    () => service.enqueue(createOutboxEnqueueCommand({ scheduledAt: new Date('not-a-date') })),
    (error: unknown) => error instanceof InvalidOutboxMessageError,
  );
});

test('enqueue redacts sensitive payload keys before persistence', async () => {
  const { service, repo } = createHarness();
  await service.enqueue(
    createOutboxEnqueueCommand({ payload: { orderId: 'o-1', sessionToken: 'raw' } }),
  );
  const message = [...repo.messages.values()][0];
  assert.equal(message?.payload.sessionToken, '[REDACTED]');
  assert.equal(message?.payload.orderId, 'o-1');
});

test('enqueue joins the ambient transaction: inserts commit or roll back with the caller', async () => {
  const tx = new TransactionalFakeOutboxRepository();
  const { service } = createHarness({ repo: tx });
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  assert.equal(tx.pending.size, 1);
  assert.equal(await tx.findById('any-id'), null);
  tx.commit();
  assert.equal(tx.committed.size, 1);
  assert.notEqual(await tx.findByEventId('order:created:tenant-1:occ-1'), null);
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-2' }));
  assert.equal(tx.pending.size, 1);
  tx.rollback();
  assert.equal(tx.pending.size, 0);
  assert.equal(await tx.findByEventId('order:created:tenant-1:occ-2'), null);
});

test('claimPending claims due tenant messages with a lease', async () => {
  const { service, clock } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-2' }));
  const now = clock.now();
  const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.equal(claimed.length, 2);
  for (const item of claimed) {
    assert.equal(item.message.status, 'claimed');
    assert.equal(item.claim.claimedAt.getTime(), now.getTime());
    assert.equal(item.claim.leaseExpiresAt.getTime(), now.getTime() + OUTBOX_DEFAULT_CLAIM_LEASE_MS);
  }
});

test('claimPending never claims future-scheduled messages', async () => {
  const { service } = createHarness();
  await service.enqueue(
    createOutboxEnqueueCommand({ occurrenceId: 'occ-1', scheduledAt: new Date('2030-01-01T00:00:00.000Z') }),
  );
  const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.equal(claimed.length, 0);
});

test('claimPending enforces tenant isolation', async () => {
  const { service } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  await service.enqueue(
    createOutboxEnqueueCommand({ occurrenceId: 'occ-2', tenantId: 'tenant-2' }),
  );
  const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.message.tenantId, 'tenant-1');
});

test('claimPending requires a tenant id for tenant scope and forbids one for platform scope', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.claimPending({ scope: 'tenant' }),
    (error: unknown) => error instanceof InvalidOutboxClaimError,
  );
  await assert.rejects(
    () => service.claimPending({ scope: 'platform', tenantId: 'tenant-1' }),
    (error: unknown) => error instanceof InvalidOutboxClaimError,
  );
  await assert.rejects(
    () => service.claimPending({ scope: 'global' as OutboxClaimCriteria['scope'] }),
    (error: unknown) => error instanceof InvalidOutboxClaimError,
  );
});

test('claimPending validates the limit bounds', async () => {
  const { service } = createHarness();
  for (const limit of [0, -1, 101, 2.5]) {
    await assert.rejects(
      () => service.claimPending({ scope: 'tenant', tenantId: 'tenant-1', limit }),
      (error: unknown) => error instanceof InvalidOutboxClaimError,
    );
  }
  const outcome = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1', limit: 1 });
  assert.equal(outcome.length, 0);
});

test('claimPending respects the requested limit', async () => {
  const { service } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-2' }));
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-3' }));
  const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1', limit: 2 });
  assert.equal(claimed.length, 2);
});

test('markDelivered delivers a claimed message and is idempotent', async () => {
  const { service } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const outcome = await service.markDelivered(claimed?.message.id ?? 'missing');
  assert.equal(outcome.status, 'delivered');
  if (outcome.status === 'delivered') {
    assert.equal(outcome.message.status, 'delivered');
  }
  const again = await service.markDelivered(claimed?.message.id ?? 'missing');
  assert.equal(again.status, 'already_delivered');
});

test('markDelivered reports not found and not applicable outcomes', async () => {
  const { service } = createHarness();
  assert.equal((await service.markDelivered('missing')).status, 'not_found');
  const outcome = await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  assert.equal(outcome.status, 'enqueued');
  if (outcome.status === 'enqueued') {
    const result = await service.markDelivered(outcome.message.id);
    assert.equal(result.status, 'not_applicable');
  }
});

test('markFailed records a sanitized failure, increments attempts, and publishes an event', async () => {
  const { service, publisher } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const outcome = await service.markFailed(claimed?.message.id ?? 'missing', {
    code: 'order.dispatch_timeout',
    message: '  upstream   timeout  ',
    retryable: true,
  });
  assert.equal(outcome.status, 'failure_recorded');
  if (outcome.status === 'failure_recorded') {
    assert.equal(outcome.message.status, 'failed');
    assert.equal(outcome.message.attempts, 1);
    assert.equal(outcome.message.lastError?.code, 'order.dispatch_timeout');
    assert.equal(outcome.message.lastError?.message, 'upstream timeout');
    assert.equal(outcome.message.lastError?.retryable, true);
  }
  assert.equal(publisher.deliveryFailed.length, 1);
  assert.equal(publisher.deliveryFailed[0]?.attempts, 1);
  assert.equal(publisher.deliveryFailed[0]?.failure.message, 'upstream timeout');
});

test('markFailed sanitizes error instances and honors the retryable flag', async () => {
  const { service, clock } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const messageId = claimed?.message.id ?? 'missing';
  const first = await service.markFailed(messageId, new Error('kaboom'));
  assert.equal(first.status, 'failure_recorded');
  if (first.status === 'failure_recorded') {
    assert.equal(first.message.lastError?.message, 'kaboom');
    assert.equal(first.message.lastError?.retryable, true);
  }
  const retry = await service.scheduleRetry(messageId);
  assert.equal(retry.status, 'scheduled');
  clock.advanceBy(60_000);
  const reclaimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.equal(reclaimed.length, 1);
  const withFlag = await service.markFailed(messageId, { retryable: false });
  assert.equal(withFlag.status, 'failure_recorded');
  if (withFlag.status === 'failure_recorded') {
    assert.equal(withFlag.message.attempts, 2);
    assert.equal(withFlag.message.lastError?.retryable, false);
    assert.equal(withFlag.message.lastError?.code, 'outbox.delivery_failed');
  }
});

test('markFailed rejects terminal states', async () => {
  const { service } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  assert.equal((await service.markFailed('missing', new Error('x'))).status, 'not_found');
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  await service.markDelivered(claimed?.message.id ?? 'missing');
  const outcome = await service.markFailed(claimed?.message.id ?? 'missing', new Error('x'));
  assert.equal(outcome.status, 'not_applicable');
});

test('scheduleRetry applies deterministic backoff and exhausts after the max attempts', async () => {
  const { service, clock } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  let messageId: string | undefined;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
    assert.equal(claimed.length, 1);
    messageId = claimed[0]?.message.id;
    const failed = await service.markFailed(messageId ?? 'missing', new Error(`boom-${attempt}`));
    if (failed.status === 'failure_recorded') {
      assert.equal(failed.message.attempts, attempt);
    }
    const retry = await service.scheduleRetry(messageId ?? 'missing');
    if (attempt < 5) {
      assert.equal(retry.status, 'scheduled');
      if (retry.status === 'scheduled') {
        const delayMs = [60_000, 300_000, 900_000, 3_600_000][attempt - 1] as number;
        assert.equal(
          retry.message.nextAttemptAt?.getTime(),
          clock.now().getTime() + delayMs,
        );
      }
      clock.advanceBy([60_000, 300_000, 900_000, 3_600_000][attempt - 1] as number);
    } else {
      assert.equal(retry.status, 'exhausted');
    }
  }
});

test('scheduleRetry only schedules failed messages', async () => {
  const { service } = createHarness();
  assert.equal((await service.scheduleRetry('missing')).status, 'not_found');
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const outcome = await service.scheduleRetry(claimed?.message.id ?? 'missing');
  assert.equal(outcome.status, 'not_applicable');
});

test('moveToDeadLetter records exactly once and publishes an event', async () => {
  const { service, deadLetters, publisher } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const messageId = claimed?.message.id ?? 'missing';
  await service.markFailed(messageId, { code: 'order.dispatch_timeout', message: 'boom', retryable: false });
  const outcome = await service.moveToDeadLetter(messageId);
  assert.equal(outcome.status, 'dead_lettered');
  if (outcome.status === 'dead_lettered') {
    assert.equal(outcome.message.status, 'dead_letter');
  }
  const record = await deadLetters.findById(messageId);
  assert.notEqual(record, null);
  assert.equal(record?.failure.code, 'order.dispatch_timeout');
  assert.equal(record?.attempts, 1);
  assert.equal(publisher.deadLettered.length, 1);
  const again = await service.moveToDeadLetter(messageId);
  assert.equal(again.status, 'already_dead_lettered');
  assert.equal(deadLetters.records.size, 1);
});

test('moveToDeadLetter falls back to a synthetic failure when none was recorded', async () => {
  const { service, deadLetters, repo } = createHarness();
  const message = createOutboxMessage({ status: 'failed', attempts: 3, lastError: null });
  repo.messages.set(message.id, message);
  const outcome = await service.moveToDeadLetter(message.id);
  assert.equal(outcome.status, 'dead_lettered');
  const stored = await deadLetters.findById(message.id);
  assert.equal(stored?.failure.code, 'outbox.dead_lettered');
  assert.equal(stored?.failure.retryable, false);
  assert.equal(stored?.attempts, 3);
});

test('moveToDeadLetter rejects messages that are not failed', async () => {
  const { service } = createHarness();
  assert.equal((await service.moveToDeadLetter('missing')).status, 'not_found');
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  const [claimed] = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  const outcome = await service.moveToDeadLetter(claimed?.message.id ?? 'missing');
  assert.equal(outcome.status, 'not_applicable');
});

test('releaseStaleClaims returns only expired leases to pending', async () => {
  const { service, clock } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-1' }));
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-2' }));
  await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  clock.advanceBy(OUTBOX_DEFAULT_CLAIM_LEASE_MS + 1);
  assert.equal(await service.releaseStaleClaims(), 2);
  const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
  assert.equal(claimed.length, 2);
  clock.advanceBy(OUTBOX_DEFAULT_CLAIM_LEASE_MS - 1);
  assert.equal(await service.releaseStaleClaims(), 0);
});

test('a full message lifecycle reaches the dead letter exactly once', async () => {
  const { service, deadLetters, clock } = createHarness();
  await service.enqueue(createOutboxEnqueueCommand({ occurrenceId: 'occ-lifecycle' }));
  const delays = [60_000, 300_000, 900_000, 3_600_000];
  let messageId: string | undefined;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claimed = await service.claimPending({ scope: 'tenant', tenantId: 'tenant-1' });
    messageId = claimed[0]?.message.id;
    await service.markFailed(messageId ?? 'missing', new Error(`boom-${attempt}`));
    const retry = await service.scheduleRetry(messageId ?? 'missing');
    if (attempt < 5) {
      assert.equal(retry.status, 'scheduled');
      clock.advanceBy(delays[attempt - 1] as number);
    } else {
      assert.equal(retry.status, 'exhausted');
    }
  }
  const deadLettered = await service.moveToDeadLetter(messageId ?? 'missing');
  assert.equal(deadLettered.status, 'dead_lettered');
  assert.equal(deadLetters.records.size, 1);
  const final = await service.moveToDeadLetter(messageId ?? 'missing');
  assert.equal(final.status, 'already_dead_lettered');
});

class TransactionalFakeOutboxRepository implements OutboxRepository {
  readonly pending = new Map<string, OutboxMessage>();
  readonly committed = new Map<string, OutboxMessage>();

  async insert(message: OutboxMessage): Promise<boolean> {
    if (this.findByEventIdSync(message.eventId) !== null) {
      return false;
    }
    this.pending.set(message.id, message);
    return true;
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    return this.pending.get(id) ?? this.committed.get(id) ?? null;
  }

  async findByEventId(eventId: string): Promise<OutboxMessage | null> {
    return this.findByEventIdSync(eventId);
  }

  async claimPending(_criteria: OutboxClaimCriteria, _now: Date, _leaseExpiresAt: Date): Promise<OutboxMessage[]> {
    return [];
  }

  async markDelivered(_id: string, _deliveredAt: Date): Promise<boolean> {
    return false;
  }

  async markFailed(_id: string, _failure: OutboxFailure): Promise<boolean> {
    return false;
  }

  async scheduleRetry(_id: string, _nextAttemptAt: Date): Promise<boolean> {
    return false;
  }

  async markDeadLettered(_id: string, _deadLetteredAt: Date): Promise<boolean> {
    return false;
  }

  async releaseStaleClaims(_now: Date): Promise<number> {
    return 0;
  }

  commit(): void {
    for (const [id, message] of this.pending) {
      this.committed.set(id, message);
    }
    this.pending.clear();
  }

  rollback(): void {
    this.pending.clear();
  }

  private findByEventIdSync(eventId: string): OutboxMessage | null {
    for (const message of [...this.pending.values(), ...this.committed.values()]) {
      if (message.eventId === eventId) {
        return message;
      }
    }
    return null;
  }
}
