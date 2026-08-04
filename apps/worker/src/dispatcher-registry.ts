import type { OutboxDispatcher } from '@manara/outbox';

/**
 * Routes outbox messages to transport-agnostic dispatchers by event type.
 * The runtime resolves each claimed message through this registry; a message
 * with no registered dispatcher fails safely into the retry/dead-letter path.
 */
export class OutboxDispatcherRegistry {
  private readonly dispatchers = new Map<string, OutboxDispatcher>();

  register(eventType: string, dispatcher: OutboxDispatcher): this {
    if (eventType.trim() === '') {
      throw new Error('dispatcher event type must be a non-empty string');
    }
    this.dispatchers.set(eventType, dispatcher);
    return this;
  }

  get(eventType: string): OutboxDispatcher | null {
    return this.dispatchers.get(eventType) ?? null;
  }

  get size(): number {
    return this.dispatchers.size;
  }
}
