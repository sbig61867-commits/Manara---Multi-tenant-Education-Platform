import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction } from '../../src/transaction.js';
import type { MigrationCliOptions, MigrationSummary } from '../../src/migrations/cli.js';
import { resolveMigrationDirectory, runMigrationCli } from '../../src/migrations/cli.js';

const SECRET_URL = 'postgres://secret-user:secret-password@db.example.test/manara';

class FakeDatabase {
  closed = false;

  async query(): Promise<{ rows: never[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work({ id: 'fake', query: this.query });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function harness(overrides: MigrationCliOptions = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  let created = 0;
  const database = new FakeDatabase();
  const options: MigrationCliOptions = {
    env: { DATABASE_URL: SECRET_URL },
    loadEnvironment: () => undefined,
    createDatabase: () => {
      created += 1;
      return database;
    },
    execute: async () => ({ discovered: 7, applied: 7, alreadyApplied: 0, pending: 0 }),
    writeOutput: (message) => output.push(message),
    writeError: (message) => errors.push(message),
    ...overrides,
  };
  return { options, output, errors, database, created: () => created };
}

test('missing DATABASE_URL fails before pool creation', async () => {
  const h = harness({ env: {} });
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.created(), 0);
});

test('invalid DATABASE_URL fails without leaking configuration', async () => {
  const h = harness({ env: { DATABASE_URL: 'not-a-postgres-url' } });
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.created(), 0);
  assert.equal(h.errors.join(''), 'Database migration failed.\n');
});

test('success prints only bounded counts and closes the pool', async () => {
  const h = harness();
  assert.equal(await runMigrationCli(h.options), 0);
  assert.equal(h.output.join(''), 'Database migrations complete: discovered=7 applied=7 alreadyApplied=0 pending=0\n');
  assert.equal(h.errors.length, 0);
  assert.equal(h.database.closed, true);
  assert.equal(h.output.join('').includes('secret-password'), false);
});

test('execution failure is sanitized and closes the pool', async () => {
  const h = harness({
    execute: async () => {
      throw new Error(`driver exploded for ${SECRET_URL}; SQL=DROP TABLE users`);
    },
  });
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.output.length, 0);
  assert.equal(h.errors.join(''), 'Database migration failed.\n');
  assert.equal(h.database.closed, true);
});

test('pool close failure changes a successful execution to failure safely', async () => {
  const h = harness();
  h.database.close = async () => {
    throw new Error(`close failed ${SECRET_URL}`);
  };
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.output.length, 0);
  assert.equal(h.errors.join(''), 'Database migration failed.\n');
});

test('an interrupted command prevents work and exits nonzero', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness({ signal: controller.signal });
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.created(), 0);
  assert.equal(h.errors.join(''), 'Database migration failed.\n');
});

test('an interruption during execution closes resources and exits nonzero', async () => {
  const controller = new AbortController();
  const h = harness({
    signal: controller.signal,
    execute: async (_database, _dir, shouldContinue): Promise<MigrationSummary> => {
      controller.abort();
      assert.equal(shouldContinue(), false);
      throw new Error('interrupted');
    },
  });
  assert.equal(await runMigrationCli(h.options), 1);
  assert.equal(h.database.closed, true);
});

test('compiled entrypoint resolves the copied dist migration directory', () => {
  const compiledDirectory = 'C:/workspace/packages/database/dist/migrations';
  assert.match(resolveMigrationDirectory(compiledDirectory).replaceAll('\\', '/'), /\/dist\/migrations\/sql\/?$/);
});
