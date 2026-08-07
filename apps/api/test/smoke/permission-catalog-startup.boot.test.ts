import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgresPermissionRepository } from '../../src/authorization/adapters/postgres-permission.repository.js';
import { PostgresAuthorizationTransactionRunner } from '../../src/authorization/adapters/postgres-transaction-runner.js';
import { PermissionCatalogService } from '../../src/authorization/application/permission-catalog.service.js';
import { PermissionCatalogStartupError } from '../../src/authorization/application/permission-catalog-startup-verifier.js';
import { createApiApplication } from '../../src/bootstrap.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping permission catalog startup smoke tests' : false;

function withProductionEnv(databaseUrl: string | undefined): () => void {
  const overrides = {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    LOG_LEVEL: 'error',
    LOG_PRETTY: 'false',
    API_CORS_ORIGINS: 'https://app.example.com',
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
  await database.query('TRUNCATE TABLE permissions CASCADE');
  return database;
}

function catalogService(database: PostgresDatabase): PermissionCatalogService {
  return new PermissionCatalogService(
    new PostgresPermissionRepository(database),
    new PostgresAuthorizationTransactionRunner(database),
  );
}

test('production boot succeeds only after the complete catalog exists', { skip }, async () => {
  const database = await prepareDatabase();
  const restore = withProductionEnv(getTestDatabaseUrl() ?? undefined);
  let app: NestFastifyApplication | null = null;
  try {
    const service = catalogService(database);
    await service.seedCatalog();
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    app = await createApiApplication(config);
    assert.ok(app);
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
    const service = catalogService(database);
    await service.seedCatalog();
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
    await catalogService(database).seedCatalog();
    await database.close();
    restore();
  }
});

test('production boot fails closed when the catalog is empty', { skip }, async () => {
  const database = await prepareDatabase();
  const restore = withProductionEnv(getTestDatabaseUrl() ?? undefined);
  try {
    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    await assert.rejects(createApiApplication(config), (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.required, 34);
      assert.equal(error.present, 0);
      assert.equal(error.missingKeys.length, 34);
      return true;
    });
  } finally {
    await catalogService(database).seedCatalog();
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
