import type { TransactionalExecutor } from '@manara/database';
import { decodeCursor } from '../../tenant/pagination.js';
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

  async list(options: { limit: number; cursor: string | null; module?: string | null }): Promise<Permission[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const params: unknown[] = [];
    let sql = `SELECT ${PERMISSION_COLUMNS} FROM permissions`;
    const clauses: string[] = [];
    if (options.module !== undefined && options.module !== null && options.module !== '') {
      params.push(options.module);
      clauses.push(`module = $${params.length}`);
    }
    if (cursor !== null) {
      params.push(cursor.createdAt, cursor.id);
      clauses.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
    }
    if (clauses.length > 0) {
      sql += ` WHERE ${clauses.join(' AND ')}`;
    }
    params.push(options.limit);
    sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const result = await this.database.query<PermissionRow>(sql, params);
    return result.rows.map((row) => mapPermission(row) as Permission);
  }
}
