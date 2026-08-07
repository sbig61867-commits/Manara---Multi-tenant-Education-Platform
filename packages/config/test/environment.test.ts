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
  'WORKER_POLL_INTERVAL_MS',
  'WORKER_BATCH_SIZE',
  'WORKER_CLAIM_LEASE_MS',
  'WORKER_STALE_CLAIM_RELEASE_INTERVAL_MS',
  'WORKER_SHUTDOWN_TIMEOUT_MS',
  'WORKER_CLAIM_SCOPE',
  'WORKER_CLAIM_TENANT_ID',
  'DATABASE_URL',
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
    if (result.success) assert.equal(result.data.API_COOKIE_SECURE, 'auto');
  }
});

test('worker numeric ranges and tenant scope remain validated', () => {
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
