import type { DispatchResult, OutboxMessage } from '../domain/types.js';

/**
 * Transport-agnostic delivery contract for future worker execution.
 *
 * Dispatchers are invoked by workers outside the originating request
 * lifecycle (never by the enqueue path). They receive the message envelope and
 * report a result; the worker then marks success or failure through the
 * outbox service. No transport-specific details (channels, protocols,
 * providers) may leak into this contract or into message payloads.
 */
export interface OutboxDispatcher {
  dispatch(message: OutboxMessage): Promise<DispatchResult>;
}
