import type { PostgresDatabase } from '@manara/database';
import { PostgresPermissionRepository } from '../../../src/authorization/adapters/postgres-permission.repository.js';
import { PostgresAuthorizationTransactionRunner } from '../../../src/authorization/adapters/postgres-transaction-runner.js';
import { PermissionCatalogService } from '../../../src/authorization/application/permission-catalog.service.js';
import { PLATFORM_PERMISSION_CATALOG } from '../../../src/authorization/platform-permission-catalog.js';

export async function seedPlatformPermissionCatalog(
  database: PostgresDatabase,
): Promise<ReadonlyMap<string, string>> {
  const repository = new PostgresPermissionRepository(database);
  const service = new PermissionCatalogService(
    repository,
    new PostgresAuthorizationTransactionRunner(database),
  );
  await service.seedCatalog();
  const verification = await service.verifyCatalog();
  if (!verification.valid) {
    throw new Error(`Permission catalog fixture is incomplete: ${verification.present}/${verification.required}`);
  }

  const keys = PLATFORM_PERMISSION_CATALOG.map(({ key }) => key);
  const rows = await repository.findByKeys(keys);
  const permissionIds = new Map(rows.map(({ id, key }) => [key, id]));
  if (permissionIds.size !== PLATFORM_PERMISSION_CATALOG.length) {
    throw new Error(`Permission catalog fixture returned ${permissionIds.size}/${PLATFORM_PERMISSION_CATALOG.length} ids`);
  }
  return permissionIds;
}
