import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping auth rate limit smoke tests' : false;

/**
 * Boots the real API with small, deterministic limiter policies and verifies
 * the full rate-limit behavior over HTTP. All requests originate from the
 * same client IP (127.0.0.1), and the limiter state is isolated to this app
 * instance, so the sequence is deterministic:
 *   login IP limit = 6 failures, login email+IP limit = 2 failures,
 *   refresh IP limit = 2 invalid attempts, endpoint limit = 3 requests.
 */
test('auth rate limiting (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE users, password_identities, auth_sessions CASCADE');

    const previous = new Map<string, string | undefined>();
    const env = {
      LOG_LEVEL: 'error',
      LOG_PRETTY: 'false',
      NODE_ENV: 'test',
      AUTH_LOGIN_IP_MAX_FAILURES: '6',
      AUTH_LOGIN_IP_WINDOW_MS: '60000',
      AUTH_LOGIN_EMAIL_IP_MAX_FAILURES: '2',
      AUTH_LOGIN_EMAIL_IP_WINDOW_MS: '60000',
      AUTH_REFRESH_IP_MAX_REQUESTS: '2',
      AUTH_REFRESH_IP_WINDOW_MS: '60000',
      AUTH_ENDPOINT_IP_MAX_REQUESTS: '3',
      AUTH_ENDPOINT_IP_WINDOW_MS: '60000',
    };
    for (const [key, value] of Object.entries(env)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    const app = await createApiApplication(config);
    try {
      const userCreation = app.get(UserCreationService);
      const existingEmail = `ratelimit-smoke-${Date.now()}@example.com`;
      const unknownEmail = `ratelimit-unknown-${Date.now()}@example.com`;
      const password = 'smoke-password-123';
      await userCreation.registerUser({ email: existingEmail, password });

      const login = (email: string, attemptPassword: string) =>
        app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: attemptPassword } });

      // --- account existence is not revealed: identical 401 responses ---
      const existingFailure = await login(existingEmail, 'wrong-password-123');
      assert.equal(existingFailure.statusCode, 401);
      const unknownFailure = await login(unknownEmail, 'wrong-password-123');
      assert.equal(unknownFailure.statusCode, 401);
      const existingError = JSON.parse(existingFailure.body).error;
      const unknownError = JSON.parse(unknownFailure.body).error;
      assert.equal(existingError.code, 'http.unauthorized');
      assert.equal(unknownError.code, 'http.unauthorized');
      assert.equal(existingError.message, unknownError.message, 'both account classes produce the identical 401');

      // --- successful login works below the limit and resets the email+IP bucket ---
      const firstSuccess = await login(existingEmail, password);
      assert.equal(firstSuccess.statusCode, 200);
      const afterReset = await login(existingEmail, 'wrong-password-123');
      assert.equal(afterReset.statusCode, 401, 'email+IP bucket must have been reset by the success');

      // --- email+IP threshold is exact: 2 failures allowed, the 3rd is blocked ---
      const secondFailure = await login(existingEmail, 'wrong-password-123');
      assert.equal(secondFailure.statusCode, 401);
      const overLimit = await login(existingEmail, 'wrong-password-123');
      assert.equal(overLimit.statusCode, 429);
      const overLimitError = JSON.parse(overLimit.body).error;
      assert.equal(overLimitError.code, 'http.too_many_requests');
      assert.equal(typeof overLimitError.message, 'string');
      assert.equal(typeof overLimitError.requestId, 'string');
      assert.ok(!('details' in overLimitError), 'no internal details in the envelope');
      const retryAfter = overLimit.headers['retry-after'];
      assert.ok(retryAfter, 'Retry-After header must be present');
      assert.equal(Number.isInteger(Number(retryAfter)), true);
      assert.ok(Number(retryAfter) >= 1);

      // --- even correct credentials are rejected while blocked ---
      const correctWhileBlocked = await login(existingEmail, password);
      assert.equal(correctWhileBlocked.statusCode, 429);
      assert.equal(JSON.parse(correctWhileBlocked.body).error.code, 'http.too_many_requests');

      // --- different emails from the same IP share the broader IP limit ---
      assert.equal((await login(`ip-fill-1-${Date.now()}@example.com`, 'wrong-password-123')).statusCode, 401);
      assert.equal((await login(`ip-fill-2-${Date.now()}@example.com`, 'wrong-password-123')).statusCode, 401);
      const ipBlocked = await login(`ip-block-${Date.now()}@example.com`, 'wrong-password-123');
      assert.equal(ipBlocked.statusCode, 429, 'IP bucket (6 failures) must block a fresh email');
      assert.equal(JSON.parse(ipBlocked.body).error.code, 'http.too_many_requests');
      assert.equal(JSON.parse(ipBlocked.body).error.message, overLimitError.message, '429s are identical for existing and unknown accounts');

      // --- refresh: invalid attempts consume the IP limit ---
      const refresh = () => app.inject({ method: 'POST', url: '/v1/auth/refresh' });
      assert.equal((await refresh()).statusCode, 401);
      assert.equal((await refresh()).statusCode, 401);
      const refreshBlocked = await refresh();
      assert.equal(refreshBlocked.statusCode, 429);
      assert.ok(refreshBlocked.headers['retry-after']);

      // --- session/logout: lighter per-request endpoint limit ---
      const session = () => app.inject({ method: 'GET', url: '/v1/auth/session' });
      const logout = () => app.inject({ method: 'POST', url: '/v1/auth/logout' });
      assert.equal((await session()).statusCode, 401);
      assert.equal((await session()).statusCode, 401);
      assert.equal((await logout()).statusCode, 204);
      const endpointBlocked = await logout();
      assert.equal(endpointBlocked.statusCode, 429);
      assert.ok(endpointBlocked.headers['retry-after']);

      // --- health and readiness are unaffected by the limiters ---
      const health = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(health.statusCode, 200);
      const ready = await app.inject({ method: 'GET', url: '/v1/health/ready' });
      assert.equal(ready.statusCode, 200);
    } finally {
      await app.close();
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  } finally {
    try {
      await database.query('TRUNCATE TABLE users, password_identities, auth_sessions CASCADE');
    } finally {
      await database.close();
    }
  }
});
