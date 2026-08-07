import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApiApplication } from '../../src/bootstrap.js';
import { EXPECTED_SECURITY_HEADERS } from '../../src/http/security-headers.js';

const QUIET_ENV: Record<string, string> = { LOG_LEVEL: 'error', LOG_PRETTY: 'false' };

function withEnv(overrides: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function withApi(
  overrides: Record<string, string | undefined>,
  fn: (app: NestFastifyApplication) => Promise<void>,
): Promise<void> {
  const restore = withEnv({ ...QUIET_ENV, NODE_ENV: 'development', ...overrides });
  let app: NestFastifyApplication | null = null;
  try {
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    app = await createApiApplication(config);
    await fn(app);
  } finally {
    await app?.close();
    restore();
  }
}

async function expectBootFailure(
  overrides: Record<string, string | undefined>,
  expected: RegExp,
): Promise<void> {
  const restore = withEnv({ ...QUIET_ENV, NODE_ENV: 'production', ...overrides });
  try {
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    await assert.rejects(createApiApplication(config), expected);
  } finally {
    restore();
  }
}

test('the application boots and /health returns 200 with request id and security headers', async () => {
  await withApi({ API_CORS_ORIGINS: '' }, async (app) => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { status: string; service: string };
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'api');
    assert.ok(response.headers['x-request-id']);
    for (const header of EXPECTED_SECURITY_HEADERS) {
      assert.ok(response.headers[header], `expected security header ${header}`);
    }
  });
});

test('/v1/health/ready returns 200 when DATABASE_URL is available and 503 otherwise', async () => {
  await withApi({}, async (app) => {
    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    const body = JSON.parse(response.body) as { status: string; database: { status: string } };
    const databaseAvailable = (process.env.DATABASE_URL ?? '').trim() !== '';
    if (databaseAvailable) {
      assert.equal(response.statusCode, 200);
      assert.equal(body.status, 'ready');
      assert.equal(body.database.status, 'ready');
    } else {
      assert.equal(response.statusCode, 503);
      assert.equal(body.status, 'unavailable');
    }
  });
});

test('unknown routes return the stable 404 error shape', async () => {
  await withApi({}, async (app) => {
    const response = await app.inject({ method: 'GET', url: '/v1/no/such/endpoint' });
    assert.equal(response.statusCode, 404);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    const body = JSON.parse(response.body) as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, 'http.not_found');
    assert.equal(body.error.message, 'Cannot GET /v1/no/such/endpoint');
    assert.ok(body.error.requestId);
    assert.equal(response.headers['x-request-id'], body.error.requestId);
  });
});

test('swagger is enabled in development (auto) and serves /docs', async () => {
  await withApi({ NODE_ENV: 'development', API_ENABLE_DOCS: 'auto' }, async (app) => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(ui.statusCode, 200);
    const json = await app.inject({ method: 'GET', url: '/docs-json' });
    assert.equal(json.statusCode, 200);
  });
});

test('swagger is enabled in test (auto) and serves /docs', async () => {
  await withApi({ NODE_ENV: 'test', API_ENABLE_DOCS: 'auto' }, async (app) => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(ui.statusCode, 200);
  });
});

test('swagger is disabled in production (auto) and /docs returns 404', async () => {
  await withApi(
    { NODE_ENV: 'production', API_CORS_ORIGINS: 'https://app.example.com', API_ENABLE_DOCS: 'auto' },
    async (app) => {
      const ui = await app.inject({ method: 'GET', url: '/docs' });
      assert.equal(ui.statusCode, 404);
      const json = await app.inject({ method: 'GET', url: '/docs-json' });
      assert.equal(json.statusCode, 404);
    },
  );
});

test('swagger is enabled in production when explicitly configured', async () => {
  await withApi(
    { NODE_ENV: 'production', API_CORS_ORIGINS: 'https://app.example.com', API_ENABLE_DOCS: 'true' },
    async (app) => {
      const ui = await app.inject({ method: 'GET', url: '/docs' });
      assert.equal(ui.statusCode, 200);
    },
  );
});

test('swagger is disabled when explicitly configured off', async () => {
  await withApi({ NODE_ENV: 'development', API_ENABLE_DOCS: 'false' }, async (app) => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(ui.statusCode, 404);
  });
});

test('development with empty API_CORS_ORIGINS boots and serves /health', async () => {
  await withApi({ API_CORS_ORIGINS: '' }, async (app) => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
  });
});

test('production with empty API_CORS_ORIGINS fails closed at boot', async () => {
  await expectBootFailure(
    { NODE_ENV: 'production', API_CORS_ORIGINS: '' },
    /API_CORS_ORIGINS must be configured in staging and production/,
  );
});

test('production without API_CORS_ORIGINS fails closed at boot', async () => {
  await expectBootFailure(
    { NODE_ENV: 'production', API_CORS_ORIGINS: undefined },
    /API_CORS_ORIGINS must be configured in staging and production/,
  );
});

test('staging without API_CORS_ORIGINS fails closed at boot', async () => {
  await expectBootFailure(
    { NODE_ENV: 'staging', API_CORS_ORIGINS: undefined },
    /API_CORS_ORIGINS must be configured in staging and production/,
  );
});

test('staging rejects explicitly insecure session cookies during configuration', () => {
  assert.equal(
    apiEnvSchema.safeParse({ NODE_ENV: 'staging', API_COOKIE_SECURE: 'false' }).success,
    false,
  );
});
