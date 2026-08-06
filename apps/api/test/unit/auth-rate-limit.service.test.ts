import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthRateLimitService } from '../../src/auth/auth-rate-limit.service.js';
import { InMemoryAuthRateLimiter } from '../../src/auth/in-memory-auth-rate-limiter.js';
import { HttpRateLimitedError } from '../../src/http/errors.js';

function createService(): {
  service: AuthRateLimitService;
  loginIp: InMemoryAuthRateLimiter;
  loginEmailIp: InMemoryAuthRateLimiter;
  refreshIp: InMemoryAuthRateLimiter;
  endpointIp: InMemoryAuthRateLimiter;
} {
  const loginIp = new InMemoryAuthRateLimiter({ limit: 3, windowMs: 60_000 });
  const loginEmailIp = new InMemoryAuthRateLimiter({ limit: 2, windowMs: 60_000 });
  const refreshIp = new InMemoryAuthRateLimiter({ limit: 2, windowMs: 60_000 });
  const endpointIp = new InMemoryAuthRateLimiter({ limit: 3, windowMs: 60_000 });
  const service = new AuthRateLimitService(loginIp, loginEmailIp, refreshIp, endpointIp);
  return { service, loginIp, loginEmailIp, refreshIp, endpointIp };
}

const IP_A = '127.0.0.1';
const IP_B = '127.0.0.2';

test('login below the limits is allowed and checks are non-consuming', () => {
  const { service } = createService();
  for (let index = 0; index < 5; index += 1) {
    service.guardLogin(IP_A, 'student@example.com');
    assert.doesNotThrow(() => service.guardLogin(IP_A, 'other@example.com'));
  }
  assert.equal(service.loginIp.counters.allowed, 0, 'checks must not consume');
  assert.equal(service.loginEmailIp.counters.allowed, 0);
});

test('failed credentials consume both applicable limits and the next attempt is blocked', () => {
  const { service } = createService();
  service.guardLogin(IP_A, 'student@example.com');
  service.recordLoginFailure(IP_A, 'student@example.com');
  service.recordLoginFailure(IP_A, 'student@example.com');
  assert.equal(service.loginIp.counters.allowed, 2);
  assert.equal(service.loginEmailIp.counters.allowed, 2);
  assert.throws(() => service.guardLogin(IP_A, 'student@example.com'), (error: unknown) => {
    assert.ok(error instanceof HttpRateLimitedError);
    assert.equal(error.policy, 'login_email_ip');
    assert.equal(error.statusCode, 429);
    assert.ok(error.retryAfterSeconds >= 1);
    assert.equal(Number.isInteger(error.retryAfterSeconds), true);
    assert.match(error.identifierHash ?? '', /^[0-9a-f]{16}$/);
    assert.ok(!error.message.includes('student'));
    return true;
  });
});

test('email normalization is case-insensitive for the email+IP bucket', () => {
  const { service } = createService();
  service.recordLoginFailure(IP_A, 'Student@Example.COM');
  service.recordLoginFailure(IP_A, ' student@example.com ');
  assert.throws(() => service.guardLogin(IP_A, 'STUDENT@EXAMPLE.COM'), HttpRateLimitedError);
});

test('different emails from the same IP share the broader IP limit', () => {
  const { service } = createService();
  service.recordLoginFailure(IP_A, 'one@example.com');
  service.recordLoginFailure(IP_A, 'two@example.com');
  service.recordLoginFailure(IP_A, 'three@example.com');
  assert.throws(
    () => service.guardLogin(IP_A, 'four@example.com'),
    (error: unknown) => error instanceof HttpRateLimitedError && error.policy === 'login_ip',
  );
});

test('the same email from different IPs uses separate email+IP buckets', () => {
  const { service } = createService();
  service.recordLoginFailure(IP_A, 'student@example.com');
  service.recordLoginFailure(IP_A, 'student@example.com');
  assert.doesNotThrow(() => service.guardLogin(IP_B, 'student@example.com'));
  service.recordLoginFailure(IP_B, 'student@example.com');
  service.recordLoginFailure(IP_B, 'student@example.com');
  assert.throws(() => service.guardLogin(IP_B, 'student@example.com'), HttpRateLimitedError);
  assert.doesNotThrow(() => service.guardLogin(IP_A, 'other@example.com'), 'IP bucket still below its limit');
});

test('a successful login resets only the email+IP counter', () => {
  const { service } = createService();
  service.recordLoginFailure(IP_A, 'student@example.com');
  service.recordLoginFailure(IP_A, 'student@example.com');
  service.resetLoginFailures(IP_A, 'student@example.com');
  assert.doesNotThrow(() => service.guardLogin(IP_A, 'student@example.com'), 'email+IP bucket must be reset');
});

test('a successful login never resets the broad IP limiter', () => {
  const { service } = createService();
  service.recordLoginFailure(IP_A, 'one@example.com');
  service.recordLoginFailure(IP_A, 'two@example.com');
  service.recordLoginFailure(IP_A, 'three@example.com');
  service.resetLoginFailures(IP_A, 'one@example.com');
  assert.throws(
    () => service.guardLogin(IP_A, 'four@example.com'),
    (error: unknown) => error instanceof HttpRateLimitedError && error.policy === 'login_ip',
  );
});

test('unknown IPs fall back to a stable bucket', () => {
  const { service } = createService();
  service.recordLoginFailure(null, 'student@example.com');
  service.recordLoginFailure(undefined, 'student@example.com');
  service.recordLoginFailure('   ', 'student@example.com');
  assert.throws(() => service.guardLogin(null, 'student@example.com'), HttpRateLimitedError);
});

test('invalid refresh attempts are limited by IP', () => {
  const { service } = createService();
  service.guardRefresh(IP_A);
  service.recordRefreshFailure(IP_A);
  service.recordRefreshFailure(IP_A);
  assert.throws(
    () => service.guardRefresh(IP_A),
    (error: unknown) => error instanceof HttpRateLimitedError && error.policy === 'refresh_ip',
  );
  assert.doesNotThrow(() => service.guardRefresh(IP_B), 'other IP is not affected');
});

test('session and logout share the lighter endpoint policy and consume per request', () => {
  const { service } = createService();
  service.guardEndpoint(IP_A);
  service.guardEndpoint(IP_A);
  service.guardEndpoint(IP_A);
  assert.throws(
    () => service.guardEndpoint(IP_A),
    (error: unknown) => error instanceof HttpRateLimitedError && error.policy === 'endpoint_ip',
  );
  assert.doesNotThrow(() => service.guardEndpoint(IP_B));
});
