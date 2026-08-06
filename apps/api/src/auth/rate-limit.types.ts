/**
 * Replaceable authentication rate-limiting port. The current deployment uses
 * the in-memory adapter; a shared-store adapter (e.g. Redis) can implement
 * this interface to provide cluster-wide counters without touching callers.
 *
 * All methods are synchronous so that counter updates are atomic within one
 * process: no await point exists between a check and the corresponding
 * consume, making behavior deterministic under concurrent requests.
 */
export interface AuthRateLimiterPort {
  /** Non-consuming read: would a request for `key` be allowed right now? */
  check(key: string): RateLimitDecision;
  /** Consumes one slot for `key` and reports whether the request is allowed. */
  consume(key: string): RateLimitDecision;
  /** Clears the counter for `key` (used to reset failure buckets on success). */
  reset(key: string): void;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the blocking window expires; 0 when allowed. Always a valid integer. */
  readonly retryAfterSeconds: number;
}

export interface AuthRateLimitPolicy {
  /** Maximum events allowed within one fixed window. */
  readonly limit: number;
  /** Fixed window duration in milliseconds. */
  readonly windowMs: number;
  /** Storage bound: maximum number of distinct keys tracked simultaneously. */
  readonly maxEntries?: number;
  /** How often expired buckets are swept from storage. */
  readonly sweepIntervalMs?: number;
}
