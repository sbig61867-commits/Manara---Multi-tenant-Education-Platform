import type { TransactionalExecutor } from '@manara/database';
import { decodeCursor } from '../../tenant/pagination.js';
import type { Permission } from '../domain/types.js';
import type { PermissionRepository } from '../ports/permission.repository.js';
import type { PlatformPermissionDescriptor } from '../platform-permission-catalog.js';

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

  async findByKeys(keys: readonly string[]): Promise<Permission[]> {
    if (keys.length === 0) {
      return [];
    }
    const result = await this.database.query<PermissionRow>(
      `SELECT ${PERMISSION_COLUMNS} FROM permissions WHERE key = ANY($1::text[]) ORDER BY key`,
      [[...keys]],
    );
    return result.rows.map((row) => mapPermission(row) as Permission);
  }

  async insertCatalogPermission(permission: Permission): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO permissions (id, key, module, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO NOTHING`,
      [
        permission.id,
        permission.key,
        permission.module,
        permission.description,
        permission.status,
        permission.createdAt,
        permission.updatedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async reconcileCatalogMetadata(descriptor: PlatformPermissionDescriptor, updatedAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE permissions
       SET module = $2, description = $3, updated_at = $4
       WHERE key = $1
         AND (module IS DISTINCT FROM $2 OR description IS DISTINCT FROM $3)`,
      [descriptor.key, descriptor.module, descriptor.description, updatedAt],
    );
    return result.rowCount === 1;
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
