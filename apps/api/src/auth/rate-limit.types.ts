/**
 * Replaceable authentication rate-limiting port.
 * Implementations may be local (in-memory) or shared (PostgreSQL/Redis).
 */
export interface AuthRateLimiterPort {
  check(key: string): RateLimitDecision | Promise<RateLimitDecision>;
  consume(key: string): RateLimitDecision | Promise<RateLimitDecision>;
  reset(key: string): void | Promise<void>;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface AuthRateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxEntries?: number;
  readonly sweepIntervalMs?: number;
}
