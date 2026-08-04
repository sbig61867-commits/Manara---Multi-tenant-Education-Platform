import type { TransactionalExecutor } from '@manara/database';
import type { Permission } from '../domain/types.js';
import type { PermissionRepository } from '../ports/permission.repository.js';

interface PermissionRow {
  id: string;
  key: string;
  module: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const PERMISSION_COLUMNS = 'id, key, module, description, status, created_at, updated_at';

function mapPermission(row: PermissionRow | undefined): Permission | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    key: row.key,
    module: row.module,
    description: row.description,
    status: row.status as Permission['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresPermissionRepository implements PermissionRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async findByKey(key: string): Promise<Permission | null> {
    const result = await this.database.query<PermissionRow>(
      `SELECT ${PERMISSION_COLUMNS} FROM permissions WHERE key = $1`,
      [key],
    );
    return mapPermission(result.rows[0]);
  }
}
