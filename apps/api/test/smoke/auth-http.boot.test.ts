import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping auth smoke tests' : false;

interface ParsedCookie {
  name: string;
  value: string;
}

function cookieFromSetCookie(header: string | string[] | undefined): ParsedCookie | null {
  if (typeof header !== 'string') {
    return null;
  }
  const first = header.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

test('auth HTTP endpoints (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE users, password_identities, auth_sessions CASCADE');

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ LOG_LEVEL: 'error', LOG_PRETTY: 'false', NODE_ENV: 'test' })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    const app = await createApiApplication(config);
    try {
      const userCreation = app.get(UserCreationService);
      const email = `auth-smoke-${Date.now()}@example.com`;
      const password = 'smoke-password-123';
      await userCreation.registerUser({ email, password });

      const invalidLogin = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'wrong-password-123' },
      });
      assert.equal(invalidLogin.statusCode, 401);
      assert.equal(JSON.parse(invalidLogin.body).error.code, 'http.unauthorized');

      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password },
      });
      assert.equal(login.statusCode, 200);
      const loginBody = JSON.parse(login.body);
      assert.equal(loginBody.session.userId, loginBody.user.id);
      assert.equal(loginBody.user.email, email);
      const cookie = cookieFromSetCookie(login.headers['set-cookie']);
      assert.ok(cookie);
      assert.equal(cookie.name, 'manara_session');

      const session = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      });
      assert.equal(session.statusCode, 200);
      assert.equal(JSON.parse(session.body).session.id, loginBody.session.id);

      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'not-an-email', password: '' },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(JSON.parse(invalid.body).error.code, 'http.validation_failed');

      const refresh = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      });
      assert.equal(refresh.statusCode, 200);
      const refreshedCookie = cookieFromSetCookie(refresh.headers['set-cookie']);
      assert.ok(refreshedCookie);
      assert.notEqual(refreshedCookie.value, cookie.value);

      const staleSession = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      });
      assert.equal(staleSession.statusCode, 401);

      const logout = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { cookie: `${cookie.name}=${refreshedCookie.value}` },
      });
      assert.equal(logout.statusCode, 204);

      const afterLogout = await app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: `${cookie.name}=${refreshedCookie.value}` },
      });
      assert.equal(afterLogout.statusCode, 401);
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
