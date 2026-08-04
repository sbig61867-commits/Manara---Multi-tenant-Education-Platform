import assert from 'node:assert/strict';
import test from 'node:test';
import { FeatureCatalogService } from '../../src/entitlements/application/feature-catalog.service.js';
import { PlanCatalogService } from '../../src/entitlements/application/plan-catalog.service.js';
import {
  FeatureDefinitionKeyAlreadyExistsError,
  FeatureDefinitionNotFoundError,
  FeatureHardRestrictedError,
  InvalidFeatureEntitlementError,
  PlanNameAlreadyExistsError,
  PlanNotFoundError,
  PlanRetiredError,
  PlanVersionAlreadyActivatedError,
  PlanVersionNotFoundError,
} from '../../src/entitlements/domain/errors.js';
import {
  createFeatureDefinition,
  createPlanVersion,
  FakeFeatureDefinitionRepository,
  FakePlanRepository,
  RecordingEntitlementEventPublisher,
} from './entitlements-helpers.js';

function createServices(): {
  plans: FakePlanRepository;
  features: FakeFeatureDefinitionRepository;
  events: RecordingEntitlementEventPublisher;
  catalog: PlanCatalogService;
  featureCatalog: FeatureCatalogService;
} {
  const plans = new FakePlanRepository();
  const features = new FakeFeatureDefinitionRepository();
  const events = new RecordingEntitlementEventPublisher();
  const catalog = new PlanCatalogService(plans, features, events);
  const featureCatalog = new FeatureCatalogService(features, events);
  return { plans, features, events, catalog, featureCatalog };
}

async function seedFeature(
  featureCatalog: FeatureCatalogService,
  overrides?: Parameters<typeof createFeatureDefinition>[0],
) {
  const definition = createFeatureDefinition(overrides);
  await featureCatalog.createFeatureDefinition({
    key: definition.key,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    hardRestriction: definition.hardRestriction,
  });
  return definition;
}

async function seedPlanWithVersion(
  catalog: PlanCatalogService,
  featureCatalog: FeatureCatalogService,
  versionOverrides?: Parameters<typeof createPlanVersion>[0],
): Promise<{ planId: string; versionId: string }> {
  await seedFeature(featureCatalog);
  const plan = await catalog.createPlan({ name: 'Professional' });
  const version = createPlanVersion({ ...versionOverrides, planId: plan.id });
  await catalog.createPlanVersion({
    planId: plan.id,
    label: version.label,
    features: [
      {
        featureKey: 'ai.question_generator',
        enabled: true,
        quotaKey: 'ai_requests_monthly',
        quotaLimit: 100,
      },
    ],
  });
  const createdVersion = (await catalog.listPlanVersions(plan.id))[0];
  return { planId: plan.id, versionId: createdVersion.id };
}

test('creates a plan with active status and publishes plan.created', async () => {
  const { catalog, events } = createServices();
  const plan = await catalog.createPlan({ name: 'Professional' });
  assert.equal(plan.status, 'active');
  assert.equal(plan.currentVersionId, null);
  const created = events.eventsOfType('entitlement.plan.created');
  assert.equal(created.length, 1);
  assert.equal(created[0].planId, plan.id);
  assert.equal(created[0].name, 'Professional');
});

test('rejects duplicate plan names', async () => {
  const { catalog } = createServices();
  await catalog.createPlan({ name: 'Professional' });
  await assert.rejects(catalog.createPlan({ name: 'Professional' }), PlanNameAlreadyExistsError);
});

test('retires a plan and keeps its history', async () => {
  const { catalog, plans, events } = createServices();
  const plan = await catalog.createPlan({ name: 'Professional' });
  const retired = await catalog.retirePlan({ planId: plan.id });
  assert.equal(retired.status, 'retired');
  assert.equal(plans.plans.get(plan.id)?.status, 'retired');
  assert.equal(events.eventsOfType('entitlement.plan.retired').length, 1);
});

test('retiring a plan is idempotent', async () => {
  const { catalog, events } = createServices();
  const plan = await catalog.createPlan({ name: 'Professional' });
  await catalog.retirePlan({ planId: plan.id });
  await catalog.retirePlan({ planId: plan.id });
  assert.equal(events.eventsOfType('entitlement.plan.retired').length, 1);
});

test('retirePlan rejects unknown plans', async () => {
  const { catalog } = createServices();
  await assert.rejects(catalog.retirePlan({ planId: 'missing' }), PlanNotFoundError);
});

test('createPlanVersion numbers versions sequentially', async () => {
  const { catalog, featureCatalog } = createServices();
  await seedFeature(featureCatalog);
  const plan = await catalog.createPlan({ name: 'Professional' });
  for (let index = 0; index < 2; index++) {
    await catalog.createPlanVersion({
      planId: plan.id,
      features: [{ featureKey: 'ai.question_generator', enabled: true }],
    });
  }
  const versions = await catalog.listPlanVersions(plan.id);
  assert.deepEqual(
    versions.map((version) => version.version),
    [1, 2],
  );
  assert.ok(versions.every((version) => version.status === 'draft'));
});

test('createPlanVersion saves feature entitlements', async () => {
  const { catalog, plans, featureCatalog } = createServices();
  await seedFeature(featureCatalog);
  const plan = await catalog.createPlan({ name: 'Professional' });
  await catalog.createPlanVersion({
    planId: plan.id,
    features: [
      { featureKey: 'ai.question_generator', enabled: true, quotaKey: 'ai_requests_monthly', quotaLimit: 100 },
    ],
  });
  const version = (await catalog.listPlanVersions(plan.id))[0];
  const entitlements = await plans.listFeatureEntitlementsByVersion(version.id);
  assert.deepEqual(
    entitlements.map((entitlement) => entitlement.featureKey),
    ['ai.question_generator'],
  );
  assert.equal(entitlements[0].quotaLimit, 100);
  assert.equal(entitlements[0].overridable, true);
});

test('createPlanVersion rejects features that are not in the catalog', async () => {
  const { catalog } = createServices();
  const plan = await catalog.createPlan({ name: 'Professional' });
  await assert.rejects(
    catalog.createPlanVersion({
      planId: plan.id,
      features: [{ featureKey: 'unknown.feature', enabled: true }],
    }),
    FeatureDefinitionNotFoundError,
  );
});

test('createPlanVersion rejects hard-restricted features', async () => {
  const { catalog, featureCatalog } = createServices();
  await seedFeature(featureCatalog, { key: 'legacy_export', hardRestriction: 'blocked' });
  const plan = await catalog.createPlan({ name: 'Professional' });
  await assert.rejects(
    catalog.createPlanVersion({
      planId: plan.id,
      features: [{ featureKey: 'legacy_export', enabled: true }],
    }),
    FeatureHardRestrictedError,
  );
});

test('createPlanVersion rejects quota limits without a quota key', async () => {
  const { catalog, featureCatalog } = createServices();
  await seedFeature(featureCatalog);
  const plan = await catalog.createPlan({ name: 'Professional' });
  await assert.rejects(
    catalog.createPlanVersion({
      planId: plan.id,
      features: [{ featureKey: 'ai.question_generator', enabled: true, quotaLimit: 100 }],
    }),
    InvalidFeatureEntitlementError,
  );
});

test('createPlanVersion rejects negative quota limits', async () => {
  const { catalog, featureCatalog } = createServices();
  await seedFeature(featureCatalog);
  const plan = await catalog.createPlan({ name: 'Professional' });
  await assert.rejects(
    catalog.createPlanVersion({
      planId: plan.id,
      features: [
        { featureKey: 'ai.question_generator', enabled: true, quotaKey: 'q', quotaLimit: -1 },
      ],
    }),
    InvalidFeatureEntitlementError,
  );
});

test('createPlanVersion rejects versions of retired plans', async () => {
  const { catalog } = createServices();
  const plan = await catalog.createPlan({ name: 'Professional' });
  await catalog.retirePlan({ planId: plan.id });
  await assert.rejects(
    catalog.createPlanVersion({ planId: plan.id, features: [] }),
    PlanRetiredError,
  );
});

test('activatePlanVersion activates the version and links the plan', async () => {
  const { catalog, plans, events, featureCatalog } = createServices();
  const { planId, versionId } = await seedPlanWithVersion(catalog, featureCatalog);
  const activated = await catalog.activatePlanVersion({ planId, versionId });
  assert.equal(activated.status, 'active');
  assert.ok(activated.activatedAt instanceof Date);
  assert.equal(plans.plans.get(planId)?.currentVersionId, versionId);
  const activation = events.eventsOfType('entitlement.plan_version.activated');
  assert.equal(activation.length, 1);
  assert.equal(activation[0].planVersionId, versionId);
});

test('activatePlanVersion rejects versions belonging to another plan', async () => {
  const { catalog, featureCatalog } = createServices();
  await seedPlanWithVersion(catalog, featureCatalog);
  const other = await catalog.createPlan({ name: 'Other' });
  await assert.rejects(
    catalog.activatePlanVersion({ planId: other.id, versionId: 'version-other' }),
    PlanVersionNotFoundError,
  );
});

test('a plan version is immutable once activated', async () => {
  const { catalog, featureCatalog } = createServices();
  const { planId, versionId } = await seedPlanWithVersion(catalog, featureCatalog);
  await catalog.activatePlanVersion({ planId, versionId });
  await assert.rejects(
    catalog.activatePlanVersion({ planId, versionId }),
    PlanVersionAlreadyActivatedError,
  );
});

test('activatePlanVersion rejects versions of retired plans', async () => {
  const { catalog, featureCatalog } = createServices();
  const { planId, versionId } = await seedPlanWithVersion(catalog, featureCatalog);
  await catalog.retirePlan({ planId });
  await assert.rejects(
    catalog.activatePlanVersion({ planId, versionId }),
    PlanRetiredError,
  );
});

test('feature catalog defaults hardRestriction to none', async () => {
  const { featureCatalog } = createServices();
  const definition = await featureCatalog.createFeatureDefinition({
    key: 'ai.question_generator',
    name: 'AI Question Generator',
  });
  assert.equal(definition.hardRestriction, 'none');
});

test('feature catalog rejects duplicate keys', async () => {
  const { featureCatalog } = createServices();
  await featureCatalog.createFeatureDefinition({ key: 'ai.question_generator', name: 'AI' });
  await assert.rejects(
    featureCatalog.createFeatureDefinition({ key: 'ai.question_generator', name: 'AI again' }),
    FeatureDefinitionKeyAlreadyExistsError,
  );
});

test('feature catalog finds and lists definitions', async () => {
  const { featureCatalog } = createServices();
  await seedFeature(featureCatalog);
  const found = await featureCatalog.findByKey('ai.question_generator');
  assert.ok(found !== null);
  assert.equal(found.key, 'ai.question_generator');
  assert.equal((await featureCatalog.listFeatures()).length, 1);
});
