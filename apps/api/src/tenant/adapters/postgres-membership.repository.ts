import type { TransactionalExecutor } from '@manara/database';
import type { Membership } from '../domain/types.js';
import type { MembershipRepository } from '../ports/membership.repository.js';

interface MembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const MEMBERSHIP_COLUMNS = 'id, tenant_id, user_id, status, started_at, ended_at, created_at, updated_at';

function mapMembership(row: MembershipRow | undefined): Membership | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    institutionId: row.tenant_id,
    userId: row.user_id,
    status: row.status as Membership['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class PostgresMembershipRepository implements MembershipRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(membership: Membership): Promise<void> {
    await this.database.query(
      `INSERT INTO memberships (${MEMBERSHIP_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        membership.id,
        membership.institutionId,
        membership.userId,
        membership.status,
        membership.startedAt,
        membership.endedAt,
        membership.createdAt,
        membership.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<Membership | null> {
    const result = await this.database.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE id = $1`,
      [id],
    );
    return mapMembership(result.rows[0]);
  }

  async findByUserAndInstitution(userId: string, institutionId: string): Promise<Membership | null> {
    const result = await this.database.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships WHERE tenant_id = $2 AND user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId, institutionId],
    );
    return mapMembership(result.rows[0]);
  }

  async update(membership: Membership): Promise<void> {
    await this.database.query(
      `UPDATE memberships
       SET status = $3, started_at = $4, ended_at = $5, updated_at = $6
       WHERE id = $1 AND tenant_id = $2`,
      [
        membership.id,
        membership.institutionId,
        membership.status,
        membership.startedAt,
        membership.endedAt,
        membership.updatedAt,
      ],
    );
  }
}
