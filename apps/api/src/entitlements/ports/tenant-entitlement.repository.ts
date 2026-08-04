import type { TenantFeatureOverride, TenantPlanAssignment } from '../domain/types.js';

export interface TenantEntitlementRepository {
  createAssignment(assignment: TenantPlanAssignment): Promise<void>;
  findActiveAssignmentByTenant(tenantId: string): Promise<TenantPlanAssignment | null>;
  listAssignmentsByTenant(tenantId: string): Promise<TenantPlanAssignment[]>;

  upsertOverride(override: TenantFeatureOverride): Promise<void>;
  findOverride(tenantId: string, featureKey: string): Promise<TenantFeatureOverride | null>;
  listOverridesByTenant(tenantId: string): Promise<TenantFeatureOverride[]>;
  deleteOverride(tenantId: string, featureKey: string): Promise<void>;
}
