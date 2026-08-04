import type { TransactionalExecutor } from '@manara/database';
import type { RoleAssignment, RoleAssignmentScope } from '../domain/types.js';
import type { RoleAssignmentRepository } from '../ports/role-assignment.repository.js';

interface RoleAssignmentRow {
  id: string;
  tenant_id: string;
  role_id: string;
  user_id: string;
  scope_type: string;
  scope_unit_id: string | null;
  scope_program_id: string | null;
  scope_group_id: string | null;
  created_by_user_id: string | null;
  created_at: Date;
}

const ASSIGNMENT_COLUMNS =
  'id, tenant_id, role_id, user_id, scope_type, scope_unit_id, scope_program_id, scope_group_id, created_by_user_id, created_at';

function mapScope(row: RoleAssignmentRow): RoleAssignmentScope {
  switch (row.scope_type) {
    case 'unit':
      return { type: 'unit', unitId: row.scope_unit_id ?? '' };
    case 'program':
      return { type: 'program', programId: row.scope_program_id ?? '' };
    case 'group':
      return { type: 'group', groupId: row.scope_group_id ?? '' };
    default:
      return { type: 'tenant' };
  }
}

function mapAssignment(row: RoleAssignmentRow | undefined): RoleAssignment | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    userId: row.user_id,
    scope: mapScope(row),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

export class PostgresRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(assignment: RoleAssignment): Promise<void> {
    await this.database.query(
      `INSERT INTO role_assignments (${ASSIGNMENT_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        assignment.id,
        assignment.tenantId,
        assignment.roleId,
        assignment.userId,
        assignment.scope.type,
        assignment.scope.type === 'unit' ? assignment.scope.unitId : null,
        assignment.scope.type === 'program' ? assignment.scope.programId : null,
        assignment.scope.type === 'group' ? assignment.scope.groupId : null,
        assignment.createdByUserId,
        assignment.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<RoleAssignment | null> {
    const result = await this.database.query<RoleAssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE id = $1`,
      [id],
    );
    return mapAssignment(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.database.query('DELETE FROM role_assignments WHERE id = $1', [id]);
  }

  async listByUserAndTenant(userId: string, tenantId: string): Promise<RoleAssignment[]> {
    const result = await this.database.query<RoleAssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at`,
      [userId, tenantId],
    );
    return result.rows.map((row) => mapAssignment(row) as RoleAssignment);
  }
}
