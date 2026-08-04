import type { TransactionalExecutor } from '@manara/database';
import type { Institution } from '../domain/types.js';
import type { InstitutionRepository } from '../ports/institution.repository.js';

interface InstitutionRow {
  id: string;
  name: string;
  type: string;
  status: string;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

const INSTITUTION_COLUMNS = 'id, name, type, status, created_by_user_id, created_at, updated_at';

function mapInstitution(row: InstitutionRow | undefined): Institution | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type as Institution['type'],
    status: row.status as Institution['status'],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresInstitutionRepository implements InstitutionRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(institution: Institution): Promise<void> {
    await this.database.query(
      `INSERT INTO institutions (${INSTITUTION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        institution.id,
        institution.name,
        institution.type,
        institution.status,
        institution.createdByUserId,
        institution.createdAt,
        institution.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<Institution | null> {
    const result = await this.database.query<InstitutionRow>(
      `SELECT ${INSTITUTION_COLUMNS} FROM institutions WHERE id = $1`,
      [id],
    );
    return mapInstitution(result.rows[0]);
  }

  async update(institution: Institution): Promise<void> {
    await this.database.query(
      `UPDATE institutions SET name = $2, type = $3, status = $4, updated_at = $5 WHERE id = $1`,
      [institution.id, institution.name, institution.type, institution.status, institution.updatedAt],
    );
  }
}
