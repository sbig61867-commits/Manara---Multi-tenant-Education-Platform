import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkDatabaseReadiness, PostgresDatabase } from '../../src/index.js';
import { createTestDatabase, getTestDatabaseUrl } from '../helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

describe('database readiness (integration)', { skip }, () => {
  test('reports ready when the database is reachable', async () => {
    const database = createTestDatabase();
    try {
      const readiness = await checkDatabaseReadiness(database);
      assert.equal(readiness.status, 'ready');
      assert.equal(typeof readiness.latencyMs, 'number');
      assert.ok(readiness.latencyMs !== undefined);
    } finally {
      await database.close();
    }
  });

  test('reports unavailable when the database is unreachable', async () => {
    const database = new PostgresDatabase({
      connectionString: 'postgres://user:pass@127.0.0.1:1/manara',
      connectionTimeoutMillis: 500,
    });
    try {
      const readiness = await checkDatabaseReadiness(database, { timeoutMs: 3000 });
      assert.equal(readiness.status, 'unavailable');
      assert.equal(typeof readiness.error, 'string');
    } finally {
      await database.close();
    }
  });

  test('reports unavailable after the pool is closed', async () => {
    const database = createTestDatabase();
    await database.close();
    const readiness = await checkDatabaseReadiness(database);
    assert.equal(readiness.status, 'unavailable');
  });
});
