import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EntitlementEvent, EntitlementEventPublisher } from '../../src/entitlements/domain/events.js';
import type {
  FeatureDefinition,
  FeatureEntitlement,
  Plan,
  PlanVersion,
  TenantFeatureOverride,
  TenantPlanAssignment,
  UsageMeter,
  UsageQuota,
} from '../../src/entitlements/domain/types.js';
import type { EntitlementsContextResolver } from '../../src/entitlements/ports/entitlements-context.js';
import type { FeatureDefinitionRepository } from '../../src/entitlements/ports/feature-definition.repository.js';
import type { PlanRepository } from '../../src/entitlements/ports/plan.repository.js';
import type { TenantEntitlementRepository } from '../../src/entitlements/ports/tenant-entitlement.repository.js';
import type { EntitlementsTransactionRunner } from '../../src/entitlements/ports/transaction-runner.js';
import type { UsageMeterRepository } from '../../src/entitlements/ports/usage-meter.repository.js';
import type { UsageQuotaRepository } from '../../src/entitlements/ports/usage-quota.repository.js';

export class FakePlanRepository implements PlanRepository {
  readonly plans = new Map<string, Plan>();
  readonly versions = new Map<string, PlanVersion>();
  readonly entitlements = new Map<string, FeatureEntitlement>();

  async create(plan: Plan): Promise<void> {
    this.plans.set(plan.id, plan);
  }

  async update(plan: Plan): Promise<void> {
    this.plans.set(plan.id, plan);
  }

  async findById(id: string): Promise<Plan | null> {
    return this.plans.get(id) ?? null;
  }

  async findByName(name: string): Promise<Plan | null> {
    for (const plan of this.plans.values()) {
      if (plan.name === name) {
        return plan;
      }
    }
    return null;
  }

  async list(): Promise<Plan[]> {
    return [...this.plans.values()];
  }

  async createVersion(version: PlanVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  async updateVersion(version: PlanVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  async findVersionById(id: string): Promise<PlanVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listVersionsByPlanId(planId: string): Promise<PlanVersion[]> {
    return [...this.versions.values()].filter((version) => version.planId === planId);
  }

  async saveFeatureEntitlements(planVersionId: string, entitlements: FeatureEntitlement[]): Promise<void> {
    for (const key of [...this.entitlements.keys()]) {
      if (this.entitlements.get(key)?.planVersionId === planVersionId) {
        this.entitlements.delete(key);
      }
    }
    for (const entitlement of entitlements) {
      this.entitlements.set(`${planVersionId}:${entitlement.featureKey}`, entitlement);
    }
  }

  async listFeatureEntitlementsByVersion(planVersionId: string): Promise<FeatureEntitlement[]> {
    return [...this.entitlements.values()].filter(
      (entitlement) => entitlement.planVersionId === planVersionId,
    );
  }
}

export class FakeFeatureDefinitionRepository implements FeatureDefinitionRepository {
  readonly definitions = new Map<string, FeatureDefinition>();

  async create(definition: FeatureDefinition): Promise<void> {
    this.definitions.set(definition.key, definition);
  }

  async findById(id: string): Promise<FeatureDefinition | null> {
    for (const definition of this.definitions.values()) {
      if (definition.id === id) {
        return definition;
      }
    }
    return null;
  }

  async findByKey(key: string): Promise<FeatureDefinition | null> {
    return this.definitions.get(key) ?? null;
  }

  async list(): Promise<FeatureDefinition[]> {
    return [...this.definitions.values()];
  }
}

export class FakeTenantEntitlementRepository implements TenantEntitlementRepository {
  readonly assignments = new Map<string, TenantPlanAssignment>();
  readonly overrides = new Map<string, TenantFeatureOverride>();

  async createAssignment(assignment: TenantPlanAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }

  async findActiveAssignmentByTenant(tenantId: string): Promise<TenantPlanAssignment | null> {
    for (const assignment of this.assignments.values()) {
      if (assignment.tenantId === tenantId && assignment.status === 'active') {
        return assignment;
      }
    }
    return null;
  }

  async listAssignmentsByTenant(tenantId: string): Promise<TenantPlanAssignment[]> {
    return [...this.assignments.values()].filter((assignment) => assignment.tenantId === tenantId);
  }

  async upsertOverride(override: TenantFeatureOverride): Promise<void> {
    this.overrides.set(`${override.tenantId}:${override.featureKey}`, override);
  }

  async findOverride(tenantId: string, featureKey: string): Promise<TenantFeatureOverride | null> {
    return this.overrides.get(`${tenantId}:${featureKey}`) ?? null;
  }

  async listOverridesByTenant(tenantId: string): Promise<TenantFeatureOverride[]> {
    return [...this.overrides.values()].filter((override) => override.tenantId === tenantId);
  }

  async deleteOverride(tenantId: string, featureKey: string): Promise<void> {
    this.overrides.delete(`${tenantId}:${featureKey}`);
  }
}

export class FakeUsageQuotaRepository implements UsageQuotaRepository {
  readonly quotas = new Map<string, UsageQuota>();

  async findByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageQuota | null> {
    return this.quotas.get(`${tenantId}:${quotaKey}`) ?? null;
  }

  async create(quota: UsageQuota): Promise<void> {
    this.quotas.set(`${quota.tenantId}:${quota.quotaKey}`, quota);
  }

  async update(quota: UsageQuota): Promise<void> {
    this.quotas.set(`${quota.tenantId}:${quota.quotaKey}`, quota);
  }

  async listByTenant(tenantId: string): Promise<UsageQuota[]> {
    return [...this.quotas.values()].filter((quota) => quota.tenantId === tenantId);
  }
}

export class FakeUsageMeterRepository implements UsageMeterRepository {
  readonly meters = new Map<string, UsageMeter>();

  async record(meter: UsageMeter): Promise<void> {
    this.meters.set(meter.id, meter);
  }

  async findById(id: string): Promise<UsageMeter | null> {
    return this.meters.get(id) ?? null;
  }

  async update(meter: UsageMeter): Promise<void> {
    this.meters.set(meter.id, meter);
  }

  async listByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageMeter[]> {
    return [...this.meters.values()].filter(
      (meter) => meter.tenantId === tenantId && meter.quotaKey === quotaKey,
    );
  }
}

export class ImmediateEntitlementsTransactionRunner implements EntitlementsTransactionRunner {
  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

export class RecordingEntitlementEventPublisher implements EntitlementEventPublisher {
  readonly published: EntitlementEvent[] = [];

  publish(event: EntitlementEvent): void {
    this.published.push(event);
  }

  eventsOfType(type: string): EntitlementEvent[] {
    return this.published.filter((event) => event.type === type);
  }
}

export class FakeEntitlementsContextResolver implements EntitlementsContextResolver {
  private readonly tenantId: string | null;

  constructor(tenantId: string | null) {
    this.tenantId = tenantId;
  }

  resolveTenantId(): string | null {
    return this.tenantId;
  }
}

export function createPlan(overrides?: Partial<Plan>): Plan {
  const now = new Date();
  return {
    id: randomUUID(),
    name: 'Professional',
    description: null,
    status: 'active',
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createPlanVersion(overrides?: Partial<PlanVersion>): PlanVersion {
  const now = new Date();
  return {
    id: randomUUID(),
    planId: 'plan-1',
    version: 1,
    label: null,
    status: 'draft',
    effectiveFrom: null,
    createdAt: now,
    activatedAt: null,
    ...overrides,
  };
}

export function createFeatureEntitlement(overrides?: Partial<FeatureEntitlement>): FeatureEntitlement {
  return {
    planVersionId: 'version-1',
    featureKey: 'ai.question_generator',
    enabled: true,
    overridable: true,
    quotaKey: null,
    quotaLimit: null,
    ...overrides,
  };
}

export function createFeatureDefinition(overrides?: Partial<FeatureDefinition>): FeatureDefinition {
  const now = new Date();
  return {
    id: randomUUID(),
    key: 'ai.question_generator',
    name: 'AI Question Generator',
    description: null,
    category: null,
    hardRestriction: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createAssignment(overrides?: Partial<TenantPlanAssignment>): TenantPlanAssignment {
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    status: 'active',
    assignedByUserId: null,
    assignedAt: new Date(),
    ...overrides,
  };
}

export function createQuota(overrides?: Partial<UsageQuota>): UsageQuota {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    quotaKey: 'ai_requests_monthly',
    period: 'monthly',
    limit: 100,
    consumed: 0,
    reserved: 0,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    updatedAt: now,
    ...overrides,
  };
}
