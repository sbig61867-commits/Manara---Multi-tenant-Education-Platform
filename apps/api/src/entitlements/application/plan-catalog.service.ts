import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FeatureDefinitionNotFoundError,
  FeatureHardRestrictedError,
  InvalidFeatureEntitlementError,
  PlanNameAlreadyExistsError,
  PlanNotFoundError,
  PlanRetiredError,
  PlanVersionAlreadyActivatedError,
  PlanVersionNotFoundError,
} from '../domain/errors.js';
import type { EntitlementEventPublisher } from '../domain/events.js';
import type { FeatureEntitlement, Plan, PlanVersion } from '../domain/types.js';
import type { FeatureDefinitionRepository } from '../ports/feature-definition.repository.js';
import type { PlanRepository } from '../ports/plan.repository.js';
import {
  ENTITLEMENTS_EVENT_PUBLISHER,
  FEATURE_DEFINITION_REPOSITORY,
  PLAN_REPOSITORY,
} from '../entitlements.tokens.js';

export interface CreatePlanCommand {
  name: string;
  description?: string | null;
}

export interface RetirePlanCommand {
  planId: string;
}

export interface PlanVersionFeatureCommand {
  featureKey: string;
  enabled: boolean;
  overridable?: boolean;
  quotaKey?: string | null;
  quotaLimit?: number | null;
}

export interface CreatePlanVersionCommand {
  planId: string;
  label?: string | null;
  effectiveFrom?: Date | null;
  features: readonly PlanVersionFeatureCommand[];
}

export interface ActivatePlanVersionCommand {
  planId: string;
  versionId: string;
}

@Injectable()
export class PlanCatalogService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    @Inject(FEATURE_DEFINITION_REPOSITORY) private readonly features: FeatureDefinitionRepository,
    @Inject(ENTITLEMENTS_EVENT_PUBLISHER) private readonly events: EntitlementEventPublisher,
  ) {}

  async createPlan(command: CreatePlanCommand): Promise<Plan> {
    const existing = await this.plans.findByName(command.name);
    if (existing !== null) {
      throw new PlanNameAlreadyExistsError(`A plan named ${command.name} already exists`);
    }
    const now = new Date();
    const plan: Plan = {
      id: randomUUID(),
      name: command.name,
      description: command.description ?? null,
      status: 'active',
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.plans.create(plan);
    await this.events.publish({
      type: 'entitlement.plan.created',
      occurredAt: now,
      planId: plan.id,
      name: plan.name,
    });
    return plan;
  }

  async retirePlan(command: RetirePlanCommand): Promise<Plan> {
    const plan = await this.requirePlan(command.planId);
    if (plan.status === 'retired') {
      return plan;
    }
    const retired: Plan = { ...plan, status: 'retired', updatedAt: new Date() };
    await this.plans.update(retired);
    await this.events.publish({
      type: 'entitlement.plan.retired',
      occurredAt: retired.updatedAt,
      planId: plan.id,
    });
    return retired;
  }

  async createPlanVersion(command: CreatePlanVersionCommand): Promise<PlanVersion> {
    const plan = await this.requirePlan(command.planId);
    if (plan.status === 'retired') {
      throw new PlanRetiredError(`Cannot version the retired plan ${plan.name}`);
    }
    const definitions = await this.features.list();
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const now = new Date();
    const versionNumber = (await this.plans.listVersionsByPlanId(plan.id)).reduce(
      (max, version) => Math.max(max, version.version),
      0,
    ) + 1;
    const version: PlanVersion = {
      id: randomUUID(),
      planId: plan.id,
      version: versionNumber,
      label: command.label ?? null,
      status: 'draft',
      effectiveFrom: command.effectiveFrom ?? null,
      createdAt: now,
      activatedAt: null,
    };
    const entitlements: FeatureEntitlement[] = command.features.map((feature) => {
      const definition = byKey.get(feature.featureKey);
      if (definition === undefined) {
        throw new FeatureDefinitionNotFoundError(
          `Feature ${feature.featureKey} is not defined in the platform catalog`,
        );
      }
      if (definition.hardRestriction === 'blocked') {
        throw new FeatureHardRestrictedError(
          `Feature ${feature.featureKey} is hard-restricted and cannot be included in a plan`,
        );
      }
      this.assertValidLimit(feature.quotaKey ?? null, feature.quotaLimit ?? null);
      return {
        planVersionId: version.id,
        featureKey: feature.featureKey,
        enabled: feature.enabled,
        overridable: feature.overridable ?? true,
        quotaKey: feature.quotaKey ?? null,
        quotaLimit: feature.quotaLimit ?? null,
      };
    });
    await this.plans.createVersion(version);
    await this.plans.saveFeatureEntitlements(version.id, entitlements);
    return version;
  }

  async activatePlanVersion(command: ActivatePlanVersionCommand): Promise<PlanVersion> {
    const plan = await this.requirePlan(command.planId);
    if (plan.status === 'retired') {
      throw new PlanRetiredError(`Cannot activate a version of the retired plan ${plan.name}`);
    }
    const version = await this.plans.findVersionById(command.versionId);
    if (version === null || version.planId !== plan.id) {
      throw new PlanVersionNotFoundError('The plan version does not exist for this plan');
    }
    if (version.status === 'active') {
      throw new PlanVersionAlreadyActivatedError('A plan version is immutable once activated');
    }
    const now = new Date();
    const activated: PlanVersion = { ...version, status: 'active', activatedAt: now };
    const updatedPlan: Plan = { ...plan, currentVersionId: activated.id, updatedAt: now };
    await this.plans.updateVersion(activated);
    await this.plans.update(updatedPlan);
    await this.events.publish({
      type: 'entitlement.plan_version.activated',
      occurredAt: now,
      planId: plan.id,
      planVersionId: activated.id,
      version: activated.version,
    });
    return activated;
  }

  async getPlan(planId: string): Promise<Plan | null> {
    return this.plans.findById(planId);
  }

  async listPlans(): Promise<Plan[]> {
    return this.plans.list();
  }

  async listPlanVersions(planId: string): Promise<PlanVersion[]> {
    return this.plans.listVersionsByPlanId(planId);
  }

  private async requirePlan(planId: string): Promise<Plan> {
    const plan = await this.plans.findById(planId);
    if (plan === null) {
      throw new PlanNotFoundError('Plan not found');
    }
    return plan;
  }

  private assertValidLimit(quotaKey: string | null, quotaLimit: number | null): void {
    if (quotaKey !== null && quotaKey === '') {
      throw new InvalidFeatureEntitlementError('A quota key cannot be empty');
    }
    if (quotaKey === null && quotaLimit !== null) {
      throw new InvalidFeatureEntitlementError('A quota limit requires a quota key');
    }
    if (quotaLimit !== null && quotaLimit < 0) {
      throw new InvalidFeatureEntitlementError('A quota limit cannot be negative');
    }
  }
}
