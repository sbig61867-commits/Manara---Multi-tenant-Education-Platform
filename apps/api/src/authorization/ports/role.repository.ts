import type { Role, RolePermissionGrant } from '../domain/types.js';

export interface PaginatedListOptions {
  limit: number;
  cursor: string | null;
}

export interface RoleRepository {
  create(role: Role): Promise<void>;
  findById(id: string): Promise<Role | null>;
  findByNameAndTenant(name: string, tenantId: string): Promise<Role | null>;
  listByIds(ids: readonly string[]): Promise<Role[]>;
  listByTenant(tenantId: string): Promise<Role[]>;
  listByTenantPage(tenantId: string, options: PaginatedListOptions): Promise<Role[]>;
  update(role: Role): Promise<void>;
  grantPermission(grant: RolePermissionGrant): Promise<void>;
  revokePermission(roleId: string, permissionId: string): Promise<void>;
  listGrantsByRoleIds(roleIds: readonly string[]): Promise<RolePermissionGrant[]>;
  listGrantsByRolePage(roleId: string, options: PaginatedListOptions): Promise<RolePermissionGrant[]>;
}
