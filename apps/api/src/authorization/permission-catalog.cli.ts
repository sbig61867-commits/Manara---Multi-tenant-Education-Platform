import { loadDotenv } from '@manara/config';
import { PostgresDatabase, resolveDatabaseConfig } from '@manara/database';
import { PostgresPermissionRepository } from './adapters/postgres-permission.repository.js';
import { PostgresAuthorizationTransactionRunner } from './adapters/postgres-transaction-runner.js';
import { PermissionCatalogService } from './application/permission-catalog.service.js';

async function seedPermissionCatalog(): Promise<void> {
  process.env.DOTENV_CONFIG_QUIET ??= 'true';
  loadDotenv();
  const config = resolveDatabaseConfig();
  if (config === null) {
    throw new Error('DATABASE_URL is required');
  }
  const database = new PostgresDatabase({ connectionString: config.connectionString });
  try {
    const service = new PermissionCatalogService(
      new PostgresPermissionRepository(database),
      new PostgresAuthorizationTransactionRunner(database),
    );
    const result = await service.seedCatalog();
    const verification = await service.verifyCatalog();
    if (!verification.valid) {
      throw new Error('Permission catalog verification failed after seeding');
    }
    process.stdout.write(
      `Permission catalog seeded: required=${result.required} inserted=${result.inserted} reconciled=${result.reconciled} unchanged=${result.unchanged}\n`,
    );
  } finally {
    await database.close();
  }
}

seedPermissionCatalog().catch(() => {
  process.stderr.write('Permission catalog seed failed.\n');
  process.exitCode = 1;
});
