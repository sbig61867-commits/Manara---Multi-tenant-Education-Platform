import type { FeatureEntitlement, Plan, PlanVersion } from '../domain/types.js';

export interface PlanRepository {
  create(plan: Plan): Promise<void>;
  update(plan: Plan): Promise<void>;
  findById(id: string): Promise<Plan | null>;
  findByName(name: string): Promise<Plan | null>;
  list(): Promise<Plan[]>;

  createVersion(version: PlanVersion): Promise<void>;
  updateVersion(version: PlanVersion): Promise<void>;
  findVersionById(id: string): Promise<PlanVersion | null>;
  listVersionsByPlanId(planId: string): Promise<PlanVersion[]>;

  saveFeatureEntitlements(planVersionId: string, entitlements: FeatureEntitlement[]): Promise<void>;
  listFeatureEntitlementsByVersion(planVersionId: string): Promise<FeatureEntitlement[]>;
}
