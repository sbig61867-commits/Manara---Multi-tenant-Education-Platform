import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { apiEnvSchema, workerEnvSchema } from '../src/index.js';

const CONSUMED_KEYS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'LOG_PRETTY',
  'VITE_API_BASE_URL',
  'WEB_PORT',
  'API_HOST',
  'API_PORT',
  'API_DATABASE_POOL_MAX',
  'API_CORS_ORIGINS',
  'API_BODY_LIMIT_BYTES',
  'API_ENABLE_DOCS',
  'API_COOKIE_SECURE',
  'API_COOKIE_NAME',
  'API_TRUST_PROXY',
  'AUTH_LOGIN_IP_MAX_FAILURES',
  'AUTH_LOGIN_IP_WINDOW_MS',
  'AUTH_LOGIN_EMAIL_IP_MAX_FAILURES',
  'AUTH_LOGIN_EMAIL_IP_WINDOW_MS',
  'AUTH_REFRESH_IP_MAX_REQUESTS',
  'AUTH_REFRESH_IP_WINDOW_MS',
  'AUTH_ENDPOINT_IP_MAX_REQUESTS',
  'AUTH_ENDPOINT_IP_WINDOW_MS',
  'WORKER_HOST',
  'WORKER_HEALTH_PORT',
  'WORKER_DATABASE_POOL_MAX',
  'WORKER_POLL_INTERVAL_MS',
  'WORKER_BATCH_SIZE',
  'WORKER_CLAIM_LEASE_MS',
  'WORKER_STALE_CLAIM_RELEASE_INTERVAL_MS',
  'WORKER_SHUTDOWN_TIMEOUT_MS',
  'WORKER_CLAIM_SCOPE',
  'WORKER_CLAIM_TENANT_ID',
  'DATABASE_URL',
  'DATABASE_CONNECTION_TIMEOUT_MS',
  'DATABASE_IDLE_TIMEOUT_MS',
] as const;

test('protected API environments reject explicitly insecure cookies', () => {
  for (const NODE_ENV of ['staging', 'production']) {
    const result = apiEnvSchema.safeParse({ NODE_ENV, API_COOKIE_SECURE: 'false' });
    assert.equal(result.success, false);
  }
});

test('development and test retain local defaults', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const result = apiEnvSchema.safeParse({ NODE_ENV });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.API_COOKIE_SECURE, 'auto');
      assert.equal(result.data.API_TRUST_PROXY, false);
      assert.equal(result.data.API_DATABASE_POOL_MAX, 5);
    }
  }
});

test('API and worker database pool budgets accept bounded overrides', () => {
  const api = apiEnvSchema.safeParse({ API_DATABASE_POOL_MAX: '12' });
  assert.equal(api.success, true);
  if (api.success) assert.equal(api.data.API_DATABASE_POOL_MAX, 12);

  const worker = workerEnvSchema.safeParse({ WORKER_DATABASE_POOL_MAX: '7' });
  assert.equal(worker.success, true);
  if (worker.success) assert.equal(worker.data.WORKER_DATABASE_POOL_MAX, 7);
});

test('API and worker database pool budgets reject invalid values', () => {
  for (const API_DATABASE_POOL_MAX of ['0', '-1', '1.5', '51', 'invalid']) {
    assert.equal(apiEnvSchema.safeParse({ API_DATABASE_POOL_MAX }).success, false);
  }
  for (const WORKER_DATABASE_POOL_MAX of ['0', '-1', '1.5', '21', 'invalid']) {
    assert.equal(workerEnvSchema.safeParse({ WORKER_DATABASE_POOL_MAX }).success, false);
  }
});

test('API_TRUST_PROXY accepts disabled aliases and bounded Fastify forms', () => {
  for (const value of ['off', 'false']) {
    const result = apiEnvSchema.safeParse({ API_TRUST_PROXY: value });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.API_TRUST_PROXY, false);
  }

  for (const value of ['1', '16']) {
    const result = apiEnvSchema.safeParse({ API_TRUST_PROXY: value });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.API_TRUST_PROXY, Number(value));
  }

  const allowlist = apiEnvSchema.safeParse({
    API_TRUST_PROXY: '127.0.0.1, 10.0.0.0/8, ::1, 2001:db8::/32',
  });
  assert.equal(allowlist.success, true);
  if (allowlist.success) {
    assert.deepEqual(allowlist.data.API_TRUST_PROXY, [
      '127.0.0.1', '10.0.0.0/8', '::1', '2001:db8::/32',
    ]);
  }
});

test('API_TRUST_PROXY rejects malformed or unbounded values', () => {
  for (const API_TRUST_PROXY of [
    '', '0', '-1', '1.5', '17', '*', 'loopback', 'proxy.example.com',
    '10.0.0.999', '2001:db8:::1', '10.0.0.0/33', '2001:db8::/129',
    '10.0.0.0/not-a-prefix', '10.0.0.0/8,', '10.0.0.0/8,,192.168.0.0/16',
  ]) {
    assert.equal(apiEnvSchema.safeParse({ API_TRUST_PROXY }).success, false, API_TRUST_PROXY);
  }
});

test('unrestricted proxy trust is development/test-only', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const result = apiEnvSchema.safeParse({ NODE_ENV, API_TRUST_PROXY: 'true' });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.API_TRUST_PROXY, true);
  }
  for (const NODE_ENV of ['staging', 'production']) {
    assert.equal(apiEnvSchema.safeParse({ NODE_ENV, API_TRUST_PROXY: 'true' }).success, false);
  }
});

test('worker numeric ranges and tenant scope remain validated', () => {
  const defaults = workerEnvSchema.safeParse({});
  assert.equal(defaults.success, true);
  if (defaults.success) assert.equal(defaults.data.WORKER_DATABASE_POOL_MAX, 2);
  assert.equal(workerEnvSchema.safeParse({ WORKER_BATCH_SIZE: '0' }).success, false);
  assert.equal(workerEnvSchema.safeParse({ WORKER_CLAIM_SCOPE: 'tenant' }).success, false);
  assert.equal(
    workerEnvSchema.safeParse({ WORKER_CLAIM_SCOPE: 'tenant', WORKER_CLAIM_TENANT_ID: 'tenant-1' }).success,
    true,
  );
});

test('.env.example contains every consumed key exactly once', async () => {
  const contents = await readFile(resolve(process.cwd(), '..', '..', '.env.example'), 'utf8');
  for (const key of CONSUMED_KEYS) {
    const matches = contents.match(new RegExp(`^#?\\s*${key}=`, 'gm')) ?? [];
    assert.equal(matches.length, 1, `${key} should appear exactly once`);
  }
});
