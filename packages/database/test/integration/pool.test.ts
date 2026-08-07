import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PostgresDatabase } from '../../src/index.js';
import { CollectingLogger, createTestDatabase, getTestDatabaseUrl, withTestDatabase } from '../helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

describe('database pool (integration)', { skip }, () => {
  test('forwards explicit connection budgets and timeouts to pg.Pool', async () => {
    const url = getTestDatabaseUrl();
    assert.ok(url);
    const database = new PostgresDatabase({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 15000,
    });
    try {
      const pool = (database as unknown as {
        pool: { options: { max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number } };
      }).pool;
      assert.equal(pool.options.max, 3);
      assert.equal(pool.options.connectionTimeoutMillis, 4000);
      assert.equal(pool.options.idleTimeoutMillis, 15000);
    } finally {
      await database.close();
    }
  });
  test('creates a pool and closes it cleanly', async () => {
    await withTestDatabase(async (database) => {
      const result = await database.query<{ one: number }>('SELECT 1 AS one');
      assert.deepEqual(result.rows, [{ one: 1 }]);
      assert.equal(result.rowCount, 1);
    });
  });

  test('close is idempotent', async () => {
    await withTestDatabase(async (database) => {
      await database.close();
      await database.close();
    });
  });

  test('queries fail after the pool is closed', async () => {
    await withTestDatabase(async (database) => {
      await database.close();
      await assert.rejects(database.query('SELECT 1'));
    });
  });

  test('database logs never expose the connection string or credentials', async () => {
    const url = getTestDatabaseUrl();
    assert.ok(url);
    const logger = new CollectingLogger();
    const database = createTestDatabase(logger);
    try {
      await database.query('SELECT 1 AS one');
      await database.query('SELECT $1::text AS value', ['sensitive-value']);
    } finally {
      await database.close();
    }
    const rendered = JSON.stringify(logger.events);
    assert.equal(rendered.includes(url), false);
    assert.equal(rendered.includes('sensitive-value'), false);
    const password = new URL(url).password;
    if (password !== '') {
      assert.equal(rendered.includes(password), false);
    }
  });
});
