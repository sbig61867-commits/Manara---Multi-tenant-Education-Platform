import type { ApiEnv } from '@manara/config';
import { PLATFORM_PERMISSION_CATALOG } from '../platform-permission-catalog.js';
import type { PermissionCatalogVerification } from './permission-catalog.service.js';

const VERIFIED_STARTUP_ENVIRONMENTS: ReadonlySet<ApiEnv['NODE_ENV']> = new Set(['staging', 'production']);

export class PermissionCatalogStartupError extends Error {
  override readonly name = 'authorization.permission_catalog_incomplete';
  readonly code = 'authorization.permission_catalog_incomplete';
  readonly required: number;
  readonly present: number;
  readonly missingKeys: readonly string[];

  constructor(verification: Pick<PermissionCatalogVerification, 'required' | 'present' | 'missingKeys'>) {
    const missingKeys = [...verification.missingKeys].sort();
    super(`Required permission catalog is incomplete: ${verification.present}/${verification.required} present`);
    this.required = verification.required;
    this.present = verification.present;
    this.missingKeys = Object.freeze(missingKeys);
  }
}

export async function verifyPermissionCatalogAtStartup(
  nodeEnv: ApiEnv['NODE_ENV'],
  verify: (() => Promise<PermissionCatalogVerification>) | null,
): Promise<void> {
  if (!VERIFIED_STARTUP_ENVIRONMENTS.has(nodeEnv)) {
    return;
  }
  if (verify === null) {
    throw new PermissionCatalogStartupError({
      required: PLATFORM_PERMISSION_CATALOG.length,
      present: 0,
      missingKeys: PLATFORM_PERMISSION_CATALOG.map((descriptor) => descriptor.key),
    });
  }
  const result = await verify();
  if (!result.valid) {
    throw new PermissionCatalogStartupError(result);
  }
}
