import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseOptions, Transaction } from '@manara/database';
import { runPermissionCatalogCli } from '../../src/authorization/permission-catalog.cli.js';

const SECRET_URL = 'postgres://secret-user:secret-password@db.example.test/manara';

class FakeDatabase {
  closed = false;

  async query(): Promise<{ rows: never[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async withTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return work({ id: 'fake', query: this.query });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function harness() {
  const database = new FakeDatabase();
  const output: string[] = [];
  const errors: string[] = [];
  let createdWith: DatabaseOptions | null = null;
  return {
    database,
    output,
    errors,
    createdWith: () => createdWith,
    options: {
      env: {
        DATABASE_URL: SECRET_URL,
        DATABASE_CONNECTION_TIMEOUT_MS: '12000',
        DATABASE_IDLE_TIMEOUT_MS: '36000',
      },
      loadEnvironment: () => undefined,
      createDatabase: (poolOptions: DatabaseOptions) => {
        createdWith = poolOptions;
        return database;
      },
      execute: async () => ({ required: 34, inserted: 0, reconciled: 0, unchanged: 34, valid: true }),
      writeOutput: (message: string) => output.push(message),
      writeError: (message: string) => errors.push(message),
    },
  };
}

test('permission seed uses one connection, shared timeouts, safe output, and closes', async () => {
  const h = harness();
  assert.equal(await runPermissionCatalogCli(h.options), 0);
  assert.deepEqual(h.createdWith(), {
    connectionString: SECRET_URL,
    max: 1,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 36000,
  });
  assert.equal(h.database.closed, true);
  assert.equal(h.errors.length, 0);
  assert.equal(h.output.join('').includes('secret-password'), false);
});

test('permission seed failure is sanitized and closes its pool', async () => {
  const h = harness();
  h.options.execute = async () => {
    throw new Error(`driver failed for ${SECRET_URL}`);
  };
  assert.equal(await runPermissionCatalogCli(h.options), 1);
  assert.equal(h.database.closed, true);
  assert.equal(h.output.length, 0);
  assert.equal(h.errors.join(''), 'Permission catalog seed failed.\n');
  assert.equal(h.errors.join('').includes('secret-password'), false);
});
