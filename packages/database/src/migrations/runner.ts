import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseLogger } from '../logging.js';
import type { TransactionalExecutor } from '../pool.js';

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
}

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: Date;
}

export interface MigrationRunnerOptions {
  migrationsDir: string;
  table?: string;
  logger?: DatabaseLogger;
}

const MIGRATION_FILENAME_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/;
const DEFAULT_MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATION_ADVISORY_LOCK_KEY = 452837;

export async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const sqlFiles = entries.filter((entry) => entry.endsWith('.sql'));
  const invalid = sqlFiles.filter((entry) => !MIGRATION_FILENAME_PATTERN.test(entry));
  if (invalid.length > 0) {
    throw new Error(`Invalid migration filenames, expected NNNN_name.sql: ${invalid.join(', ')}`);
  }
  const migrations = sqlFiles.map((filename) => {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    if (match === null) {
      throw new Error(`Could not parse migration filename: ${filename}`);
    }
    return { version: match[1] as string, name: match[2] as string, filename };
  });
  migrations.sort((a, b) => Number(a.version) - Number(b.version));
  for (let index = 1; index < migrations.length; index += 1) {
    const previous = migrations[index - 1] as MigrationFile;
    const current = migrations[index] as MigrationFile;
    if (Number(previous.version) === Number(current.version)) {
      throw new Error(`Duplicate migration version ${current.version}`);
    }
  }
  return migrations;
}

interface MigrationRow {
  version: string;
  name: string;
  applied_at: Date;
}

export class MigrationRunner {
  private readonly database: TransactionalExecutor;
  private readonly options: MigrationRunnerOptions;

  constructor(database: TransactionalExecutor, options: MigrationRunnerOptions) {
    this.database = database;
    this.options = options;
  }

  private get tableName(): string {
    return this.options.table ?? DEFAULT_MIGRATIONS_TABLE;
  }

  private get logger(): DatabaseLogger | undefined {
    return this.options.logger;
  }

  async appliedMigrations(): Promise<MigrationRecord[]> {
    await this.ensureLedgerTable();
    const result = await this.database.query<MigrationRow>(
      `SELECT version, name, applied_at FROM ${this.tableName} ORDER BY version`,
    );
    return result.rows.map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
  }

  async pendingMigrations(): Promise<MigrationFile[]> {
    const discovered = await discoverMigrations(this.options.migrationsDir);
    const applied = new Set((await this.appliedMigrations()).map((record) => record.version));
    return discovered.filter((migration) => !applied.has(migration.version));
  }

  async runMigrations(): Promise<MigrationFile[]> {
    const pending = await this.pendingMigrations();
    if (pending.length === 0) {
      return [];
    }
    await this.database.query(`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`);
    try {
      const toApply = await this.pendingMigrations();
      const applied: MigrationFile[] = [];
      for (const migration of toApply) {
        const sql = await readFile(join(this.options.migrationsDir, migration.filename), 'utf8');
        await this.database.withTransaction(async (tx) => {
          await tx.query(sql);
          await tx.query(`INSERT INTO ${this.tableName} (version, name) VALUES ($1, $2)`, [
            migration.version,
            migration.name,
          ]);
        });
        this.logger?.info({ event: 'migration.applied', version: migration.version, name: migration.name });
        applied.push(migration);
      }
      return applied;
    } finally {
      await this.database
        .query(`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`)
        .catch(() => undefined);
    }
  }

  private async ensureLedgerTable(): Promise<void> {
    await this.database.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (version text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
  }
}
