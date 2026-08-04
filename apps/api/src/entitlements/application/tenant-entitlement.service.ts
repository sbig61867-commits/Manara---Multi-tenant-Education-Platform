import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FeatureDefinitionNotFoundError,
  FeatureHardRestrictedError,
  FeatureNotInPlanError,
  OverrideNotAllowedError,
  PlanHasNoActiveVersionError,
  PlanNotFoundError,
  PlanRetiredError,
  TenantAlreadyAssignedError,
  TenantNotAssignedError,
} from '../domain/errors.js';
import type { EntitlementEventPublisher } from '../domain/events.js';
import type {
  TenantFeatureOverride,
  TenantPlanAssignment,
} from '../domain/types.js';
import type { EntitlementsContextResolver } from '../ports/entitlements-context.js';
import { requireTenantContext } from '../ports/entitlements-context.js';
import type { FeatureDefinitionRepository } from '../ports/feature-definition.repository.js';
import type { PlanRepository } from '../ports/plan.repository.js';
import type { TenantEntitlementRepository } from '../ports/tenant-entitlement.repository.js';
import {
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_EVENT_PUBLISHER,
  FEATURE_DEFINITION_REPOSITORY,
  PLAN_REPOSITORY,
  TENANT_ENTITLEMENT_REPOSITORY,
} from '../entitlements.tokens.js';

export interface AssignPlanToTenantCommand {
  planId: string;
  assignedByUserId?: string | null;
}

export interface ApplyFeatureOverrideCommand {
  featureKey: string;
  enabled: boolean;
}

export interface RemoveFeatureOverrideCommand {
  featureKey: string;
}

@Injectable()
export class TenantEntitlementService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    @Inject(FEATURE_DEFINITION_REPOSITORY) private readonly features: FeatureDefinitionRepository,
    @Inject(TENANT_ENTITLEMENT_REPOSITORY) private readonly tenantState: TenantEntitlementRepository,
    @Inject(ENTITLEMENTS_EVENT_PUBLISHER) private readonly events: EntitlementEventPublisher,
    @Inject(ENTITLEMENTS_CONTEXT_RESOLVER)
    private readonly contextResolver: EntitlementsContextResolver,
  ) {}

  async assignPlanToTenant(command: AssignPlanToTenantCommand): Promise<TenantPlanAssignment> {
    const tenantId = requireTenantContext(this.contextResolver);
    const plan = await this.plans.findById(command.planId);
    if (plan === null) {
      throw new PlanNotFoundError('Plan not found');
    }
    if (plan.status === 'retired') {
      throw new PlanRetiredError(`Cannot assign the retired plan ${plan.name}`);
    }
    if (plan.currentVersionId === null) {
      throw new PlanHasNoActiveVersionError(`Plan ${plan.name} has no activated version`);
    }
    const existing = await this.tenantState.findActiveAssignmentByTenant(tenantId);
    if (existing !== null) {
      throw new TenantAlreadyAssignedError('The tenant already has an active plan assignment');
    }
    const now = new Date();
    const assignment: TenantPlanAssignment = {
      id: randomUUID(),
      tenantId,
      planId: plan.id,
      planVersionId: plan.currentVersionId,
      status: 'active',
      assignedByUserId: command.assignedByUserId ?? null,
      assignedAt: now,
    };
    await this.tenantState.createAssignment(assignment);
    await this.events.publish({
      type: 'entitlement.plan.assigned',
      occurredAt: now,
      tenantId,
      planId: plan.id,
      planVersionId: assignment.planVersionId,
    });
    return assignment;
  }

  async applyFeatureOverride(command: ApplyFeatureOverrideCommand): Promise<TenantFeatureOverride> {
    const tenantId = requireTenantContext(this.contextResolver);
    const definition = await this.features.findByKey(command.featureKey);
    if (definition === null) {
      throw new FeatureDefinitionNotFoundError(
        `Feature ${command.featureKey} is not defined in the platform catalog`,
      );
    }
    if (definition.hardRestriction === 'blocked') {
      throw new FeatureHardRestrictedError(
        `Feature ${command.featureKey} is hard-restricted and cannot be overridden`,
      );
    }
    const assignment = await this.tenantState.findActiveAssignmentByTenant(tenantId);
    if (assignment === null) {
      throw new TenantNotAssignedError('The tenant has no active plan assignment');
    }
    const plan = await this.plans.findById(assignment.planId);
    if (plan === null || plan.currentVersionId === null) {
      throw new TenantNotAssignedError('The tenant plan assignment is not resolvable');
    }
    const entitlements = await this.plans.listFeatureEntitlementsByVersion(plan.currentVersionId);
    const planFeature = entitlements.find(
      (entitlement) => entitlement.featureKey === command.featureKey,
    );
    if (planFeature === undefined) {
      throw new FeatureNotInPlanError(
        `Feature ${command.featureKey} is not included in the assigned plan`,
      );
    }
    if (command.enabled && !planFeature.overridable) {
      throw new OverrideNotAllowedError(
        `Feature ${command.featureKey} is not overridable in the assigned plan`,
      );
    }
    const now = new Date();
    const override: TenantFeatureOverride = {
      tenantId,
      featureKey: command.featureKey,
      enabled: command.enabled,
      updatedAt: now,
    };
    await this.tenantState.upsertOverride(override);
    await this.events.publish({
      type: 'entitlement.override.changed',
      occurredAt: now,
      tenantId,
      featureKey: command.featureKey,
      enabled: command.enabled,
    });
    return override;
  }

  async removeFeatureOverride(command: RemoveFeatureOverrideCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    const existing = await this.tenantState.findOverride(tenantId, command.featureKey);
    if (existing !== null) {
      await this.tenantState.deleteOverride(tenantId, command.featureKey);
      await this.events.publish({
        type: 'entitlement.override.changed',
        occurredAt: new Date(),
        tenantId,
        featureKey: command.featureKey,
        enabled: existing.enabled,
      });
    }
  }
}
