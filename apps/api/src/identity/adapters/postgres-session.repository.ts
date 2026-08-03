import type { TransactionalExecutor } from '@manara/database';
import type { AuthSession } from '../domain/types.js';
import type { SessionRepository } from '../ports/session.repository.js';

interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_active_at: Date;
  revoked_at: Date | null;
}

const AUTH_SESSION_COLUMNS = 'id, user_id, token_hash, created_at, expires_at, last_active_at, revoked_at';

function mapAuthSession(row: AuthSessionRow | undefined): AuthSession | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.last_active_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(session: AuthSession): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_active_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        session.idleExpiresAt,
        session.revokedAt,
      ],
    );
  }

  async findById(id: string): Promise<AuthSession | null> {
    const result = await this.database.query<AuthSessionRow>(
      `SELECT ${AUTH_SESSION_COLUMNS} FROM auth_sessions WHERE id = $1`,
      [id],
    );
    return mapAuthSession(result.rows[0]);
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const result = await this.database.query<AuthSessionRow>(
      `SELECT ${AUTH_SESSION_COLUMNS} FROM auth_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    return mapAuthSession(result.rows[0]);
  }

  async update(session: AuthSession): Promise<void> {
    await this.database.query(
      `UPDATE auth_sessions
       SET token_hash = $2, expires_at = $3, last_active_at = $4, revoked_at = $5
       WHERE id = $1`,
      [session.id, session.tokenHash, session.expiresAt, session.idleExpiresAt, session.revokedAt],
    );
  }

  async revokeById(id: string): Promise<void> {
    await this.database.query(`DELETE FROM auth_sessions WHERE id = $1`, [id]);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.database.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
    return result.rowCount ?? 0;
  }
}
