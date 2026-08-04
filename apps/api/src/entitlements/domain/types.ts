export type AttributeValue = string | number | boolean | null;

export type PlanStatus = 'active' | 'retired';

export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: PlanStatus;
  readonly currentVersionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type PlanVersionStatus = 'draft' | 'active';

export interface PlanVersion {
  readonly id: string;
  readonly planId: string;
  readonly version: number;
  readonly label: string | null;
  readonly status: PlanVersionStatus;
  readonly effectiveFrom: Date | null;
  readonly createdAt: Date;
  readonly activatedAt: Date | null;
}

export type FeatureHardRestriction = 'none' | 'blocked';

export interface FeatureDefinition {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly hardRestriction: FeatureHardRestriction;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FeatureEntitlement {
  readonly planVersionId: string;
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly overridable: boolean;
  readonly quotaKey: string | null;
  readonly quotaLimit: number | null;
}

export interface TenantPlanAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly planVersionId: string;
  readonly status: 'active';
  readonly assignedByUserId: string | null;
  readonly assignedAt: Date;
}

export interface TenantFeatureOverride {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly updatedAt: Date;
}

export interface TenantEntitlementSnapshot {
  readonly tenantId: string;
  readonly planId: string | null;
  readonly planName: string | null;
  readonly planVersionId: string | null;
  readonly planVersionNumber: number | null;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly quotaLimits: Readonly<Record<string, number | null>>;
  readonly generatedAt: Date;
}

export interface EntitlementEvaluationContext {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly attributes?: Readonly<Record<string, AttributeValue>>;
}

export type EntitlementDecisionReason =
  | 'allowed'
  | 'denied_no_entitlement'
  | 'denied_hard_restricted'
  | 'denied_missing_tenant_context'
  | 'denied_cross_tenant';

export type EntitlementSource = 'plan' | 'override';

export interface EntitlementDecision {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly allowed: boolean;
  readonly reason: EntitlementDecisionReason;
  readonly source: EntitlementSource | null;
}

export type QuotaPeriod = 'monthly' | 'one_time';

export interface UsageQuota {
  readonly id: string;
  readonly tenantId: string;
  readonly quotaKey: string;
  readonly period: QuotaPeriod;
  readonly limit: number | null;
  readonly consumed: number;
  readonly reserved: number;
  readonly periodStart: Date;
  readonly periodEnd: Date | null;
  readonly updatedAt: Date;
}

export type UsageMeterKind = 'consumed' | 'reserved' | 'committed' | 'released';

export interface UsageMeter {
  readonly id: string;
  readonly tenantId: string;
  readonly quotaKey: string;
  readonly amount: number;
  readonly kind: UsageMeterKind;
  readonly operationId: string | null;
  readonly recordedAt: Date;
}

export interface QuotaAvailability {
  readonly quotaKey: string;
  readonly tenantId: string;
  readonly limit: number | null;
  readonly consumed: number;
  readonly reserved: number;
  readonly available: number | null;
}

export interface UsageReservation {
  readonly reservationId: string;
  readonly quotaKey: string;
  readonly tenantId: string;
  readonly amount: number;
}
