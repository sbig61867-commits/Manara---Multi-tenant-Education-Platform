import assert from 'node:assert/strict';
import test from 'node:test';
import { workerEnvSchema } from '@manara/config';
import { buildWorkerDatabaseOptions } from '../../src/main.js';

const databaseConfig = {
  connectionString: 'postgres://user:secret@db.example.test/manara',
  host: 'db.example.test',
  port: 5432,
  database: 'manara',
  connectionTimeoutMillis: 13000,
  idleTimeoutMillis: 44000,
};

test('worker defaults and overrides reach its database pool options', () => {
  const defaults = workerEnvSchema.parse({});
  assert.deepEqual(buildWorkerDatabaseOptions(defaults, databaseConfig), {
    connectionString: databaseConfig.connectionString,
    max: 2,
    connectionTimeoutMillis: 13000,
    idleTimeoutMillis: 44000,
  });

  const override = workerEnvSchema.parse({ WORKER_DATABASE_POOL_MAX: '8' });
  assert.equal(buildWorkerDatabaseOptions(override, databaseConfig).max, 8);
});
