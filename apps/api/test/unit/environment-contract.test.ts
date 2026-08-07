import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEnvSchema } from '@manara/config';
import { buildSessionCookieOptions, resolveCookieSecure } from '../../src/http/cookie-options.js';
import { buildCorsConfig } from '../../src/http/cors.js';

test('CORS normalizes exact duplicate origins and preserves credentials', () => {
  const config = buildCorsConfig({
    nodeEnv: 'production',
    corsOrigins: 'https://app.example.com/, https://admin.example.com, https://app.example.com',
  });
  assert.deepEqual(config?.origin, ['https://app.example.com', 'https://admin.example.com']);
  assert.equal(config?.credentials, true);
});

test('staging and production require a nonempty CORS allowlist', () => {
  for (const nodeEnv of ['staging', 'production']) {
    assert.throws(() => buildCorsConfig({ nodeEnv, corsOrigins: '' }), /must be configured/);
  }
  assert.equal(buildCorsConfig({ nodeEnv: 'development', corsOrigins: '' }), null);
  assert.equal(buildCorsConfig({ nodeEnv: 'test', corsOrigins: '' }), null);
});

test('protected CORS origins require HTTPS', () => {
  for (const nodeEnv of ['staging', 'production']) {
    assert.throws(
      () => buildCorsConfig({ nodeEnv, corsOrigins: 'http://app.example.com' }),
      /must use HTTPS/,
    );
  }
});

test('CORS rejects wildcard, credentials, paths, queries, fragments, and malformed origins', () => {
  for (const corsOrigins of [
    '*',
    'https://*.example.com',
    'https://user:pass@app.example.com',
    'https://app.example.com/v1',
    'https://app.example.com?mode=one',
    'https://app.example.com#fragment',
    'not-an-origin',
  ]) {
    assert.throws(() => buildCorsConfig({ nodeEnv: 'production', corsOrigins }));
  }
});

test('auto cookies are secure in staging and production', () => {
  assert.equal(resolveCookieSecure('auto', 'staging'), true);
  assert.equal(resolveCookieSecure('auto', 'production'), true);
  assert.equal(resolveCookieSecure('auto', 'development'), false);
  assert.equal(resolveCookieSecure('auto', 'test'), false);
});

test('protected API configuration rejects explicit insecure cookies', () => {
  for (const NODE_ENV of ['staging', 'production']) {
    assert.equal(apiEnvSchema.safeParse({ NODE_ENV, API_COOKIE_SECURE: 'false' }).success, false);
  }
});

test('secure session cookie retains host-only security attributes', () => {
  const cookie = buildSessionCookieOptions({ name: 'manara_session', secure: true, maxAgeSeconds: 60 });
  assert.equal(cookie.name, '__Host-manara_session');
  assert.deepEqual(cookie.options, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60,
  });
  assert.equal('domain' in cookie.options, false);
});
