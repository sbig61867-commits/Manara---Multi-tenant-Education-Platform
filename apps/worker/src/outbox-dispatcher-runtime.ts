import {
  outboxAttemptsExhausted,
  sanitizeErrorMessage,
} from '@manara/outbox';
import type {
  DispatchResult,
  OutboxClaimCriteria,
  OutboxClock,
  OutboxFailure,
  OutboxMessage,
  OutboxRepository,
  OutboxService,
} from '@manara/outbox';
import type { OutboxDispatcherRegistry } from './dispatcher-registry.js';
import type { WorkerMetrics } from './metrics.js';

const MAX_FAILURE_MESSAGE_LENGTH = 1000;
const NOT_FOUND_FAILURE_CODE = 'outbox.dispatcher_not_found';
const DISPATCH_ERROR_FAILURE_CODE = 'outbox.dispatch_error';

export interface RuntimeLogger {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
  error(object: Record<string, unknown>, message?: string): void;
}

export interface OutboxDispatcherRuntimeOptions {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly claimLeaseMs: number;
  readonly staleClaimReleaseIntervalMs: number;
  readonly shutdownTimeoutMs: number;
  readonly claimScope: 'platform' | 'tenant';
  readonly claimTenantId: string | null;
  readonly workerId: string;
}

export interface OutboxDispatcherRuntimeDependencies {
  readonly repository: OutboxRepository;
  readonly service: OutboxService;
  readonly clock: OutboxClock;
  readonly registry: OutboxDispatcherRegistry;
  readonly metrics: WorkerMetrics;
  readonly logger: RuntimeLogger;
}

export interface CycleSummary {
  claimed: number;
  delivered: number;
  failed: number;
  retried: number;
  deadLettered: number;
  staleClaimsReleased: number;
  dispatchErrors: number;
}

export type WorkerRuntimePhase = 'stopped' | 'running' | 'stopping';

export interface WorkerRuntimeState {
  readonly phase: WorkerRuntimePhase;
  readonly loopInitialized: boolean;
  readonly shutdownStarted: boolean;
  readonly lastCycleAt: Date | null;
}

/**
 * Bounded outbox dispatcher runtime.
 *
 * Each cycle releases stale claims (interval-bounded), atomically claims a
 * batch of due messages under a lease, and dispatches every message through
 * the registry with per-message isolation. Delivered messages are marked
 * delivered (idempotent); failures are recorded, retried with the outbox
 * backoff policy, and dead-lettered after max attempts or when
 * non-retryable. Only messages returned by this instance's own claim are ever
 * dispatched; lease-lost transitions are rejected and left for re-claiming
 * (at-least-once).
 */
export class OutboxDispatcherRuntime {
  private phase: WorkerRuntimePhase = 'stopped';
  private loopInitialized = false;
  private shutdownStarted = false;
  private lastCycleAt: Date | null = null;
  private lastStaleReleaseAt = 0;
  private loopPromise: Promise<void> | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private sleepResolve: (() => void) | null = null;

  constructor(
    private readonly options: OutboxDispatcherRuntimeOptions,
    private readonly dependencies: OutboxDispatcherRuntimeDependencies,
  ) {}

  getState(): WorkerRuntimeState {
    return {
      phase: this.phase,
      loopInitialized: this.loopInitialized,
      shutdownStarted: this.shutdownStarted,
      lastCycleAt: this.lastCycleAt,
    };
  }

  getMetrics(): ReturnType<WorkerMetrics['getSnapshot']> {
    return this.dependencies.metrics.getSnapshot();
  }

  /** Starts the polling loop. Resolves once the loop is initialized. */
  async start(): Promise<void> {
    if (this.phase === 'running' || this.phase === 'stopping') {
      return;
    }
    this.phase = 'running';
    this.loopPromise = this.runLoop();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (this.loopInitialized || this.phase !== 'running') {
          clearInterval(timer);
          resolve();
        }
      }, 10);
      timer.unref();
    });
  }

  /**
   * Stops the loop: no new claims are made and in-flight work is awaited up to
   * the shutdown timeout, then the runtime settles to stopped.
   */
  async stop(): Promise<void> {
    if (this.phase === 'stopped') {
      return;
    }
    this.shutdownStarted = true;
    this.phase = 'stopping';
    if (this.sleepTimer !== null) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
      if (this.sleepResolve !== null) {
        this.sleepResolve();
        this.sleepResolve = null;
      }
    }
    const loop = this.loopPromise ?? Promise.resolve();
    await Promise.race([loop, this.waitFor(this.options.shutdownTimeoutMs)]);
    this.phase = 'stopped';
  }

  /**
   * Runs a single bounded cycle: stale-claim release (when due) followed by
   * one claim-and-dispatch pass. Public so tests and diagnostics can drive the
   * runtime deterministically.
   */
  async runCycle(): Promise<CycleSummary> {
    const summary: CycleSummary = {
      claimed: 0,
      delivered: 0,
      failed: 0,
      retried: 0,
      deadLettered: 0,
      staleClaimsReleased: 0,
      dispatchErrors: 0,
    };
    summary.staleClaimsReleased = await this.releaseStaleClaimsIfDue(summary);
    const now = this.dependencies.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.options.claimLeaseMs);
    const messages = await this.dependencies.repository.claimPending(
      this.buildClaimCriteria(),
      now,
      leaseExpiresAt,
    );
    this.dependencies.metrics.recordClaimed(messages.length);
    summary.claimed = messages.length;
    for (const message of messages) {
      await this.processMessage(message, summary);
    }
    this.lastCycleAt = new Date();
    return summary;
  }

  private async runLoop(): Promise<void> {
    while (this.phase === 'running') {
      this.loopInitialized = true;
      try {
        const summary = await this.runCycle();
        if (summary.claimed > 0) {
          continue;
        }
      } catch (error) {
        this.dependencies.logger.error(
          { event: 'worker_cycle_error', workerId: this.options.workerId, error },
          'Outbox cycle failed; backing off',
        );
      }
      await this.sleep(this.options.pollIntervalMs);
    }
  }

  private buildClaimCriteria(): OutboxClaimCriteria {
    if (this.options.claimScope === 'tenant') {
      return {
        scope: 'tenant',
        tenantId: this.options.claimTenantId ?? undefined,
        limit: this.options.batchSize,
      };
    }
    return { scope: 'platform', limit: this.options.batchSize };
  }

  private async releaseStaleClaimsIfDue(summary: CycleSummary): Promise<number> {
    const nowMs = this.dependencies.clock.now().getTime();
    if (nowMs - this.lastStaleReleaseAt < this.options.staleClaimReleaseIntervalMs) {
      return 0;
    }
    this.lastStaleReleaseAt = nowMs;
    const released = await this.dependencies.service.releaseStaleClaims();
    if (released > 0) {
      this.dependencies.metrics.recordStaleClaimsReleased(released);
      summary.staleClaimsReleased = released;
      this.dependencies.logger.info(
        { event: 'worker_stale_claims_released', workerId: this.options.workerId, released },
        'Released expired outbox claims',
      );
    }
    return released;
  }

  private async processMessage(message: OutboxMessage, summary: CycleSummary): Promise<void> {
    const base = {
      event: 'worker_dispatch',
      workerId: this.options.workerId,
      messageId: message.id,
      eventId: message.eventId,
      type: message.type,
      scope: message.scope,
      tenantId: message.tenantId,
      attempts: message.attempts,
    };
    const startedAt = performance.now();
    let dispatchResult: DispatchResult;
    let dispatchError: Error | null = null;
    try {
      const dispatcher = this.dependencies.registry.get(message.type);
      dispatchResult =
        dispatcher === null
          ? this.buildNotFoundResult(message)
          : await dispatcher.dispatch(message);
    } catch (error) {
      dispatchError = error instanceof Error ? error : new Error(String(error));
      dispatchResult = this.buildDispatchErrorResult(message, dispatchError);
    }
    const latencyMs = performance.now() - startedAt;
    this.dependencies.metrics.recordDispatchLatency(latencyMs);
    this.dependencies.logger.info(
      { ...base, outcome: dispatchResult.status, latencyMs: Math.round(latencyMs * 100) / 100 },
      'Dispatched outbox message',
    );

    if (dispatchResult.status === 'delivered') {
      await this.recordDelivery(message, base, summary);
      return;
    }
    summary.dispatchErrors += dispatchError === null ? 0 : 1;
    await this.recordFailure(message, dispatchResult, base, summary);
  }

  private async recordDelivery(
    message: OutboxMessage,
    base: Record<string, unknown>,
    summary: CycleSummary,
  ): Promise<void> {
    const outcome = await this.dependencies.service.markDelivered(message.id);
    if (outcome.status === 'delivered' || outcome.status === 'already_delivered') {
      this.dependencies.metrics.recordDelivered();
      summary.delivered += 1;
      this.dependencies.logger.info(
        { event: 'worker_message_delivered', ...base },
        'Outbox message delivered',
      );
      return;
    }
    if (outcome.status === 'not_applicable') {
      this.dependencies.logger.warn(
        { event: 'worker_lease_lost', ...base },
        'Lease expired before delivery was recorded; message will be redelivered',
      );
      return;
    }
    this.dependencies.logger.warn(
      { event: 'worker_message_missing', ...base },
      'Message disappeared before delivery could be recorded',
    );
  }

  private async recordFailure(
    message: OutboxMessage,
    dispatchResult: DispatchResult,
    base: Record<string, unknown>,
    summary: CycleSummary,
  ): Promise<void> {
    const failure = this.normalizeFailure(dispatchResult.attempt.failure);
    const recorded = await this.dependencies.service.markFailed(message.id, failure);
    if (recorded.status !== 'failure_recorded') {
      if (recorded.status === 'not_applicable') {
        this.dependencies.logger.warn(
          { event: 'worker_lease_lost', ...base, failureCode: failure.code },
          'Lease expired before the failure was recorded; message will be redelivered',
        );
      } else {
        this.dependencies.logger.warn(
          { event: 'worker_message_missing', ...base },
          'Message disappeared before the failure could be recorded',
        );
      }
      return;
    }
    this.dependencies.metrics.recordFailed();
    summary.failed += 1;
    const updated = recorded.message;
    const exhausted = outboxAttemptsExhausted(updated.attempts);
    if (!failure.retryable || exhausted) {
      const deadLettered = await this.dependencies.service.moveToDeadLetter(message.id);
      if (deadLettered.status === 'dead_lettered' || deadLettered.status === 'already_dead_lettered') {
        this.dependencies.metrics.recordDeadLettered();
        summary.deadLettered += 1;
        this.dependencies.logger.info(
          {
            event: 'worker_message_dead_lettered',
            ...base,
            failureCode: failure.code,
            reason: exhausted ? 'max_attempts' : 'non_retryable',
          },
          'Outbox message dead-lettered',
        );
      }
      return;
    }
    const retry = await this.dependencies.service.scheduleRetry(message.id);
    if (retry.status === 'scheduled') {
      this.dependencies.metrics.recordRetried();
      summary.retried += 1;
      this.dependencies.logger.info(
        {
          event: 'worker_retry_scheduled',
          ...base,
          failureCode: failure.code,
          nextAttemptAt: retry.message.nextAttemptAt?.toISOString(),
        },
        'Outbox retry scheduled',
      );
    }
  }

  private buildNotFoundResult(message: OutboxMessage): DispatchResult {
    return {
      messageId: message.id,
      status: 'failed',
      attempt: {
        attemptNumber: message.attempts + 1,
        attemptedAt: this.dependencies.clock.now(),
        outcome: 'failed',
        failure: {
          code: NOT_FOUND_FAILURE_CODE,
          message: `no dispatcher registered for event type "${message.type}"`,
          retryable: true,
          occurredAt: this.dependencies.clock.now(),
        },
      },
    };
  }

  private buildDispatchErrorResult(message: OutboxMessage, error: Error): DispatchResult {
    return {
      messageId: message.id,
      status: 'failed',
      attempt: {
        attemptNumber: message.attempts + 1,
        attemptedAt: this.dependencies.clock.now(),
        outcome: 'failed',
        failure: this.errorToFailure(error),
      },
    };
  }

  private errorToFailure(error: Error): OutboxFailure {
    const candidate = error as { code?: unknown; retryable?: unknown };
    const code =
      typeof candidate.code === 'string' && candidate.code.trim() !== ''
        ? candidate.code
        : DISPATCH_ERROR_FAILURE_CODE;
    const retryable = typeof candidate.retryable === 'boolean' ? candidate.retryable : true;
    return {
      code,
      message: sanitizeErrorMessage(error, MAX_FAILURE_MESSAGE_LENGTH),
      retryable,
      occurredAt: this.dependencies.clock.now(),
    };
  }

  private normalizeFailure(failure: OutboxFailure | null): OutboxFailure {
    if (failure === null) {
      return {
        code: DISPATCH_ERROR_FAILURE_CODE,
        message: 'dispatch failed without a recorded failure',
        retryable: true,
        occurredAt: this.dependencies.clock.now(),
      };
    }
    return {
      code: failure.code,
      message: sanitizeErrorMessage(failure.message, MAX_FAILURE_MESSAGE_LENGTH),
      retryable: failure.retryable,
      occurredAt: failure.occurredAt ?? this.dependencies.clock.now(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepResolve = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  private waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }
}
