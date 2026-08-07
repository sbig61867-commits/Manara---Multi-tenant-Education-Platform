import type { Permission } from '../domain/types.js';
import type { PlatformPermissionDescriptor } from '../platform-permission-catalog.js';

export interface PermissionListOptions {
  limit: number;
  cursor: string | null;
  module?: string | null;
}

export interface PermissionRepository {
  findByKey(key: string): Promise<Permission | null>;
  findByKeys(keys: readonly string[]): Promise<Permission[]>;
  insertCatalogPermission(permission: Permission): Promise<boolean>;
  reconcileCatalogMetadata(descriptor: PlatformPermissionDescriptor, updatedAt: Date): Promise<boolean>;
  list(options: PermissionListOptions): Promise<Permission[]>;
}
