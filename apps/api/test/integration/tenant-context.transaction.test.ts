import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PostgresDatabase } from '@manara/database';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { PostgresTenantTransactionRunner } from '../../src/tenant/adapters/postgres-transaction-runner.js';
import { createTestDatabase, getTestDatabaseUrl } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

interface ContextRow {
  tenant_id: string | null;
}

async function readTenantSetting(database: PostgresDatabase): Promise<string | null> {
  const rows = await database.query<ContextRow>("SELECT current_setting('app.tenant_id', true) AS tenant_id");
  const value = rows.rows[0]?.tenant_id;
  return value === undefined || value === '' ? null : value;
}

describe('tenant context → PostgreSQL (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let runner: PostgresTenantTransactionRunner | undefined;

  before(async () => {
    database = createTestDatabase();
    runner = new PostgresTenantTransactionRunner(database);
  });

  after(async () => {
    if (database) {
      await database.close();
    }
  });

  function requireRunner(): PostgresTenantTransactionRunner {
    if (runner === undefined) {
      throw new Error('before hook did not create the transaction runner');
    }
    return runner;
  }

  function requireDb(): PostgresDatabase {
    if (database === undefined) {
      throw new Error('before hook did not create the database');
    }
    return database;
  }

  test('exposes the resolved tenant id inside the transaction', async () => {
    const observed = await AlsTenantContextResolver.runWithTenant('tenant-a', async () => {
      return requireRunner().runInTransaction(async () => readTenantSetting(requireDb()));
    });
    assert.equal(observed, 'tenant-a');
  });

  test('sets the context transaction-locally (does not leak after commit)', async () => {
    await AlsTenantContextResolver.runWithTenant('tenant-local', async () => {
      await requireRunner().runInTransaction(async () => {
        assert.equal(await readTenantSetting(requireDb()), 'tenant-local');
      });
    });
    assert.equal(await readTenantSetting(requireDb()), null);
  });

  test('distinguishes concurrent tenant transactions', async () => {
    const work = (tenantId: string) =>
      AlsTenantContextResolver.runWithTenant(tenantId, () =>
        requireRunner().runInTransaction(async () => readTenantSetting(requireDb())),
      );
    const [a, b] = await Promise.all([work('tenant-a'), work('tenant-b')]);
    assert.equal(a, 'tenant-a');
    assert.equal(b, 'tenant-b');
  });

  test('leaves the setting unset when no tenant context is present', async () => {
    const observed = await requireRunner().runInTransaction(async () => readTenantSetting(requireDb()));
    assert.equal(observed, null);
  });
});
