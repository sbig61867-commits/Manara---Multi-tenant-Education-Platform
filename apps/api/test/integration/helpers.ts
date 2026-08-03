import 'reflect-metadata';
import { resolve } from 'node:path';
import { PostgresDatabase, type DatabaseLogger } from '@manara/database';

export function getTestDatabaseUrl(): string | null {
  const raw = process.env.DATABASE_URL;
  return raw === undefined || raw.trim() === '' ? null : raw;
}

export function createTestDatabase(logger?: DatabaseLogger): PostgresDatabase {
  const url = getTestDatabaseUrl();
  if (url === null) {
    throw new Error('DATABASE_URL is required for integration tests');
  }
  return new PostgresDatabase({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    logger,
  });
}

export const MIGRATIONS_DIR = resolve(process.cwd(), '../../packages/database/src/migrations/sql');

export class CollectingLogger implements DatabaseLogger {
  readonly events: Array<{ level: 'info' | 'warn' | 'error'; event: Record<string, unknown> }> = [];

  info(event: Record<string, unknown>): void {
    this.events.push({ level: 'info', event: { ...event } });
  }

  warn(event: Record<string, unknown>): void {
    this.events.push({ level: 'warn', event: { ...event } });
  }

  error(event: Record<string, unknown>): void {
    this.events.push({ level: 'error', event: { ...event } });
  }
}
