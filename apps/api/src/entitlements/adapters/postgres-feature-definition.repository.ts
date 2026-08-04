import type { TransactionalExecutor } from '@manara/database';
import type { FeatureDefinition } from '../domain/types.js';
import type { FeatureDefinitionRepository } from '../ports/feature-definition.repository.js';

interface FeatureDefinitionRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  hard_restriction: string;
  created_at: Date;
  updated_at: Date;
}

const FEATURE_DEFINITION_COLUMNS =
  'id, key, name, description, category, hard_restriction, created_at, updated_at';

function mapFeatureDefinition(row: FeatureDefinitionRow | undefined): FeatureDefinition | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    hardRestriction: row.hard_restriction as FeatureDefinition['hardRestriction'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresFeatureDefinitionRepository implements FeatureDefinitionRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(definition: FeatureDefinition): Promise<void> {
    await this.database.query(
      `INSERT INTO feature_definitions (${FEATURE_DEFINITION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        definition.id,
        definition.key,
        definition.name,
        definition.description,
        definition.category,
        definition.hardRestriction,
        definition.createdAt,
        definition.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<FeatureDefinition | null> {
    const result = await this.database.query<FeatureDefinitionRow>(
      `SELECT ${FEATURE_DEFINITION_COLUMNS} FROM feature_definitions WHERE id = $1`,
      [id],
    );
    return mapFeatureDefinition(result.rows[0]);
  }

  async findByKey(key: string): Promise<FeatureDefinition | null> {
    const result = await this.database.query<FeatureDefinitionRow>(
      `SELECT ${FEATURE_DEFINITION_COLUMNS} FROM feature_definitions WHERE key = $1`,
      [key],
    );
    return mapFeatureDefinition(result.rows[0]);
  }

  async list(): Promise<FeatureDefinition[]> {
    const result = await this.database.query<FeatureDefinitionRow>(
      `SELECT ${FEATURE_DEFINITION_COLUMNS} FROM feature_definitions ORDER BY key`,
    );
    return result.rows.map((row) => mapFeatureDefinition(row) as FeatureDefinition);
  }
}
