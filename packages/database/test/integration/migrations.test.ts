import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '../../src/index.js';
import { createTestDatabase, getTestDatabaseUrl } from '../helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

const LEDGER = `schema_migrations_test_${randomUUID().replace(/-/g, '')}`;

describe('migration runner (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;

  before(async () => {
    database = createTestDatabase();
  });

  after(async () => {
    if (database) {
      try {
        await database.query(`DROP TABLE IF EXISTS ${LEDGER}`);
      } finally {
        await database.close();
      }
    }
  });

  function requireDb(): PostgresDatabase {
    if (database === undefined) {
      throw new Error('before hook did not create the database');
    }
    return database;
  }

  async function withMigrationsDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'manara-migrations-'));
    try {
      return await work(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test('discovers, orders, applies, and records versioned migrations', async () => {
    const db = requireDb();
    await withMigrationsDir(async (dir) => {
      await writeFile(join(dir, '0002_second.sql'), 'SELECT 2;');
      await writeFile(join(dir, '0001_first.sql'), 'SELECT 1;');
      const runner = new MigrationRunner(db, { migrationsDir: dir, table: LEDGER });
      const applied = await runner.runMigrations();
      assert.deepEqual(
        applied.map((migration) => migration.version),
        ['0001', '0002'],
      );
      const records = await runner.appliedMigrations();
      assert.deepEqual(
        records.map((record) => record.version),
        ['0001', '0002'],
      );
      const pending = await runner.pendingMigrations();
      assert.deepEqual(pending, []);
    });
  });

  test('is idempotent on subsequent runs', async () => {
    const db = requireDb();
    await withMigrationsDir(async (dir) => {
      await writeFile(join(dir, '0010_only.sql'), 'SELECT 1;');
      const runner = new MigrationRunner(db, { migrationsDir: dir, table: LEDGER });
      const firstRun = await runner.runMigrations();
      assert.deepEqual(
        firstRun.map((migration) => migration.version),
        ['0010'],
      );
      const secondRun = await runner.runMigrations();
      assert.deepEqual(secondRun, []);
    });
  });

  test('applies only pending migrations when new files are added', async () => {
    const db = requireDb();
    await withMigrationsDir(async (dir) => {
      await writeFile(join(dir, '0010_initial.sql'), 'SELECT 1;');
      const runner = new MigrationRunner(db, { migrationsDir: dir, table: LEDGER });
      await runner.runMigrations();
      await writeFile(join(dir, '0011_added_later.sql'), 'SELECT 2;');
      const applied = await runner.runMigrations();
      assert.deepEqual(
        applied.map((migration) => migration.version),
        ['0011'],
      );
    });
  });
});
