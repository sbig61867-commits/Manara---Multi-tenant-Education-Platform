import type { TransactionalExecutor } from '@manara/database';
import type { User } from '../domain/types.js';
import type { UserRepository } from '../ports/user.repository.js';

interface UserRow {
  id: string;
  email: string;
  created_at: Date;
  updated_at: Date;
}

const USER_COLUMNS = 'id, email, created_at, updated_at';

function mapUser(row: UserRow | undefined): User | null {
  if (row === undefined) {
    return null;
  }
  return { id: row.id, email: row.email, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(user: User): Promise<void> {
    await this.database.query(
      `INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
      [user.id, user.email, user.createdAt, user.updatedAt],
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.database.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [email],
    );
    return mapUser(result.rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.database.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return mapUser(result.rows[0]);
  }

  async update(user: User): Promise<void> {
    await this.database.query(`UPDATE users SET email = $2, updated_at = $3 WHERE id = $1`, [
      user.id,
      user.email,
      user.updatedAt,
    ]);
  }
}
