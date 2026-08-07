import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, describe, test } from 'node:test';
import { MigrationRunner, PostgresDatabase } from '../../src/index.js';
import type { QueryResult, Transaction, TransactionalExecutor } from '../../src/index.js';
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

describe('production migration behavior (integration)', { skip }, () => {
  class SchemaScopedDatabase implements TransactionalExecutor {
    constructor(
      private readonly database: PostgresDatabase,
      private readonly schema: string,
    ) {}

    async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      return this.database.withTransaction(async (tx) => {
        await tx.query(`SET LOCAL search_path TO ${this.schema}`);
        return tx.query<T>(sql, params);
      });
    }

    async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      return this.database.withTransaction(async (tx) => {
        await tx.query(`SET LOCAL search_path TO ${this.schema}`);
        return work(tx);
      });
    }

    close(): Promise<void> {
      return this.database.close();
    }
  }

  async function withIsolatedSchema<T>(work: (databases: readonly [SchemaScopedDatabase, SchemaScopedDatabase]) => Promise<T>): Promise<T> {
    const rawUrl = getTestDatabaseUrl();
    if (rawUrl === null) {
      throw new Error('DATABASE_URL is required for integration tests');
    }
    const schema = `migration_cli_${randomUUID().replace(/-/g, '')}`;
    const admin = createTestDatabase();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const first = new SchemaScopedDatabase(
      new PostgresDatabase({ connectionString: rawUrl, max: 1, connectionTimeoutMillis: 8000 }),
      schema,
    );
    const second = new SchemaScopedDatabase(
      new PostgresDatabase({ connectionString: rawUrl, max: 1, connectionTimeoutMillis: 8000 }),
      schema,
    );
    try {
      return await work([first, second]);
    } finally {
      await Promise.allSettled([first.close(), second.close()]);
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.close();
      }
    }
  }

  test('applies all seven production migrations once and reruns idempotently', async () => {
    await withIsolatedSchema(async ([database]) => {
      const migrationsDir = join(process.cwd(), 'src', 'migrations', 'sql');
      const runner = new MigrationRunner(database, { migrationsDir });
      const first = await runner.runMigrations();
      const second = await runner.runMigrations();
      const pending = await runner.pendingMigrations();
      const ledger = await runner.appliedMigrations();
      assert.deepEqual(first.map((migration) => migration.version), [
        '0001',
        '0002',
        '0003',
        '0004',
        '0005',
        '0006',
        '0007',
      ]);
      assert.deepEqual(second, []);
      assert.deepEqual(pending, []);
      assert.equal(ledger.length, 7);
    });
  });

  test('two runners initialize a fresh ledger concurrently without duplicate versions', async () => {
    await withIsolatedSchema(async ([firstDatabase, secondDatabase]) => {
      const migrationsDir = join(process.cwd(), 'src', 'migrations', 'sql');
      const firstRunner = new MigrationRunner(firstDatabase, { migrationsDir });
      const secondRunner = new MigrationRunner(secondDatabase, { migrationsDir });
      const [firstApplied, secondApplied] = await Promise.all([
        firstRunner.runMigrations(),
        secondRunner.runMigrations(),
      ]);
      const ledger = await firstDatabase.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.equal(firstApplied.length + secondApplied.length, 7);
      assert.deepEqual(ledger.rows.map((row) => row.version), [
        '0001',
        '0002',
        '0003',
        '0004',
        '0005',
        '0006',
        '0007',
      ]);
      assert.equal(new Set(ledger.rows.map((row) => row.version)).size, 7);
    });
  });

  test('a failed migration rolls back while earlier migrations remain committed', async () => {
    await withIsolatedSchema(async ([database]) => {
      const dir = await mkdtemp(join(tmpdir(), 'manara-failing-migrations-'));
      try {
        await writeFile(join(dir, '0001_committed.sql'), 'CREATE TABLE committed_marker (id integer PRIMARY KEY);');
        await writeFile(
          join(dir, '0002_fails.sql'),
          'CREATE TABLE rolled_back_marker (id integer PRIMARY KEY); SELECT * FROM deliberately_missing_relation;',
        );
        const runner = new MigrationRunner(database, { migrationsDir: dir });
        await assert.rejects(runner.runMigrations());
        const relations = await database.query<{ committed: string | null; rolled_back: string | null }>(
          `SELECT to_regclass('committed_marker')::text AS committed,
                  to_regclass('rolled_back_marker')::text AS rolled_back`,
        );
        const ledger = await runner.appliedMigrations();
        assert.equal(relations.rows[0]?.committed, 'committed_marker');
        assert.equal(relations.rows[0]?.rolled_back, null);
        assert.deepEqual(ledger.map((record) => record.version), ['0001']);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
