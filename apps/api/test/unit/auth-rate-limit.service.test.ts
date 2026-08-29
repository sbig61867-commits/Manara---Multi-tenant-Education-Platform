import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthRateLimitService } from '../../src/auth/auth-rate-limit.service.js';
import { InMemoryAuthRateLimiter } from '../../src/auth/in-memory-auth-rate-limiter.js';
import { HttpRateLimitedError } from '../../src/http/errors.js';

function createService(): { service: AuthRateLimitService; loginIp: InMemoryAuthRateLimiter; loginEmailIp: InMemoryAuthRateLimiter } {
  const loginIp = new InMemoryAuthRateLimiter({ limit: 3, windowMs: 60_000 });
  const loginEmailIp = new InMemoryAuthRateLimiter({ limit: 2, windowMs: 60_000 });
  const refreshIp = new InMemoryAuthRateLimiter({ limit: 2, windowMs: 60_000 });
  const endpointIp = new InMemoryAuthRateLimiter({ limit: 3, windowMs: 60_000 });
  return { service: new AuthRateLimitService(loginIp, loginEmailIp, refreshIp, endpointIp), loginIp, loginEmailIp };
}
const IP_A = '127.0.0.1';
const IP_B = '127.0.0.2';

test('login checks are non-consuming', async () => {
  const { service, loginIp, loginEmailIp } = createService();
  for (let i = 0; i < 5; i += 1) {
    await service.guardLogin(IP_A, 'student@example.com');
    await service.guardLogin(IP_A, 'other@example.com');
  }
  assert.equal(loginIp.counters.allowed, 0);
  assert.equal(loginEmailIp.counters.allowed, 0);
});

test('failed credentials consume both applicable limits', async () => {
  const { service, loginIp, loginEmailIp } = createService();
  await service.guardLogin(IP_A, 'student@example.com');
  await service.recordLoginFailure(IP_A, 'student@example.com');
  await service.recordLoginFailure(IP_A, 'student@example.com');
  assert.equal(loginIp.counters.allowed, 2);
  assert.equal(loginEmailIp.counters.allowed, 2);
  await assert.rejects(() => service.guardLogin(IP_A, 'student@example.com'), (e: unknown) => e instanceof HttpRateLimitedError && e.policy === 'login_email_ip');
});

test('email normalization is case-insensitive', async () => {
  const { service } = createService();
  await service.recordLoginFailure(IP_A, 'Student@Example.COM');
  await service.recordLoginFailure(IP_A, ' student@example.com ');
  await assert.rejects(() => service.guardLogin(IP_A, 'STUDENT@EXAMPLE.COM'), HttpRateLimitedError);
});

test('different emails from the same IP share the IP limit', async () => {
  const { service } = createService();
  await service.recordLoginFailure(IP_A, 'one@example.com');
  await service.recordLoginFailure(IP_A, 'two@example.com');
  await service.recordLoginFailure(IP_A, 'three@example.com');
  await assert.rejects(() => service.guardLogin(IP_A, 'four@example.com'), (e: unknown) => e instanceof HttpRateLimitedError && e.policy === 'login_ip');
});

test('email+IP buckets are isolated by IP', async () => {
  const { service } = createService();
  await service.recordLoginFailure(IP_A, 'student@example.com');
  await service.recordLoginFailure(IP_A, 'student@example.com');
  await service.guardLogin(IP_B, 'student@example.com');
  await service.recordLoginFailure(IP_B, 'student@example.com');
  await service.recordLoginFailure(IP_B, 'student@example.com');
  await assert.rejects(() => service.guardLogin(IP_B, 'student@example.com'), HttpRateLimitedError);
  await service.guardLogin(IP_A, 'other@example.com');
});

test('successful login resets only email+IP failures', async () => {
  const { service } = createService();
  await service.recordLoginFailure(IP_A, 'student@example.com');
  await service.recordLoginFailure(IP_A, 'student@example.com');
  await service.resetLoginFailures(IP_A, 'student@example.com');
  await service.guardLogin(IP_A, 'student@example.com');
});

test('successful login never resets broad IP limiter', async () => {
  const { service } = createService();
  await service.recordLoginFailure(IP_A, 'one@example.com');
  await service.recordLoginFailure(IP_A, 'two@example.com');
  await service.recordLoginFailure(IP_A, 'three@example.com');
  await service.resetLoginFailures(IP_A, 'one@example.com');
  await assert.rejects(() => service.guardLogin(IP_A, 'four@example.com'), (e: unknown) => e instanceof HttpRateLimitedError && e.policy === 'login_ip');
});

test('unknown IPs use a stable bucket', async () => {
  const { service } = createService();
  await service.recordLoginFailure(null, 'student@example.com');
  await service.recordLoginFailure(undefined, 'student@example.com');
  await service.recordLoginFailure('   ', 'student@example.com');
  await assert.rejects(() => service.guardLogin(null, 'student@example.com'), HttpRateLimitedError);
});

test('invalid refresh attempts are limited by IP', async () => {
  const { service } = createService();
  await service.guardRefresh(IP_A);
  await service.recordRefreshFailure(IP_A);
  await service.recordRefreshFailure(IP_A);
  await assert.rejects(() => service.guardRefresh(IP_A), (e: unknown) => e instanceof HttpRateLimitedError && e.policy === 'refresh_ip');
  await service.guardRefresh(IP_B);
});

test('endpoint requests consume the endpoint policy', async () => {
  const { service } = createService();
  await service.guardEndpoint(IP_A);
  await service.guardEndpoint(IP_A);
  await service.guardEndpoint(IP_A);
  await assert.rejects(() => service.guardEndpoint(IP_A), (e: unknown) => e instanceof HttpRateLimitedError && e.policy === 'endpoint_ip');
  await service.guardEndpoint(IP_B);
});
