import { OUTBOX_EVENT_TYPES, OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION } from '@manara/outbox';
import type { OutboxClock, OutboxDispatcher } from '@manara/outbox';
import { OutboxDispatcherRegistry } from './dispatcher-registry.js';
import type { WorkerMetrics } from './metrics.js';
import type { RuntimeLogger } from './outbox-dispatcher-runtime.js';
import { UnsupportedOutboxDispatcher } from './unsupported-event-dispatcher.js';

/**
 * The worker's dispatch-side view of the outbox event catalog.
 *
 * The catalog itself lives in `@manara/outbox` so the enqueue side (API) and
 * the dispatch side (worker) share one source of truth. Each emitted event
 * type must be classified exactly once: either it has a real delivery target
 * (a dispatcher is registered for it) or it is explicitly declared as having
 * no delivery target yet. The worker refuses to start when the classification
 * is incomplete, so a newly emitted event type can never silently fall
 * through to an unregistered dispatcher.
 */
export { OUTBOX_EVENT_TYPES, OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION };

export interface DispatcherCoverageInput {
  readonly emitted: ReadonlySet<string>;
  readonly required: ReadonlySet<string>;
  readonly optional: ReadonlySet<string>;
}

/**
 * Fail-fast validation for the dispatcher coverage contract:
 * - required and optional must both be subsets of the emitted event types,
 * - a type cannot be both required and optional,
 * - every emitted event type must be classified as required or optional.
 */
export function assertDispatcherCoverage(input: DispatcherCoverageInput): void {
  const problems: string[] = [];
  for (const type of input.required) {
    if (!input.emitted.has(type)) {
      problems.push(`"${type}" is required but is not an emitted event type`);
    }
  }
  for (const type of input.optional) {
    if (!input.emitted.has(type)) {
      problems.push(`"${type}" is optional but is not an emitted event type`);
    }
  }
  for (const type of input.required) {
    if (input.optional.has(type)) {
      problems.push(`"${type}" is classified as both required and optional`);
    }
  }
  for (const type of input.emitted) {
    if (!input.required.has(type) && !input.optional.has(type)) {
      problems.push(`"${type}" has no dispatcher and is not explicitly optional`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`outbox dispatcher coverage is incomplete:\n- ${problems.join('\n- ')}`);
  }
}

export interface BuildOutboxDispatcherRegistryInput {
  readonly logger: RuntimeLogger;
  readonly metrics: WorkerMetrics;
  readonly clock: OutboxClock;
  /** Dispatchers for event types that have a real delivery target. */
  readonly requiredDispatchers?: ReadonlyMap<string, OutboxDispatcher>;
}

/**
 * Builds the worker's dispatcher registry from the event catalog.
 *
 * Event types with a real delivery target must be provided through
 * `requiredDispatchers`; every other emitted type must be explicitly declared
 * in `OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION`, and is routed to the explicit
 * unsupported policy (retry then dead-letter, never silently delivered).
 * Coverage is validated before anything is registered, so a missing or
 * misclassified dispatcher fails fast instead of dead-lettering in production.
 */
export function buildOutboxDispatcherRegistry(
  input: BuildOutboxDispatcherRegistryInput,
): OutboxDispatcherRegistry {
  const emitted = new Set(OUTBOX_EVENT_TYPES);
  const required = new Set(input.requiredDispatchers?.keys() ?? []);
  const optional = new Set(OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION);
  assertDispatcherCoverage({ emitted, required, optional });

  const registry = new OutboxDispatcherRegistry();
  if (input.requiredDispatchers !== undefined) {
    for (const [type, dispatcher] of input.requiredDispatchers) {
      registry.register(type, dispatcher);
    }
  }
  const unsupported = new UnsupportedOutboxDispatcher({
    logger: input.logger,
    metrics: input.metrics,
    clock: input.clock,
  });
  for (const type of optional) {
    registry.register(type, unsupported);
  }
  return registry;
}
