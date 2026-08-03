import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, describe, test } from 'node:test';
import { currentTransaction, type PostgresDatabase } from '../../src/index.js';
import { createTestDatabase, getTestDatabaseUrl } from '../helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

const TABLE = `manara_tx_test_${Date.now()}`;

describe('transactions (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;

  before(async () => {
    database = createTestDatabase();
    await database.query(`CREATE TABLE ${TABLE} (id serial PRIMARY KEY, value text NOT NULL)`);
  });

  after(async () => {
    if (database) {
      try {
        await database.query(`DROP TABLE ${TABLE}`);
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

  test('commits work and are visible after the transaction', async () => {
    const db = requireDb();
    await db.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO ${TABLE} (value) VALUES ($1)`, ['committed']);
      const rows = await tx.query<{ value: string }>(`SELECT value FROM ${TABLE}`);
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0]?.value, 'committed');
    });
    const rows = await db.query<{ value: string }>(`SELECT value FROM ${TABLE}`);
    assert.deepEqual(
      rows.rows.map((row) => row.value),
      ['committed'],
    );
  });

  test('rolls back on error and leaves no trace', async () => {
    const db = requireDb();
    await assert.rejects(
      db.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO ${TABLE} (value) VALUES ($1)`, ['rolled-back']);
        throw new Error('boom');
      }),
      /boom/,
    );
    const rows = await db.query<{ value: string }>(`SELECT value FROM ${TABLE}`);
    assert.deepEqual(
      rows.rows.map((row) => row.value),
      ['committed'],
    );
  });

  test('routes queries through the active transaction context', async () => {
    const db = requireDb();
    let observed: string | undefined;
    await db.withTransaction(async () => {
      await db.query(`INSERT INTO ${TABLE} (value) VALUES ($1)`, ['context']);
      const rows = await db.query<{ value: string }>(
        `SELECT value FROM ${TABLE} ORDER BY id DESC LIMIT 1`,
      );
      observed = rows.rows[0]?.value;
    });
    assert.equal(observed, 'context');
  });

  test('transaction contexts do not leak between concurrent operations', async () => {
    const db = requireDb();
    const marker = randomUUID();
    const work = (value: string) =>
      db.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO ${TABLE} (value) VALUES ($1)`, [`${value}-${marker}`]);
        const rows = await tx.query<{ value: string }>(`SELECT value FROM ${TABLE} WHERE value LIKE $1`, [
          `%-${marker}`,
        ]);
        assert.ok(rows.rows.some((row) => row.value === `${value}-${marker}`));
      });
    await Promise.all([work('a'), work('b')]);
    const rows = await db.query<{ value: string }>(`SELECT value FROM ${TABLE} WHERE value LIKE $1`, [
      `%-${marker}`,
    ]);
    assert.equal(rows.rows.length, 2);
  });

  test('rejects nested transactions', async () => {
    const db = requireDb();
    await assert.rejects(
      db.withTransaction(async () => db.withTransaction(async () => undefined)),
      /Nested transactions are not supported/,
    );
  });

  test('currentTransaction is undefined outside a transaction', () => {
    assert.equal(currentTransaction(), undefined);
  });

  test('currentTransaction is defined inside a transaction', async () => {
    const db = requireDb();
    let seen = false;
    await db.withTransaction(async () => {
      seen = currentTransaction() !== undefined;
    });
    assert.equal(seen, true);
  });
});
