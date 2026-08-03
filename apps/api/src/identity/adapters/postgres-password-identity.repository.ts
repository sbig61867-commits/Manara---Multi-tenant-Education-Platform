import type { TransactionalExecutor } from '@manara/database';
import type { PasswordIdentity } from '../domain/types.js';
import type { PasswordIdentityRepository } from '../ports/identity.repository.js';

interface PasswordIdentityRow {
  id: string;
  user_id: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

const PASSWORD_IDENTITY_COLUMNS = 'id, user_id, password_hash, created_at, updated_at';

function mapPasswordIdentity(row: PasswordIdentityRow | undefined): PasswordIdentity | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresPasswordIdentityRepository implements PasswordIdentityRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(identity: PasswordIdentity): Promise<void> {
    await this.database.query(
      `INSERT INTO password_identities (id, user_id, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [identity.id, identity.userId, identity.passwordHash, identity.createdAt, identity.updatedAt],
    );
  }

  async findByUserId(userId: string): Promise<PasswordIdentity | null> {
    const result = await this.database.query<PasswordIdentityRow>(
      `SELECT ${PASSWORD_IDENTITY_COLUMNS} FROM password_identities WHERE user_id = $1`,
      [userId],
    );
    return mapPasswordIdentity(result.rows[0]);
  }

  async update(identity: PasswordIdentity): Promise<void> {
    await this.database.query(
      `UPDATE password_identities SET password_hash = $2, updated_at = $3 WHERE id = $1`,
      [identity.id, identity.passwordHash, identity.updatedAt],
    );
  }
}
