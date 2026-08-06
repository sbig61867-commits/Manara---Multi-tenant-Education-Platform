import type { DispatchResult, OutboxClock, OutboxDispatcher, OutboxMessage } from '@manara/outbox';
import type { RuntimeLogger } from './outbox-dispatcher-runtime.js';
import type { WorkerMetrics } from './metrics.js';

/**
 * Failure code recorded for messages whose event type is explicitly declared
 * as having no delivery target yet. Retries and dead-letters through the
 * standard outbox pipeline; it is never marked delivered.
 */
export const OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE = 'outbox.event_type_unsupported';

export interface UnsupportedOutboxDispatcherDependencies {
  readonly logger: RuntimeLogger;
  readonly metrics: WorkerMetrics;
  readonly clock: OutboxClock;
}

/**
 * Explicit policy for event types that intentionally have no delivery target.
 *
 * The message is failed as retryable with a dedicated failure code so it
 * follows the standard retry/dead-letter lifecycle. A structured log line and
 * a dedicated metric make the unsupported event visible to operations. The
 * payload is never read, logged, or exposed in any way.
 */
export class UnsupportedOutboxDispatcher implements OutboxDispatcher {
  constructor(private readonly dependencies: UnsupportedOutboxDispatcherDependencies) {}

  dispatch(message: OutboxMessage): Promise<DispatchResult> {
    const now = this.dependencies.clock.now();
    this.dependencies.logger.info(
      {
        event: 'worker_message_unsupported',
        messageId: message.id,
        eventId: message.eventId,
        type: message.type,
        source: message.source,
        scope: message.scope,
        tenantId: message.tenantId,
        attempts: message.attempts + 1,
      },
      `Event type "${message.type}" has no delivery target; explicitly unsupported`,
    );
    this.dependencies.metrics.recordUnsupported();
    return Promise.resolve({
      messageId: message.id,
      status: 'failed',
      attempt: {
        attemptNumber: message.attempts + 1,
        attemptedAt: now,
        outcome: 'failed',
        failure: {
          code: OUTBOX_EVENT_TYPE_UNSUPPORTED_FAILURE_CODE,
          message: `Event type "${message.type}" has no delivery target; explicitly unsupported`,
          retryable: true,
          occurredAt: now,
        },
      },
    });
  }
}
