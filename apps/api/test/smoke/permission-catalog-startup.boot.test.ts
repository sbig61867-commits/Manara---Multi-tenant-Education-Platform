import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PermissionCatalogStartupError } from '../../src/authorization/application/permission-catalog-startup-verifier.js';
import { PLATFORM_PERMISSION_CATALOG } from '../../src/authorization/platform-permission-catalog.js';
import { createApiApplication } from '../../src/bootstrap.js';
import { DATABASE } from '../../src/database/database.constants.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';
import { seedPlatformPermissionCatalog } from './helpers/permission-catalog.fixture.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping permission catalog startup smoke tests' : false;

function withProductionEnv(databaseUrl: string | undefined): () => void {
  const overrides = {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    LOG_LEVEL: 'error',
    LOG_PRETTY: 'false',
    API_CORS_ORIGINS: 'https://app.example.com',
    API_DATABASE_POOL_MAX: '9',
    DATABASE_CONNECTION_TIMEOUT_MS: '14000',
    DATABASE_IDLE_TIMEOUT_MS: '42000',
  } as const;
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

async function prepareDatabase(): Promise<PostgresDatabase> {
  const database = createTestDatabase();
  await new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR }).runMigrations();
  return database;
}

test('production boot succeeds only after the complete catalog exists', { skip }, async () => {
  const database = await prepareDatabase();
  const restore = withProductionEnv(getTestDatabaseUrl() ?? undefined);
  let app: NestFastifyApplication | null = null;
  try {
    const unknownKey = 'test:unknown_permission';
    await database.query(
      "INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, 'test', 'Unknown fixture row.', 'retired') ON CONFLICT (key) DO UPDATE SET status = 'retired'",
      [randomUUID(), unknownKey],
    );
    const unknownBefore = await database.query<{ id: string; module: string; description: string | null; status: string }>(
      'SELECT id, module, description, status FROM permissions WHERE key = $1',
      [unknownKey],
    );
    const firstPermissionIds = await seedPlatformPermissionCatalog(database);
    const secondPermissionIds = await seedPlatformPermissionCatalog(database);
    assert.deepEqual([...secondPermissionIds], [...firstPermissionIds]);
    const unknownAfter = await database.query<{ id: string; module: string; description: string | null; status: string }>(
      'SELECT id, module, description, status FROM permissions WHERE key = $1',
      [unknownKey],
    );
    assert.deepEqual(unknownAfter.rows, unknownBefore.rows);
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    app = await createApiApplication(config);
    assert.ok(app);
    const appDatabase = app.get(DATABASE) as unknown as {
      pool: { options: { max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number } };
    };
    assert.equal(appDatabase.pool.options.max, 9);
    assert.equal(appDatabase.pool.options.connectionTimeoutMillis, 14000);
    assert.equal(appDatabase.pool.options.idleTimeoutMillis, 42000);
  } finally {
    await app?.close();
    await database.close();
    restore();
  }
});

test('production boot fails before initialization when a required key is missing', { skip }, async () => {
  const database = await prepareDatabase();
  const restore = withProductionEnv(getTestDatabaseUrl() ?? undefined);
  try {
    await seedPlatformPermissionCatalog(database);
    await database.query("DELETE FROM permissions WHERE key = 'invitation:revoke'");
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    await assert.rejects(createApiApplication(config), (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.required, 34);
      assert.equal(error.present, 33);
      assert.deepEqual(error.missingKeys, ['invitation:revoke']);
      return true;
    });
  } finally {
    await seedPlatformPermissionCatalog(database);
    await database.close();
    restore();
  }
});

test('production boot fails closed when the catalog is empty', { skip }, async () => {
  const database = await prepareDatabase();
  const restore = withProductionEnv(getTestDatabaseUrl() ?? undefined);
  try {
    await database.query('DELETE FROM permissions WHERE key = ANY($1::text[])', [
      PLATFORM_PERMISSION_CATALOG.map(({ key }) => key),
    ]);
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    await assert.rejects(createApiApplication(config), (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.required, 34);
      assert.equal(error.present, 0);
      assert.equal(error.missingKeys.length, 34);
      return true;
    });
  } finally {
    await seedPlatformPermissionCatalog(database);
    await database.close();
    restore();
  }
});

test('production boot fails closed without DATABASE_URL', async () => {
  const restore = withProductionEnv(undefined);
  try {
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    await assert.rejects(createApiApplication(config), (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.required, 34);
      assert.equal(error.present, 0);
      return true;
    });
  } finally {
    restore();
  }
});
