import type { TransactionalExecutor } from '@manara/database';
import type { Role, RolePermissionGrant } from '../domain/types.js';
import type { RoleRepository } from '../ports/role.repository.js';

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface RolePermissionGrantRow {
  role_id: string;
  permission_id: string;
  permission_key: string;
  granted_at: Date;
}

const ROLE_COLUMNS = 'id, tenant_id, name, description, status, created_at, updated_at';

function mapRole(row: RoleRow | undefined): Role | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    status: row.status as Role['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGrant(row: RolePermissionGrantRow | undefined): RolePermissionGrant | null {
  if (row === undefined) {
    return null;
  }
  return {
    roleId: row.role_id,
    permissionId: row.permission_id,
    permissionKey: row.permission_key,
    grantedAt: row.granted_at,
  };
}

export class PostgresRoleRepository implements RoleRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(role: Role): Promise<void> {
    await this.database.query(
      `INSERT INTO roles (${ROLE_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [role.id, role.tenantId, role.name, role.description, role.status, role.createdAt, role.updatedAt],
    );
  }

  async findById(id: string): Promise<Role | null> {
    const result = await this.database.query<RoleRow>(
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE id = $1`,
      [id],
    );
    return mapRole(result.rows[0]);
  }

  async findByNameAndTenant(name: string, tenantId: string): Promise<Role | null> {
    const result = await this.database.query<RoleRow>(
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE name = $1 AND tenant_id = $2`,
      [name, tenantId],
    );
    return mapRole(result.rows[0]);
  }

  async listByIds(ids: readonly string[]): Promise<Role[]> {
    const result = await this.database.query<RoleRow>(
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE id = ANY($1::uuid[])`,
      [[...ids]],
    );
    return result.rows.map((row) => mapRole(row) as Role);
  }

  async listByTenant(tenantId: string): Promise<Role[]> {
    const result = await this.database.query<RoleRow>(
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    return result.rows.map((row) => mapRole(row) as Role);
  }

  async update(role: Role): Promise<void> {
    await this.database.query(
      `UPDATE roles
       SET name = $3, description = $4, status = $5, updated_at = $6
       WHERE id = $1 AND tenant_id = $2`,
      [role.id, role.tenantId, role.name, role.description, role.status, role.updatedAt],
    );
  }

  async grantPermission(grant: RolePermissionGrant): Promise<void> {
    const result = await this.database.query(
      `INSERT INTO role_permissions (role_id, permission_id, tenant_id, granted_at)
       SELECT $1, $2, tenant_id, $3 FROM roles WHERE id = $1`,
      [grant.roleId, grant.permissionId, grant.grantedAt],
    );
    if (result.rowCount === 0) {
      throw new Error('cannot grant a permission to a role that does not exist');
    }
  }

  async revokePermission(roleId: string, permissionId: string): Promise<void> {
    await this.database.query(
      'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
      [roleId, permissionId],
    );
  }

  async listGrantsByRoleIds(roleIds: readonly string[]): Promise<RolePermissionGrant[]> {
    const result = await this.database.query<RolePermissionGrantRow>(
      `SELECT rp.role_id, rp.permission_id, p.key AS permission_key, rp.granted_at
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ANY($1::uuid[])
       ORDER BY rp.role_id, p.key`,
      [[...roleIds]],
    );
    return result.rows.map((row) => mapGrant(row) as RolePermissionGrant);
  }
}
