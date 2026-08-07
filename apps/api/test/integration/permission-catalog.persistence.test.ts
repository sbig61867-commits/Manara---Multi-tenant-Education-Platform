import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { PostgresPermissionRepository } from '../../src/authorization/adapters/postgres-permission.repository.js';
import { PostgresAuthorizationTransactionRunner } from '../../src/authorization/adapters/postgres-transaction-runner.js';
import { PermissionCatalogService } from '../../src/authorization/application/permission-catalog.service.js';
import type { Permission } from '../../src/authorization/domain/types.js';
import { PLATFORM_PERMISSION_CATALOG } from '../../src/authorization/platform-permission-catalog.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping permission catalog integration tests' : false;

describe('permission catalog persistence (integration)', { skip, concurrency: 1 }, () => {
  let database: PostgresDatabase;

  before(async () => {
    database = createTestDatabase();
    await new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR }).runMigrations();
  });

  beforeEach(async () => {
    await database.query('TRUNCATE TABLE users, permissions CASCADE');
  });

  after(async () => {
    await database.close();
  });

  function service(repository = new PostgresPermissionRepository(database)): PermissionCatalogService {
    return new PermissionCatalogService(repository, new PostgresAuthorizationTransactionRunner(database));
  }

  async function catalogRows(): Promise<Array<{ id: string; key: string; module: string; description: string | null; status: string }>> {
    return (
      await database.query<{ id: string; key: string; module: string; description: string | null; status: string }>(
        'SELECT id, key, module, description, status FROM permissions ORDER BY key',
      )
    ).rows;
  }

  test('empty catalog seeds exactly 34 rows and creates no principals or grants', async () => {
    const result = await service().seedCatalog();
    assert.deepEqual(result, { required: 34, inserted: 34, reconciled: 0, unchanged: 0 });
    assert.equal((await catalogRows()).length, 34);
    for (const table of ['roles', 'role_permissions', 'role_assignments', 'memberships', 'users']) {
      const count = await database.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${table}`);
      assert.equal(count.rows[0]?.total, 0, `${table} must remain empty`);
    }
  });

  test('rerun is idempotent and preserves permission ids', async () => {
    await service().seedCatalog();
    const first = await catalogRows();
    const result = await service().seedCatalog();
    const second = await catalogRows();
    assert.deepEqual(result, { required: 34, inserted: 0, reconciled: 0, unchanged: 34 });
    assert.deepEqual(second, first);
  });

  test('partial catalog inserts only missing rows', async () => {
    const descriptor = PLATFORM_PERMISSION_CATALOG[0]!;
    const existingId = randomUUID();
    await database.query(
      "INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, $3, $4, 'active')",
      [existingId, descriptor.key, descriptor.module, descriptor.description],
    );
    const result = await service().seedCatalog();
    assert.deepEqual(result, { required: 34, inserted: 33, reconciled: 0, unchanged: 1 });
    const existing = (await catalogRows()).find((row) => row.key === descriptor.key);
    assert.equal(existing?.id, existingId);
  });

  test('metadata changes reconcile module and description while preserving id', async () => {
    const descriptor = PLATFORM_PERMISSION_CATALOG[0]!;
    const existingId = randomUUID();
    await database.query(
      "INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, 'wrong', 'stale', 'active')",
      [existingId, descriptor.key],
    );
    const result = await service().seedCatalog();
    const row = (await catalogRows()).find((candidate) => candidate.key === descriptor.key);
    assert.equal(result.reconciled, 1);
    assert.equal(row?.id, existingId);
    assert.equal(row?.module, descriptor.module);
    assert.equal(row?.description, descriptor.description);
  });

  test('unknown permission rows remain untouched', async () => {
    const unknown = { id: randomUUID(), key: 'custom:unknown', module: 'custom', description: 'Tenant-owned extension.' };
    await database.query(
      "INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, $3, $4, 'draft')",
      [unknown.id, unknown.key, unknown.module, unknown.description],
    );
    await service().seedCatalog();
    const row = (await catalogRows()).find((candidate) => candidate.key === unknown.key);
    assert.deepEqual(row, { ...unknown, status: 'draft' });
  });

  test('existing permission status remains untouched', async () => {
    const descriptor = PLATFORM_PERMISSION_CATALOG[0]!;
    await database.query(
      "INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, 'wrong', 'stale', 'retired')",
      [randomUUID(), descriptor.key],
    );
    await service().seedCatalog();
    const row = (await catalogRows()).find((candidate) => candidate.key === descriptor.key);
    assert.equal(row?.status, 'retired');
    assert.equal(row?.module, descriptor.module);
    assert.equal(row?.description, descriptor.description);
  });

  test('concurrent seed commands produce one correct catalog', async () => {
    const results = await Promise.all([service().seedCatalog(), service().seedCatalog(), service().seedCatalog()]);
    assert.equal((await catalogRows()).length, 34);
    assert.equal(results.reduce((total, result) => total + result.inserted, 0), 34);
    assert.ok(results.every((result) => result.required === 34));
  });

  test('transaction rolls back completely on an injected repository failure', async () => {
    class FailingPermissionRepository extends PostgresPermissionRepository {
      private inserts = 0;

      override async insertCatalogPermission(permission: Permission): Promise<boolean> {
        const inserted = await super.insertCatalogPermission(permission);
        this.inserts += 1;
        if (this.inserts === 5) {
          throw new Error('injected catalog failure');
        }
        return inserted;
      }
    }

    await assert.rejects(service(new FailingPermissionRepository(database)).seedCatalog(), /injected catalog failure/);
    assert.equal((await catalogRows()).length, 0);
  });
});
