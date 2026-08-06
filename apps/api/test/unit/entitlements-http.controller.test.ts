import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { HttpNotFoundError } from '../../src/http/errors.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import type { PlanCatalogService } from '../../src/entitlements/application/plan-catalog.service.js';
import type { FeatureCatalogService } from '../../src/entitlements/application/feature-catalog.service.js';
import type { TenantEntitlementService } from '../../src/entitlements/application/tenant-entitlement.service.js';
import type { EntitlementEvaluationService } from '../../src/entitlements/application/entitlement-evaluation.service.js';
import type {
  EntitlementDecision,
  FeatureDefinition,
  Plan,
  PlanVersion,
  QuotaAvailability,
  TenantEntitlementSnapshot,
  TenantFeatureOverride,
  TenantPlanAssignment,
  UsageMeter,
  UsageReservation,
} from '../../src/entitlements/domain/types.js';
import {
  FeatureCatalogController,
  PlanCatalogController,
  TenantEntitlementsController,
} from '../../src/entitlements-http/entitlements.controller.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_VERSION_ID = '44444444-4444-4444-8444-444444444444';

function createPlan(overrides?: Partial<Plan>): Plan {
  return {
    id: PLAN_ID,
    name: 'Enterprise',
    description: null,
    status: 'active',
    currentVersionId: PLAN_VERSION_ID,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  };
}

function createPlanVersion(overrides?: Partial<PlanVersion>): PlanVersion {
  return {
    id: PLAN_VERSION_ID,
    planId: PLAN_ID,
    version: 1,
    label: 'v1',
    status: 'active',
    effectiveFrom: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    activatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createFeature(overrides?: Partial<FeatureDefinition>): FeatureDefinition {
  return {
    id: randomUUID(),
    key: 'ai.question_generator',
    name: 'AI Question Generator',
    description: null,
    category: 'ai',
    hardRestriction: 'none',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createSnapshot(overrides?: Partial<TenantEntitlementSnapshot>): TenantEntitlementSnapshot {
  return {
    tenantId: TENANT_ID,
    planId: PLAN_ID,
    planName: 'Enterprise',
    planVersionId: PLAN_VERSION_ID,
    planVersionNumber: 1,
    featureFlags: { 'ai.question_generator': true },
    quotaLimits: { ai_requests_monthly: 100 },
    generatedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

function createAssignment(overrides?: Partial<TenantPlanAssignment>): TenantPlanAssignment {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    planId: PLAN_ID,
    planVersionId: PLAN_VERSION_ID,
    status: 'active',
    assignedByUserId: USER_ID,
    assignedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

function createOverride(overrides?: Partial<TenantFeatureOverride>): TenantFeatureOverride {
  return {
    tenantId: TENANT_ID,
    featureKey: 'ai.question_generator',
    enabled: true,
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

function createDecision(overrides?: Partial<EntitlementDecision>): EntitlementDecision {
  return {
    tenantId: TENANT_ID,
    featureKey: 'ai.question_generator',
    allowed: true,
    reason: 'allowed',
    source: 'plan',
    ...overrides,
  };
}

function createAvailability(overrides?: Partial<QuotaAvailability>): QuotaAvailability {
  return {
    quotaKey: 'ai_requests_monthly',
    tenantId: TENANT_ID,
    limit: 100,
    consumed: 0,
    reserved: 0,
    available: 100,
    ...overrides,
  };
}

function createReservation(overrides?: Partial<UsageReservation>): UsageReservation {
  return {
    reservationId: randomUUID(),
    quotaKey: 'ai_requests_monthly',
    tenantId: TENANT_ID,
    amount: 25,
    ...overrides,
  };
}

function createMeter(overrides?: Partial<UsageMeter>): UsageMeter {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    quotaKey: 'ai_requests_monthly',
    amount: 25,
    kind: 'reserved',
    operationId: null,
    recordedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

interface Stubs {
  plans?: {
    listPlans?: PlanCatalogService['listPlans'];
    getPlan?: PlanCatalogService['getPlan'];
    listPlanVersions?: PlanCatalogService['listPlanVersions'];
  };
  features?: {
    listFeatures?: FeatureCatalogService['listFeatures'];
  };
  entitlements?: {
    assignPlanToTenant?: TenantEntitlementService['assignPlanToTenant'];
    applyFeatureOverride?: TenantEntitlementService['applyFeatureOverride'];
    removeFeatureOverride?: TenantEntitlementService['removeFeatureOverride'];
  };
  evaluation?: {
    resolveTenantSnapshot?: EntitlementEvaluationService['resolveTenantSnapshot'];
    evaluateFeature?: EntitlementEvaluationService['evaluateFeature'];
    checkQuotaAvailability?: EntitlementEvaluationService['checkQuotaAvailability'];
    reserveUsage?: EntitlementEvaluationService['reserveUsage'];
    releaseReservation?: EntitlementEvaluationService['releaseReservation'];
    listUsageMeters?: EntitlementEvaluationService['listUsageMeters'];
  };
}

function createControllers(overrides: Stubs = {}): {
  plans: PlanCatalogController;
  features: FeatureCatalogController;
  tenants: TenantEntitlementsController;
} {
  const plans = {
    listPlans: overrides.plans?.listPlans ?? (async () => [createPlan()]),
    getPlan: overrides.plans?.getPlan ?? (async () => createPlan()),
    listPlanVersions: overrides.plans?.listPlanVersions ?? (async () => [createPlanVersion()]),
  } as unknown as PlanCatalogService;
  const features = {
    listFeatures: overrides.features?.listFeatures ?? (async () => [createFeature()]),
  } as unknown as FeatureCatalogService;
  const entitlements = {
    assignPlanToTenant:
      overrides.entitlements?.assignPlanToTenant ??
      (async (command: { planId: string; assignedByUserId: string | null }) =>
        createAssignment({ planId: command.planId, assignedByUserId: command.assignedByUserId })),
    applyFeatureOverride:
      overrides.entitlements?.applyFeatureOverride ??
      (async (command: { featureKey: string; enabled: boolean }) => createOverride({ featureKey: command.featureKey, enabled: command.enabled })),
    removeFeatureOverride: overrides.entitlements?.removeFeatureOverride ?? (async () => undefined),
  } as unknown as TenantEntitlementService;
  const evaluation = {
    resolveTenantSnapshot: overrides.evaluation?.resolveTenantSnapshot ?? (async () => createSnapshot()),
    evaluateFeature: overrides.evaluation?.evaluateFeature ?? (async () => createDecision()),
    checkQuotaAvailability: overrides.evaluation?.checkQuotaAvailability ?? (async () => createAvailability()),
    reserveUsage: overrides.evaluation?.reserveUsage ?? (async () => createReservation()),
    releaseReservation: overrides.evaluation?.releaseReservation ?? (async () => undefined),
    listUsageMeters: overrides.evaluation?.listUsageMeters ?? (async () => [createMeter()]),
  } as unknown as EntitlementEvaluationService;
  const requestContext = {
    get: () => ({ authenticatedUserId: USER_ID }),
  } as unknown as RequestContextService;
  return {
    plans: new PlanCatalogController(plans),
    features: new FeatureCatalogController(features),
    tenants: new TenantEntitlementsController(entitlements, evaluation, requestContext),
  };
}

test('listPlans returns the plans page', async () => {
  const { plans } = createControllers();
  const response = await plans.listPlans({ limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.name, 'Enterprise');
  assert.equal(response.nextCursor, null);
  assert.ok('status' in response.items[0]!);
});

test('listPlans paginates by the createdAt cursor', async () => {
  const rows = [
    createPlan({ id: randomUUID(), createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    createPlan({ id: randomUUID(), createdAt: new Date('2026-01-02T00:00:00.000Z') }),
    createPlan({ id: randomUUID(), createdAt: new Date('2026-01-03T00:00:00.000Z') }),
  ];
  const { plans } = createControllers({ plans: { listPlans: async () => rows } });
  const first = await plans.listPlans({ limit: 2, cursor: null });
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0]?.name, 'Enterprise');
  assert.ok(first.nextCursor !== null);
  const second = await plans.listPlans({ limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
});

test('getPlan returns the plan view', async () => {
  const { plans } = createControllers();
  const response = await plans.getPlan({ planId: PLAN_ID });
  assert.equal(response.plan.id, PLAN_ID);
  assert.equal(response.plan.currentVersionId, PLAN_VERSION_ID);
});

test('getPlan throws 404 when the plan is missing', async () => {
  const { plans } = createControllers({ plans: { getPlan: async () => null } });
  await assert.rejects(plans.getPlan({ planId: PLAN_ID }), HttpNotFoundError);
});

test('listPlanVersions returns the versions page', async () => {
  const { plans } = createControllers();
  const response = await plans.listPlanVersions({ planId: PLAN_ID }, { limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.version, 1);
  assert.equal(response.items[0]?.status, 'active');
});

test('listPlanVersions throws 404 when the plan is missing', async () => {
  const { plans } = createControllers({ plans: { getPlan: async () => null } });
  await assert.rejects(plans.listPlanVersions({ planId: PLAN_ID }, { limit: 20, cursor: null }), HttpNotFoundError);
});

test('listFeatures returns the features page', async () => {
  const { features } = createControllers();
  const response = await features.listFeatures({ limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.key, 'ai.question_generator');
  assert.equal(response.items[0]?.hardRestriction, 'none');
});

test('getEntitlements returns the snapshot view', async () => {
  const { tenants } = createControllers();
  const response = await tenants.getEntitlements({ tenantId: TENANT_ID });
  assert.equal(response.snapshot.tenantId, TENANT_ID);
  assert.equal(response.snapshot.planId, PLAN_ID);
  assert.deepEqual(response.snapshot.featureFlags, { 'ai.question_generator': true });
  assert.deepEqual(response.snapshot.quotaLimits, { ai_requests_monthly: 100 });
});

test('assignPlan forwards the plan id and actor and returns the assignment view', async () => {
  let received: { planId: string; assignedByUserId: string | null } | undefined;
  const { tenants } = createControllers({
    entitlements: {
      assignPlanToTenant: async (command) => {
        received = command;
        return createAssignment();
      },
    },
  });
  const response = await tenants.assignPlan({ tenantId: TENANT_ID }, { planId: PLAN_ID });
  assert.deepEqual(received, { planId: PLAN_ID, assignedByUserId: USER_ID });
  assert.equal(response.assignment.planId, PLAN_ID);
  assert.equal(response.assignment.assignedByUserId, USER_ID);
});

test('applyOverride returns the override view', async () => {
  const { tenants } = createControllers();
  const response = await tenants.applyOverride({ tenantId: TENANT_ID }, { featureKey: 'ai.question_generator', enabled: true });
  assert.equal(response.override.featureKey, 'ai.question_generator');
  assert.equal(response.override.enabled, true);
});

test('removeOverride forwards the feature key', async () => {
  let received: { featureKey: string } | undefined;
  const { tenants } = createControllers({
    entitlements: {
      removeFeatureOverride: async (command) => {
        received = command;
      },
    },
  });
  await tenants.removeOverride({ tenantId: TENANT_ID, featureKey: 'ai.question_generator' });
  assert.deepEqual(received, { featureKey: 'ai.question_generator' });
});

test('checkFeature returns the decision view', async () => {
  const { tenants } = createControllers();
  const response = await tenants.checkFeature({ tenantId: TENANT_ID }, { featureKey: 'ai.question_generator' });
  assert.equal(response.decision.allowed, true);
  assert.equal(response.decision.reason, 'allowed');
  assert.equal(response.decision.source, 'plan');
});

test('checkQuota returns the availability view', async () => {
  const { tenants } = createControllers();
  const response = await tenants.checkQuota({ tenantId: TENANT_ID, quotaKey: 'ai_requests_monthly' });
  assert.equal(response.quota.limit, 100);
  assert.equal(response.quota.available, 100);
});

test('reserveQuota returns the reservation view', async () => {
  let received: { quotaKey: string; amount: number; operationId: string | null } | undefined;
  const { tenants } = createControllers({
    evaluation: {
      reserveUsage: async (command) => {
        received = command;
        return createReservation({ quotaKey: command.quotaKey, amount: command.amount });
      },
    },
  });
  const response = await tenants.reserveQuota({ tenantId: TENANT_ID, quotaKey: 'ai_requests_monthly' }, { amount: 25, operationId: 'op-1' });
  assert.deepEqual(received, { quotaKey: 'ai_requests_monthly', amount: 25, operationId: 'op-1' });
  assert.equal(response.reservation.amount, 25);
});

test('releaseQuota forwards the reservation id', async () => {
  const reservationId = randomUUID();
  let received: { reservationId: string } | undefined;
  const { tenants } = createControllers({
    evaluation: {
      releaseReservation: async (command) => {
        received = command;
      },
    },
  });
  await tenants.releaseQuota({ tenantId: TENANT_ID, quotaKey: 'ai_requests_monthly' }, { reservationId });
  assert.deepEqual(received, { reservationId });
});

test('listUsage returns the meters page', async () => {
  const { tenants } = createControllers();
  const response = await tenants.listUsage({ tenantId: TENANT_ID }, { limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.quotaKey, 'ai_requests_monthly');
  assert.equal(response.items[0]?.kind, 'reserved');
});
