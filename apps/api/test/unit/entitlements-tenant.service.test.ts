import assert from 'node:assert/strict';
import test from 'node:test';
import { TenantEntitlementService } from '../../src/entitlements/application/tenant-entitlement.service.js';
import {
  FeatureDefinitionNotFoundError,
  FeatureHardRestrictedError,
  FeatureNotInPlanError,
  MissingTenantContextError,
  OverrideNotAllowedError,
  PlanHasNoActiveVersionError,
  PlanNotFoundError,
  PlanRetiredError,
  TenantAlreadyAssignedError,
  TenantNotAssignedError,
} from '../../src/entitlements/domain/errors.js';
import {
  createAssignment,
  createFeatureDefinition,
  createFeatureEntitlement,
  createPlan,
  FakeEntitlementsContextResolver,
  FakeFeatureDefinitionRepository,
  FakePlanRepository,
  FakeTenantEntitlementRepository,
  RecordingEntitlementEventPublisher,
} from './entitlements-helpers.js';

const TENANT = 'tenant-1';

function createServices(tenantId: string | null = TENANT): {
  plans: FakePlanRepository;
  features: FakeFeatureDefinitionRepository;
  tenantState: FakeTenantEntitlementRepository;
  events: RecordingEntitlementEventPublisher;
  service: TenantEntitlementService;
} {
  const plans = new FakePlanRepository();
  const features = new FakeFeatureDefinitionRepository();
  const tenantState = new FakeTenantEntitlementRepository();
  const events = new RecordingEntitlementEventPublisher();
  const service = new TenantEntitlementService(
    plans,
    features,
    tenantState,
    events,
    new FakeEntitlementsContextResolver(tenantId),
  );
  return { plans, features, tenantState, events, service };
}

async function seedActivePlan(plans: FakePlanRepository): Promise<string> {
  const plan = createPlan({ name: 'Professional' });
  const version = { id: 'version-1', planId: plan.id, version: 1 };
  await plans.create({ ...plan, currentVersionId: version.id });
  await plans.createVersion({
    id: version.id,
    planId: plan.id,
    version: 1,
    label: null,
    status: 'active',
    effectiveFrom: new Date(),
    createdAt: new Date(),
    activatedAt: new Date(),
  });
  await plans.saveFeatureEntitlements(version.id, [
    createFeatureEntitlement({
      planVersionId: version.id,
      featureKey: 'ai.question_generator',
      enabled: true,
      overridable: true,
    }),
    createFeatureEntitlement({
      planVersionId: version.id,
      featureKey: 'reports.export',
      enabled: true,
      overridable: false,
    }),
  ]);
  return plan.id;
}

test('assignPlanToTenant fails closed without tenant context', async () => {
  const { service, plans } = createServices(null);
  const planId = await seedActivePlan(plans);
  await assert.rejects(service.assignPlanToTenant({ planId }), MissingTenantContextError);
});

test('assignPlanToTenant rejects unknown plans', async () => {
  const { service } = createServices();
  await assert.rejects(service.assignPlanToTenant({ planId: 'missing' }), PlanNotFoundError);
});

test('assignPlanToTenant rejects retired plans', async () => {
  const { service, plans } = createServices();
  const plan = createPlan({ name: 'Retired' });
  await plans.create({ ...plan, status: 'retired' });
  await assert.rejects(service.assignPlanToTenant({ planId: plan.id }), PlanRetiredError);
});

test('assignPlanToTenant rejects plans without an activated version', async () => {
  const { service, plans } = createServices();
  const plan = createPlan({ name: 'NoVersion' });
  await plans.create(plan);
  await assert.rejects(
    service.assignPlanToTenant({ planId: plan.id }),
    PlanHasNoActiveVersionError,
  );
});

test('assignPlanToTenant rejects a tenant that is already assigned', async () => {
  const { service, plans, tenantState } = createServices();
  const planId = await seedActivePlan(plans);
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  await assert.rejects(service.assignPlanToTenant({ planId }), TenantAlreadyAssignedError);
});

test('assignPlanToTenant assigns the current plan version to the tenant', async () => {
  const { service, plans, tenantState, events } = createServices();
  const planId = await seedActivePlan(plans);
  const assignment = await service.assignPlanToTenant({ planId, assignedByUserId: 'user-1' });
  assert.equal(assignment.tenantId, TENANT);
  assert.equal(assignment.planId, planId);
  assert.equal(assignment.planVersionId, 'version-1');
  assert.equal(assignment.status, 'active');
  assert.equal(assignment.assignedByUserId, 'user-1');
  assert.equal((await tenantState.findActiveAssignmentByTenant(TENANT))?.planId, planId);
  const assigned = events.eventsOfType('entitlement.plan.assigned');
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].tenantId, TENANT);
});

test('applyFeatureOverride fails closed without tenant context', async () => {
  const { service } = createServices(null);
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'ai.question_generator', enabled: false }),
    MissingTenantContextError,
  );
});

test('applyFeatureOverride rejects features that are not in the catalog', async () => {
  const { service, plans } = createServices();
  await seedActivePlan(plans);
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'unknown.feature', enabled: false }),
    FeatureDefinitionNotFoundError,
  );
});

test('applyFeatureOverride rejects hard-restricted features', async () => {
  const { service, plans, features, tenantState } = createServices();
  const planId = await seedActivePlan(plans);
  await features.create(createFeatureDefinition({ key: 'legacy_export', hardRestriction: 'blocked' }));
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'legacy_export', enabled: true }),
    FeatureHardRestrictedError,
  );
});

test('applyFeatureOverride rejects unassigned tenants', async () => {
  const { service, plans, features } = createServices();
  await seedActivePlan(plans);
  await features.create(createFeatureDefinition());
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'ai.question_generator', enabled: false }),
    TenantNotAssignedError,
  );
});

test('applyFeatureOverride rejects features that are not in the assigned plan', async () => {
  const { service, plans, features, tenantState } = createServices();
  const planId = await seedActivePlan(plans);
  await features.create(createFeatureDefinition({ key: 'analytics.dashboard' }));
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'analytics.dashboard', enabled: true }),
    FeatureNotInPlanError,
  );
});

test('applyFeatureOverride rejects enabling a non-overridable feature', async () => {
  const { service, plans, features, tenantState } = createServices();
  const planId = await seedActivePlan(plans);
  await features.create(createFeatureDefinition());
  await features.create(createFeatureDefinition({ key: 'reports.export' }));
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  await assert.rejects(
    service.applyFeatureOverride({ featureKey: 'reports.export', enabled: true }),
    OverrideNotAllowedError,
  );
});

test('applyFeatureOverride allows disabling a non-overridable feature', async () => {
  const { service, plans, features, tenantState, events } = createServices();
  const planId = await seedActivePlan(plans);
  await features.create(createFeatureDefinition());
  await features.create(createFeatureDefinition({ key: 'reports.export' }));
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  const override = await service.applyFeatureOverride({
    featureKey: 'reports.export',
    enabled: false,
  });
  assert.equal(override.enabled, false);
  assert.equal(events.eventsOfType('entitlement.override.changed').length, 1);
});

test('applyFeatureOverride stores the override and publishes override.changed', async () => {
  const { service, plans, features, tenantState, events } = createServices();
  const planId = await seedActivePlan(plans);
  await features.create(createFeatureDefinition());
  await tenantState.createAssignment(createAssignment({ tenantId: TENANT, planId, planVersionId: 'version-1' }));
  const override = await service.applyFeatureOverride({
    featureKey: 'ai.question_generator',
    enabled: false,
  });
  assert.equal(override.tenantId, TENANT);
  assert.equal(override.enabled, false);
  assert.equal((await tenantState.findOverride(TENANT, 'ai.question_generator'))?.enabled, false);
  const changed = events.eventsOfType('entitlement.override.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0].featureKey, 'ai.question_generator');
});

test('removeFeatureOverride is idempotent when no override exists', async () => {
  const { service, events } = createServices();
  await service.removeFeatureOverride({ featureKey: 'ai.question_generator' });
  assert.equal(events.eventsOfType('entitlement.override.changed').length, 0);
});

test('removeFeatureOverride deletes the override and publishes with the previous state', async () => {
  const { service, tenantState, events } = createServices();
  await tenantState.upsertOverride({
    tenantId: TENANT,
    featureKey: 'ai.question_generator',
    enabled: false,
    updatedAt: new Date(),
  });
  await service.removeFeatureOverride({ featureKey: 'ai.question_generator' });
  assert.equal(await tenantState.findOverride(TENANT, 'ai.question_generator'), null);
  const changed = events.eventsOfType('entitlement.override.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0].enabled, false);
});

test('removeFeatureOverride fails closed without tenant context', async () => {
  const { service } = createServices(null);
  await assert.rejects(
    service.removeFeatureOverride({ featureKey: 'ai.question_generator' }),
    MissingTenantContextError,
  );
});
