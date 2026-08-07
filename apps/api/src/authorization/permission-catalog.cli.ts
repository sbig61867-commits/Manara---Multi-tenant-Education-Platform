import { loadDotenv } from '@manara/config';
import { PostgresDatabase, resolveDatabaseConfig } from '@manara/database';
import type { DatabaseOptions, TransactionalExecutor } from '@manara/database';
import { PostgresPermissionRepository } from './adapters/postgres-permission.repository.js';
import { PostgresAuthorizationTransactionRunner } from './adapters/postgres-transaction-runner.js';
import { PermissionCatalogService } from './application/permission-catalog.service.js';
import type { PermissionCatalogSeedResult } from './application/permission-catalog.service.js';

interface CatalogDatabase extends TransactionalExecutor {
  close(): Promise<void>;
}

interface CatalogExecutionResult extends PermissionCatalogSeedResult {
  readonly valid: boolean;
}

export interface PermissionCatalogCliOptions {
  env?: Record<string, string | undefined>;
  loadEnvironment?: () => void;
  createDatabase?: (options: DatabaseOptions) => CatalogDatabase;
  execute?: (database: CatalogDatabase) => Promise<CatalogExecutionResult>;
  writeOutput?: (message: string) => void;
  writeError?: (message: string) => void;
}

async function executeCatalog(database: CatalogDatabase): Promise<CatalogExecutionResult> {
  const service = new PermissionCatalogService(
    new PostgresPermissionRepository(database),
    new PostgresAuthorizationTransactionRunner(database),
  );
  const result = await service.seedCatalog();
  const verification = await service.verifyCatalog();
  return { ...result, valid: verification.valid };
}

export async function runPermissionCatalogCli(options: PermissionCatalogCliOptions = {}): Promise<number> {
  const writeOutput = options.writeOutput ?? ((message) => process.stdout.write(message));
  const writeError = options.writeError ?? ((message) => process.stderr.write(message));
  let database: CatalogDatabase | null = null;
  let result: CatalogExecutionResult | null = null;
  let failed = false;
  try {
    process.env.DOTENV_CONFIG_QUIET ??= 'true';
    (options.loadEnvironment ?? loadDotenv)();
    const config = resolveDatabaseConfig(options.env ?? process.env);
    if (config === null) throw new Error('Database configuration is required');

    const databaseOptions: DatabaseOptions = {
      connectionString: config.connectionString,
      max: 1,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      idleTimeoutMillis: config.idleTimeoutMillis,
    };
    database = (options.createDatabase ?? ((poolOptions) => new PostgresDatabase(poolOptions)))(databaseOptions);
    result = await (options.execute ?? executeCatalog)(database);
    if (!result.valid) throw new Error('Permission catalog verification failed after seeding');
  } catch {
    failed = true;
    writeError('Permission catalog seed failed.\n');
  } finally {
    if (database !== null) {
      try {
        await database.close();
      } catch {
        if (!failed) {
          failed = true;
          writeError('Permission catalog seed failed.\n');
        }
      }
    }
  }

  if (!failed && result !== null) {
    writeOutput(
      `Permission catalog seeded: required=${result.required} inserted=${result.inserted} reconciled=${result.reconciled} unchanged=${result.unchanged}\n`,
    );
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  void runPermissionCatalogCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
