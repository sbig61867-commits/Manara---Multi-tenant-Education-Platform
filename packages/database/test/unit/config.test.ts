import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseEnvSchema, isValidPostgresUrl, resolveDatabaseConfig } from '../../src/config.js';

test('isValidPostgresUrl accepts postgres and postgresql schemes', () => {
  assert.equal(isValidPostgresUrl('postgres://user:pass@localhost:5432/manara'), true);
  assert.equal(isValidPostgresUrl('postgresql://user:pass@localhost:5432/manara'), true);
});

test('isValidPostgresUrl rejects non-postgres schemes and malformed values', () => {
  assert.equal(isValidPostgresUrl('http://localhost:5432/manara'), false);
  assert.equal(isValidPostgresUrl('mysql://localhost/manara'), false);
  assert.equal(isValidPostgresUrl('postgres://'), false);
  assert.equal(isValidPostgresUrl('not a url'), false);
  assert.equal(isValidPostgresUrl(''), false);
});

test('databaseEnvSchema accepts a valid connection string', () => {
  const result = databaseEnvSchema.safeParse({ DATABASE_URL: 'postgres://user:pass@localhost:5432/manara' });
  assert.equal(result.success, true);
});

test('databaseEnvSchema rejects an invalid connection string', () => {
  const result = databaseEnvSchema.safeParse({ DATABASE_URL: 'mysql://localhost/manara' });
  assert.equal(result.success, false);
});

test('resolveDatabaseConfig returns null when DATABASE_URL is unset', () => {
  assert.equal(resolveDatabaseConfig({}), null);
  assert.equal(resolveDatabaseConfig({ DATABASE_URL: '' }), null);
});

test('resolveDatabaseConfig throws when DATABASE_URL is set but invalid', () => {
  assert.throws(() => resolveDatabaseConfig({ DATABASE_URL: 'mysql://localhost/manara' }), /Invalid database configuration/);
});

test('resolveDatabaseConfig parses connection details', () => {
  const config = resolveDatabaseConfig({
    DATABASE_URL: 'postgresql://alice:secret@db.example.com:5433/manara?sslmode=require',
  });
  assert.ok(config);
  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, 5433);
  assert.equal(config.database, 'manara');
  assert.equal(config.connectionString, 'postgresql://alice:secret@db.example.com:5433/manara?sslmode=require');
});

test('resolveDatabaseConfig defaults the port to 5432', () => {
  const config = resolveDatabaseConfig({ DATABASE_URL: 'postgres://user:pass@localhost/manara' });
  assert.ok(config);
  assert.equal(config.port, 5432);
});
