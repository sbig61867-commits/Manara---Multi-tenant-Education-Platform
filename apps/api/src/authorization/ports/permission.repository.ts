import type { Permission } from '../domain/types.js';

export interface PermissionRepository {
  findByKey(key: string): Promise<Permission | null>;
}
