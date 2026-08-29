import type { SqlExecutor } from '@manara/database';
import type { AuthRateLimitPolicy, AuthRateLimiterPort, RateLimitDecision } from './rate-limit.types.js';

interface RateLimitRow {
  window_start: Date | string;
  count: number;
}

/**
 * Cluster-wide fixed-window limiter backed by PostgreSQL.
 * The consume operation is a single atomic UPSERT, so concurrent API
 * instances share the same counter for a key.
 */
export class PostgresAuthRateLimiter implements AuthRateLimiterPort {
  constructor(
    private readonly database: SqlExecutor,
    private readonly policy: AuthRateLimitPolicy,
  ) {}

  async check(key: string): Promise<RateLimitDecision> {
    const result = await this.database.query<RateLimitRow>(
      `SELECT window_start, count
       FROM auth_rate_limit_buckets
       WHERE key = $1`,
      [key],
    );
    const bucket = result.rows[0];
    if (bucket === undefined) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const windowStart = new Date(bucket.window_start).getTime();
    const now = Date.now();
    if (windowStart + this.policy.windowMs <= now || bucket.count < this.policy.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: this.retryAfterSeconds(windowStart, now) };
  }

  async consume(key: string): Promise<RateLimitDecision> {
    const result = await this.database.query<RateLimitRow>(
      `INSERT INTO auth_rate_limit_buckets (key, window_start, count, updated_at)
       VALUES ($1, NOW(), 1, NOW())
       ON CONFLICT (key) DO UPDATE
       SET window_start = CASE
             WHEN NOW() >= auth_rate_limit_buckets.window_start
               + ($2::bigint * INTERVAL '1 millisecond')
             THEN NOW()
             ELSE auth_rate_limit_buckets.window_start
           END,
           count = CASE
             WHEN NOW() >= auth_rate_limit_buckets.window_start
               + ($2::bigint * INTERVAL '1 millisecond')
             THEN 1
             ELSE auth_rate_limit_buckets.count + 1
           END,
           updated_at = NOW()
       RETURNING window_start, count`,
      [key, this.policy.windowMs],
    );

    const bucket = result.rows[0];
    if (bucket === undefined) {
      throw new Error('Rate-limit bucket upsert returned no row');
    }
    const windowStart = new Date(bucket.window_start).getTime();
    if (bucket.count <= this.policy.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: this.retryAfterSeconds(windowStart, Date.now()),
    };
  }

  async reset(key: string): Promise<void> {
    await this.database.query('DELETE FROM auth_rate_limit_buckets WHERE key = $1', [key]);
  }

  private retryAfterSeconds(windowStart: number, now: number): number {
    return Math.max(1, Math.ceil((windowStart + this.policy.windowMs - now) / 1000));
  }
}
