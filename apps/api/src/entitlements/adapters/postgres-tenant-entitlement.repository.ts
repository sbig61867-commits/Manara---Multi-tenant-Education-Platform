import type { TransactionalExecutor } from '@manara/database';
import type { TenantFeatureOverride, TenantPlanAssignment } from '../domain/types.js';
import type { TenantEntitlementRepository } from '../ports/tenant-entitlement.repository.js';

interface TenantPlanAssignmentRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_version_id: string;
  status: string;
  assigned_by_user_id: string | null;
  assigned_at: Date;
}

interface TenantFeatureOverrideRow {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_at: Date;
}

const ASSIGNMENT_COLUMNS =
  'id, tenant_id, plan_id, plan_version_id, status, assigned_by_user_id, assigned_at';

function mapAssignment(row: TenantPlanAssignmentRow | undefined): TenantPlanAssignment | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    planVersionId: row.plan_version_id,
    status: row.status as TenantPlanAssignment['status'],
    assignedByUserId: row.assigned_by_user_id,
    assignedAt: row.assigned_at,
  };
}

function mapOverride(row: TenantFeatureOverrideRow): TenantFeatureOverride {
  return {
    tenantId: row.tenant_id,
    featureKey: row.feature_key,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

export class PostgresTenantEntitlementRepository implements TenantEntitlementRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async createAssignment(assignment: TenantPlanAssignment): Promise<void> {
    await this.database.query(
      `INSERT INTO tenant_plan_assignments (${ASSIGNMENT_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        assignment.id,
        assignment.tenantId,
        assignment.planId,
        assignment.planVersionId,
        assignment.status,
        assignment.assignedByUserId,
        assignment.assignedAt,
      ],
    );
  }

  async findActiveAssignmentByTenant(tenantId: string): Promise<TenantPlanAssignment | null> {
    const result = await this.database.query<TenantPlanAssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM tenant_plan_assignments
       WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    return mapAssignment(result.rows[0]);
  }

  async listAssignmentsByTenant(tenantId: string): Promise<TenantPlanAssignment[]> {
    const result = await this.database.query<TenantPlanAssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM tenant_plan_assignments
       WHERE tenant_id = $1 ORDER BY assigned_at`,
      [tenantId],
    );
    return result.rows.map((row) => mapAssignment(row) as TenantPlanAssignment);
  }

  async upsertOverride(override: TenantFeatureOverride): Promise<void> {
    await this.database.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, feature_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, feature_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [override.tenantId, override.featureKey, override.enabled, override.updatedAt],
    );
  }

  async findOverride(tenantId: string, featureKey: string): Promise<TenantFeatureOverride | null> {
    const result = await this.database.query<TenantFeatureOverrideRow>(
      `SELECT tenant_id, feature_key, enabled, updated_at FROM tenant_feature_overrides
       WHERE tenant_id = $1 AND feature_key = $2`,
      [tenantId, featureKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOverride(row);
  }

  async listOverridesByTenant(tenantId: string): Promise<TenantFeatureOverride[]> {
    const result = await this.database.query<TenantFeatureOverrideRow>(
      `SELECT tenant_id, feature_key, enabled, updated_at FROM tenant_feature_overrides
       WHERE tenant_id = $1 ORDER BY feature_key`,
      [tenantId],
    );
    return result.rows.map(mapOverride);
  }

  async deleteOverride(tenantId: string, featureKey: string): Promise<void> {
    await this.database.query(
      'DELETE FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_key = $2',
      [tenantId, featureKey],
    );
  }
}
