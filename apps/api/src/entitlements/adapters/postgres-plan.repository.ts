import type { TransactionalExecutor } from '@manara/database';
import type { FeatureEntitlement, Plan, PlanVersion } from '../domain/types.js';
import type { PlanRepository } from '../ports/plan.repository.js';

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PlanVersionRow {
  id: string;
  plan_id: string;
  version: number;
  label: string | null;
  status: string;
  effective_from: Date | null;
  created_at: Date;
  activated_at: Date | null;
}

interface FeatureEntitlementRow {
  plan_version_id: string;
  feature_key: string;
  enabled: boolean;
  overridable: boolean;
  quota_key: string | null;
  quota_limit: number | null;
}

const PLAN_COLUMNS =
  'id, name, description, status, current_version_id, created_at, updated_at';

const PLAN_VERSION_COLUMNS =
  'id, plan_id, version, label, status, effective_from, created_at, activated_at';

function mapPlan(row: PlanRow | undefined): Plan | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as Plan['status'],
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlanVersion(row: PlanVersionRow | undefined): PlanVersion | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    planId: row.plan_id,
    version: row.version,
    label: row.label,
    status: row.status as PlanVersion['status'],
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

function mapEntitlement(row: FeatureEntitlementRow): FeatureEntitlement {
  return {
    planVersionId: row.plan_version_id,
    featureKey: row.feature_key,
    enabled: row.enabled,
    overridable: row.overridable,
    quotaKey: row.quota_key,
    quotaLimit: row.quota_limit === null ? null : Number(row.quota_limit),
  };
}

export class PostgresPlanRepository implements PlanRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(plan: Plan): Promise<void> {
    await this.database.query(
      `INSERT INTO plans (${PLAN_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        plan.id,
        plan.name,
        plan.description,
        plan.status,
        plan.currentVersionId,
        plan.createdAt,
        plan.updatedAt,
      ],
    );
  }

  async update(plan: Plan): Promise<void> {
    await this.database.query(
      `UPDATE plans
       SET name = $2, description = $3, status = $4, current_version_id = $5, updated_at = $6
       WHERE id = $1`,
      [
        plan.id,
        plan.name,
        plan.description,
        plan.status,
        plan.currentVersionId,
        plan.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<Plan | null> {
    const result = await this.database.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`,
      [id],
    );
    return mapPlan(result.rows[0]);
  }

  async findByName(name: string): Promise<Plan | null> {
    const result = await this.database.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans WHERE name = $1`,
      [name],
    );
    return mapPlan(result.rows[0]);
  }

  async list(): Promise<Plan[]> {
    const result = await this.database.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans ORDER BY name`,
    );
    return result.rows.map((row) => mapPlan(row) as Plan);
  }

  async createVersion(version: PlanVersion): Promise<void> {
    await this.database.query(
      `INSERT INTO plan_versions (${PLAN_VERSION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        version.id,
        version.planId,
        version.version,
        version.label,
        version.status,
        version.effectiveFrom,
        version.createdAt,
        version.activatedAt,
      ],
    );
  }

  async updateVersion(version: PlanVersion): Promise<void> {
    await this.database.query(
      `UPDATE plan_versions
       SET label = $3, status = $4, effective_from = $5, activated_at = $6
       WHERE id = $1 AND plan_id = $2`,
      [
        version.id,
        version.planId,
        version.label,
        version.status,
        version.effectiveFrom,
        version.activatedAt,
      ],
    );
  }

  async findVersionById(id: string): Promise<PlanVersion | null> {
    const result = await this.database.query<PlanVersionRow>(
      `SELECT ${PLAN_VERSION_COLUMNS} FROM plan_versions WHERE id = $1`,
      [id],
    );
    return mapPlanVersion(result.rows[0]);
  }

  async listVersionsByPlanId(planId: string): Promise<PlanVersion[]> {
    const result = await this.database.query<PlanVersionRow>(
      `SELECT ${PLAN_VERSION_COLUMNS} FROM plan_versions WHERE plan_id = $1 ORDER BY version`,
      [planId],
    );
    return result.rows.map((row) => mapPlanVersion(row) as PlanVersion);
  }

  async saveFeatureEntitlements(
    planVersionId: string,
    entitlements: FeatureEntitlement[],
  ): Promise<void> {
    await this.database.query('DELETE FROM feature_entitlements WHERE plan_version_id = $1', [
      planVersionId,
    ]);
    if (entitlements.length === 0) {
      return;
    }
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (const entitlement of entitlements) {
      const base = placeholders.length * 6;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
      );
      values.push(
        planVersionId,
        entitlement.featureKey,
        entitlement.enabled,
        entitlement.overridable,
        entitlement.quotaKey,
        entitlement.quotaLimit,
      );
    }
    await this.database.query(
      `INSERT INTO feature_entitlements (plan_version_id, feature_key, enabled, overridable, quota_key, quota_limit)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  async listFeatureEntitlementsByVersion(planVersionId: string): Promise<FeatureEntitlement[]> {
    const result = await this.database.query<FeatureEntitlementRow>(
      `SELECT plan_version_id, feature_key, enabled, overridable, quota_key, quota_limit
       FROM feature_entitlements WHERE plan_version_id = $1 ORDER BY feature_key`,
      [planVersionId],
    );
    return result.rows.map(mapEntitlement);
  }
}
