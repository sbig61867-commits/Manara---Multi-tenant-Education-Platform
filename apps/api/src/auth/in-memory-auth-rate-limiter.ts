import { createHash } from 'node:crypto';
import type { AuthRateLimitPolicy, AuthRateLimiterPort, RateLimitDecision } from './rate-limit.types.js';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

const UNKNOWN_IP = 'unknown';

/**
 * Stable client IP normalization: trim, lowercase, collapse IPv4-mapped IPv6
 * (`::ffff:1.2.3.4` -> `1.2.3.4`), and fall back to a fixed sentinel when no
 * IP can be determined. Input comes from Fastify's `request.ip`, which already
 * honors the configured trust-proxy behavior.
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  if (ip === null || ip === undefined) {
    return UNKNOWN_IP;
  }
  const trimmed = ip.trim().toLowerCase();
  if (trimmed === '') {
    return UNKNOWN_IP;
  }
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

/** Bounded, non-reversible correlation identifier for logs (never the raw value). */
export function boundedIdentifierHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

interface Bucket {
  windowStart: number;
  count: number;
  lastAccessAt: number;
}

export interface RateLimiterCounters {
  allowed: number;
  blocked: number;
  evicted: number;
  expired: number;
}

/**
 * Fixed-window in-memory rate limiter.
 *
 * Memory is bounded: expired buckets are removed lazily (at most once per
 * `sweepIntervalMs`) and, when the bucket map exceeds `maxEntries`, the
 * least-recently-accessed entries are evicted. Counters are exposed for tests
 * and for a future metrics adapter.
 *
 * NOTE (single-instance limitation): counters are per process. Multiple API
 * instances have independent windows and provide no cluster-wide protection;
 * a shared-store adapter behind `AuthRateLimiterPort` is required for that.
 */
export class InMemoryAuthRateLimiter implements AuthRateLimiterPort {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;
  readonly counters: RateLimiterCounters = { allowed: 0, blocked: 0, evicted: 0, expired: 0 };
  private readonly maxEntries: number;
  private readonly sweepIntervalMs: number;

  constructor(
    private readonly policy: AuthRateLimitPolicy,
    private readonly clock: () => number = Date.now,
  ) {
    this.maxEntries = this.policy.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.sweepIntervalMs = this.policy.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  /** Current number of tracked keys (observability/tests). */
  get size(): number {
    return this.buckets.size;
  }

  check(key: string): RateLimitDecision {
    const now = this.clock();
    const windowStart = now - (now % this.policy.windowMs);
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.windowStart < windowStart || bucket.count < this.policy.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: this.retryAfterSeconds(bucket.windowStart, now) };
  }

  consume(key: string): RateLimitDecision {
    const now = this.clock();
    this.maybeSweep(now);
    const windowStart = now - (now % this.policy.windowMs);
    let bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.windowStart < windowStart) {
      bucket = { windowStart, count: 0, lastAccessAt: now };
      this.buckets.set(key, bucket);
    }
    bucket.lastAccessAt = now;
    bucket.count += 1;
    this.enforceBound(key);
    if (bucket.count <= this.policy.limit) {
      this.counters.allowed += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    this.counters.blocked += 1;
    return { allowed: false, retryAfterSeconds: this.retryAfterSeconds(bucket.windowStart, now) };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private retryAfterSeconds(windowStart: number, now: number): number {
    return Math.max(1, Math.ceil((windowStart + this.policy.windowMs - now) / 1000));
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweepAt < this.sweepIntervalMs) {
      return;
    }
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart + this.policy.windowMs <= now) {
        this.buckets.delete(key);
        this.counters.expired += 1;
      }
    }
  }

  private enforceBound(currentKey: string): void {
    while (this.buckets.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, bucket] of this.buckets) {
        if (key !== currentKey && bucket.lastAccessAt < oldestAccess) {
          oldestAccess = bucket.lastAccessAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) {
        return;
      }
      this.buckets.delete(oldestKey);
      this.counters.evicted += 1;
    }
  }
}
