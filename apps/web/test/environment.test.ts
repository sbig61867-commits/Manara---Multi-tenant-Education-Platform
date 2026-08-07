import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWebEnvironment, WEB_PUBLIC_ENV_KEYS } from '../src/env.js';

test('development and test may omit the public API origin', () => {
  assert.deepEqual(resolveWebEnvironment({}, 'development'), { apiBaseUrl: null });
  assert.deepEqual(resolveWebEnvironment({}, 'test'), { apiBaseUrl: null });
});

test('staging and production require the public API origin', () => {
  assert.throws(() => resolveWebEnvironment({}, 'staging'), /required/);
  assert.throws(() => resolveWebEnvironment({}, 'production'), /required/);
});

test('protected environments require an exact HTTPS origin and normalize trailing slash', () => {
  assert.deepEqual(resolveWebEnvironment({ VITE_API_BASE_URL: 'https://api.example.com/' }, 'production'), {
    apiBaseUrl: 'https://api.example.com',
  });
  for (const value of [
    'http://api.example.com',
    'https://user:pass@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com?region=one',
    'https://api.example.com#fragment',
    'https://*.example.com',
    '*',
    'not-a-url',
  ]) {
    assert.throws(() => resolveWebEnvironment({ VITE_API_BASE_URL: value }, 'production'));
  }
});

test('the browser public contract contains no server-only keys', () => {
  assert.deepEqual(WEB_PUBLIC_ENV_KEYS, ['VITE_API_BASE_URL']);
  for (const key of ['DATABASE_URL', 'API_COOKIE_NAME', 'API_TRUST_PROXY', 'WORKER_CLAIM_SCOPE']) {
    assert.equal(WEB_PUBLIC_ENV_KEYS.includes(key as never), false);
  }
});
