import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAuthRateLimiter, boundedIdentifierHash, normalizeClientIp } from '../../src/auth/in-memory-auth-rate-limiter.js';

function createLimiter(overrides?: Partial<{ limit: number; windowMs: number; maxEntries: number; sweepIntervalMs: number }>): {
  limiter: InMemoryAuthRateLimiter;
  advance: (ms: number) => void;
} {
  let now = 1_000_000;
  const policy = {
    limit: overrides?.limit ?? 5,
    windowMs: overrides?.windowMs ?? 60_000,
    maxEntries: overrides?.maxEntries ?? 10_000,
    sweepIntervalMs: overrides?.sweepIntervalMs ?? 60_000,
  };
  const limiter = new InMemoryAuthRateLimiter(policy, () => now);
  return { limiter, advance: (ms) => { now += ms; } };
}

test('requests below the limit are allowed', () => {
  const { limiter } = createLimiter({ limit: 5 });
  for (let index = 0; index < 5; index += 1) {
    const decision = limiter.consume('key');
    assert.equal(decision.allowed, true);
    assert.equal(decision.retryAfterSeconds, 0);
  }
  assert.equal(limiter.counters.allowed, 5);
  assert.equal(limiter.counters.blocked, 0);
});

test('threshold behavior is exact: the limit itself is allowed, the next is blocked', () => {
  const { limiter } = createLimiter({ limit: 3 });
  limiter.consume('key');
  limiter.consume('key');
  assert.equal(limiter.consume('key').allowed, true);
  const blocked = limiter.consume('key');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds >= 1, true);
  assert.equal(Number.isInteger(blocked.retryAfterSeconds), true);
  assert.equal(limiter.counters.blocked, 1);
});

test('retry-after is seconds until the blocking window expires', () => {
  const { limiter, advance } = createLimiter({ limit: 1, windowMs: 10_000 });
  limiter.consume('key');
  const blocked = limiter.consume('key');
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 10);
  advance(9_500);
  const nearExpiry = limiter.consume('key');
  assert.equal(nearExpiry.allowed, false);
  assert.ok(nearExpiry.retryAfterSeconds >= 1);
  advance(600);
  const afterExpiry = limiter.consume('key');
  assert.equal(afterExpiry.allowed, true);
});

test('check is non-consuming', () => {
  const { limiter } = createLimiter({ limit: 5 });
  for (let index = 0; index < 10; index += 1) {
    assert.equal(limiter.check('key').allowed, true);
  }
  assert.equal(limiter.consume('key').allowed, true);
  assert.equal(limiter.counters.allowed, 1);
});

test('window expiry allows requests again', () => {
  const { limiter, advance } = createLimiter({ limit: 2, windowMs: 1_000 });
  limiter.consume('key');
  limiter.consume('key');
  assert.equal(limiter.consume('key').allowed, false);
  advance(1_000);
  assert.equal(limiter.consume('key').allowed, true);
  assert.equal(limiter.consume('key').allowed, true);
  assert.equal(limiter.consume('key').allowed, false);
});

test('reset clears a bucket', () => {
  const { limiter } = createLimiter({ limit: 2 });
  limiter.consume('key');
  limiter.consume('key');
  limiter.reset('key');
  assert.equal(limiter.consume('key').allowed, true);
  assert.equal(limiter.consume('key').allowed, true);
  assert.equal(limiter.consume('key').allowed, false);
});

test('stale entries are swept lazily after the sweep interval', () => {
  const { limiter, advance } = createLimiter({ limit: 5, windowMs: 1_000, sweepIntervalMs: 1_000 });
  limiter.consume('a');
  limiter.consume('b');
  assert.equal(limiter.size, 2);
  advance(999);
  limiter.consume('c');
  assert.equal(limiter.size, 3, 'sweep must not run before the interval');
  advance(2);
  limiter.consume('d');
  assert.equal(limiter.size, 1, 'expired buckets must be removed');
  assert.equal(limiter.counters.expired, 3, 'a, b, and c all belong to the ended window');
  assert.equal(limiter.check('a').allowed, true);
});

test('storage is bounded and evicts least-recently-used entries', () => {
  const { limiter, advance } = createLimiter({ limit: 100, windowMs: 60_000, maxEntries: 3, sweepIntervalMs: 60_000 });
  limiter.consume('a');
  advance(1);
  limiter.consume('b');
  advance(1);
  limiter.consume('c');
  assert.equal(limiter.size, 3);
  limiter.consume('d');
  assert.equal(limiter.size, 3, 'size must never exceed maxEntries');
  assert.equal(limiter.counters.evicted, 1);
  assert.equal(limiter.consume('a').allowed, true, 'evicted entry starts a fresh window');
  assert.equal(limiter.size, 3);
});

test('concurrent async bursts keep counts exact within one process', async () => {
  const { limiter } = createLimiter({ limit: 5 });
  const results = await Promise.all(
    Array.from({ length: 10 }, async () => limiter.consume('key').allowed),
  );
  assert.equal(results.filter(Boolean).length, 5);
});

test('ip normalization is stable', () => {
  assert.equal(normalizeClientIp(' 127.0.0.1 '), '127.0.0.1');
  assert.equal(normalizeClientIp('2001:DB8::1'), '2001:db8::1');
  assert.equal(normalizeClientIp('::ffff:192.168.0.1'), '192.168.0.1');
  assert.equal(normalizeClientIp(null), 'unknown');
  assert.equal(normalizeClientIp(undefined), 'unknown');
  assert.equal(normalizeClientIp('   '), 'unknown');
  assert.equal(normalizeClientIp('10.0.0.1'), '10.0.0.1');
});

test('bounded identifier hash is deterministic and bounded', () => {
  const first = boundedIdentifierHash('student@example.com\u0000127.0.0.1');
  const second = boundedIdentifierHash('student@example.com\u0000127.0.0.1');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.ok(!first.includes('student'));
  assert.ok(!first.includes('example.com'));
  assert.notEqual(boundedIdentifierHash('a\u0000b'), boundedIdentifierHash('a\u0000c'));
});
