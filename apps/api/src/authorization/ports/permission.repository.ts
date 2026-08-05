import type { Permission } from '../domain/types.js';

export interface PermissionListOptions {
  limit: number;
  cursor: string | null;
  module?: string | null;
}

export interface PermissionRepository {
  findByKey(key: string): Promise<Permission | null>;
  list(options: PermissionListOptions): Promise<Permission[]>;
}
