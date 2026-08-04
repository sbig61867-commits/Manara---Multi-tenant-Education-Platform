import type { TransactionalExecutor } from '@manara/database';
import type { Invitation } from '../domain/types.js';
import type { InvitationRepository } from '../ports/invitation.repository.js';

interface InvitationRow {
  id: string;
  tenant_id: string;
  token_hash: string;
  status: string;
  expires_at: Date;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

const INVITATION_COLUMNS =
  'id, tenant_id, token_hash, status, expires_at, accepted_by_user_id, accepted_at, revoked_at, created_at';

function mapInvitation(row: InvitationRow | undefined): Invitation | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    institutionId: row.tenant_id,
    tokenHash: row.token_hash,
    status: row.status as Invitation['status'],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresInvitationRepository implements InvitationRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(invitation: Invitation): Promise<void> {
    await this.database.query(
      `INSERT INTO invitations (${INVITATION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        invitation.id,
        invitation.institutionId,
        invitation.tokenHash,
        invitation.status,
        invitation.expiresAt,
        invitation.acceptedByUserId,
        invitation.acceptedAt,
        invitation.revokedAt,
        invitation.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<Invitation | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations WHERE id = $1`,
      [id],
    );
    return mapInvitation(result.rows[0]);
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const result = await this.database.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    return mapInvitation(result.rows[0]);
  }

  async update(invitation: Invitation): Promise<void> {
    await this.database.query(
      `UPDATE invitations
       SET status = $3, accepted_by_user_id = $4, accepted_at = $5, revoked_at = $6
       WHERE id = $1 AND tenant_id = $2`,
      [
        invitation.id,
        invitation.institutionId,
        invitation.status,
        invitation.acceptedByUserId,
        invitation.acceptedAt,
        invitation.revokedAt,
      ],
    );
  }
}
