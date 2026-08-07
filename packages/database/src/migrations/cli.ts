import { resolve } from 'node:path';
import { loadDotenv } from '@manara/config';
import { resolveDatabaseConfig } from '../config.js';
import { PostgresDatabase } from '../pool.js';
import type { TransactionalExecutor } from '../pool.js';
import { discoverMigrations, MigrationRunner } from './runner.js';

interface MigrationDatabase extends TransactionalExecutor {
  close(): Promise<void>;
}

export interface MigrationSummary {
  discovered: number;
  applied: number;
  alreadyApplied: number;
  pending: number;
}

export interface MigrationCliOptions {
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  migrationsDir?: string;
  loadEnvironment?: () => void;
  createDatabase?: (connectionString: string) => MigrationDatabase;
  execute?: (
    database: MigrationDatabase,
    migrationsDir: string,
    shouldContinue: () => boolean,
  ) => Promise<MigrationSummary>;
  writeOutput?: (message: string) => void;
  writeError?: (message: string) => void;
}

export function resolveMigrationDirectory(moduleDirectory: string = __dirname): string {
  return resolve(moduleDirectory, 'sql');
}

async function executeMigrations(
  database: MigrationDatabase,
  migrationsDir: string,
  shouldContinue: () => boolean,
): Promise<MigrationSummary> {
  const discovered = await discoverMigrations(migrationsDir);
  const runner = new MigrationRunner(database, { migrationsDir, shouldContinue });
  const applied = await runner.runMigrations();
  if (!shouldContinue()) {
    throw new Error('Migration execution interrupted');
  }
  const records = await runner.appliedMigrations();
  const appliedVersions = new Set(records.map((record) => record.version));
  const pending = discovered.filter((migration) => !appliedVersions.has(migration.version)).length;
  if (pending !== 0) {
    throw new Error('Migrations remain pending after execution');
  }
  return {
    discovered: discovered.length,
    applied: applied.length,
    alreadyApplied: discovered.length - applied.length,
    pending,
  };
}

export async function runMigrationCli(options: MigrationCliOptions = {}): Promise<number> {
  const writeOutput = options.writeOutput ?? ((message) => process.stdout.write(message));
  const writeError = options.writeError ?? ((message) => process.stderr.write(message));
  let database: MigrationDatabase | null = null;
  let summary: MigrationSummary | null = null;
  let failed = false;
  try {
    process.env.DOTENV_CONFIG_QUIET ??= 'true';
    (options.loadEnvironment ?? loadDotenv)();
    const config = resolveDatabaseConfig(options.env ?? process.env);
    if (config === null) {
      throw new Error('Database configuration is required');
    }
    if (options.signal?.aborted === true) {
      throw new Error('Migration execution interrupted');
    }
    database = (options.createDatabase ?? ((connectionString) => new PostgresDatabase({ connectionString })))(
      config.connectionString,
    );
    summary = await (options.execute ?? executeMigrations)(
      database,
      options.migrationsDir ?? resolveMigrationDirectory(),
      () => options.signal?.aborted !== true,
    );
  } catch {
    failed = true;
    writeError('Database migration failed.\n');
  } finally {
    if (database !== null) {
      try {
        await database.close();
      } catch {
        if (!failed) {
          failed = true;
          writeError('Database migration failed.\n');
        }
      }
    }
  }
  if (!failed && summary !== null) {
    writeOutput(
      `Database migrations complete: discovered=${summary.discovered} applied=${summary.applied} alreadyApplied=${summary.alreadyApplied} pending=${summary.pending}\n`,
    );
  }
  return failed ? 1 : 0;
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    process.exitCode = await runMigrationCli({ signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (require.main === module) {
  void main();
}
