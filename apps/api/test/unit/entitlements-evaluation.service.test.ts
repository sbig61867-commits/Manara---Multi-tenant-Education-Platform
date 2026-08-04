import assert from 'node:assert/strict';
import test from 'node:test';
import { EntitlementEvaluationService } from '../../src/entitlements/application/entitlement-evaluation.service.js';
import {
  InvalidReservationOperationError,
  MissingTenantContextError,
  NegativeUsageError,
  PlanVersionNotFoundError,
  QuotaDimensionNotFoundError,
  QuotaExceededError,
  ReservationNotFoundError,
  TenantContextMismatchError,
} from '../../src/entitlements/domain/errors.js';
import type { FeatureEntitlement } from '../../src/entitlements/domain/types.js';
import {
  createAssignment,
  createFeatureDefinition,
  createFeatureEntitlement,
  createPlan,
  createQuota,
  FakeEntitlementsContextResolver,
  FakeFeatureDefinitionRepository,
  FakePlanRepository,
  FakeTenantEntitlementRepository,
  FakeUsageMeterRepository,
  FakeUsageQuotaRepository,
  ImmediateEntitlementsTransactionRunner,
  RecordingEntitlementEventPublisher,
} from './entitlements-helpers.js';

const TENANT = 'tenant-1';

function createServices(tenantId: string | null = TENANT): {
  plans: FakePlanRepository;
  features: FakeFeatureDefinitionRepository;
  tenantState: FakeTenantEntitlementRepository;
  quotas: FakeUsageQuotaRepository;
  meters: FakeUsageMeterRepository;
  events: RecordingEntitlementEventPublisher;
  service: EntitlementEvaluationService;
} {
  const plans = new FakePlanRepository();
  const features = new FakeFeatureDefinitionRepository();
  const tenantState = new FakeTenantEntitlementRepository();
  const quotas = new FakeUsageQuotaRepository();
  const meters = new FakeUsageMeterRepository();
  const events = new RecordingEntitlementEventPublisher();
  const service = new EntitlementEvaluationService(
    plans,
    features,
    tenantState,
    quotas,
    meters,
    new ImmediateEntitlementsTransactionRunner(),
    events,
    new FakeEntitlementsContextResolver(tenantId),
  );
  return { plans, features, tenantState, quotas, meters, events, service };
}

async function seedEntitledTenant(
  ctx: ReturnType<typeof createServices>,
  options?: {
    tenantId?: string;
    hardRestricted?: string[];
    entitlements?: FeatureEntitlement[];
  },
): Promise<void> {
  const tenantId = options?.tenantId ?? TENANT;
  const plan = createPlan({ name: 'Professional' });
  await ctx.plans.create({ ...plan, currentVersionId: 'version-1' });
  await ctx.plans.createVersion({
    id: 'version-1',
    planId: plan.id,
    version: 1,
    label: null,
    status: 'active',
    effectiveFrom: new Date(),
    createdAt: new Date(),
    activatedAt: new Date(),
  });
  const entitlements =
    options?.entitlements ??
    [
      createFeatureEntitlement({
        featureKey: 'ai.question_generator',
        enabled: true,
        quotaKey: 'ai_requests_monthly',
        quotaLimit: 100,
      }),
      createFeatureEntitlement({ featureKey: 'reports.export', enabled: false }),
    ];
  await ctx.plans.saveFeatureEntitlements('version-1', entitlements);
  for (const entitlement of entitlements) {
    await ctx.features.create(
      createFeatureDefinition({
        key: entitlement.featureKey,
        hardRestriction: options?.hardRestricted?.includes(entitlement.featureKey)
          ? 'blocked'
          : 'none',
      }),
    );
  }
  await ctx.tenantState.createAssignment(
    createAssignment({ tenantId, planId: plan.id, planVersionId: 'version-1' }),
  );
}

test('resolves an empty snapshot when the tenant is unassigned', async () => {
  const { service } = createServices();
  const snapshot = await service.resolveTenantSnapshot();
  assert.equal(snapshot.planId, null);
  assert.deepEqual(snapshot.featureFlags, {});
  assert.deepEqual(snapshot.quotaLimits, {});
});

test('resolveTenantSnapshot fails when the current plan version is missing', async () => {
  const { plans, tenantState, service } = createServices();
  const plan = createPlan({ name: 'Broken' });
  await plans.create({ ...plan, currentVersionId: 'version-missing' });
  await tenantState.createAssignment(
    createAssignment({ planId: plan.id, planVersionId: 'version-missing' }),
  );
  await assert.rejects(service.resolveTenantSnapshot(), PlanVersionNotFoundError);
});

test('resolveTenantSnapshot produces sorted flags regardless of storage order', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx, {
    entitlements: [
      createFeatureEntitlement({ featureKey: 'zebra.sync', enabled: true }),
      createFeatureEntitlement({ featureKey: 'alpha.flow', enabled: true }),
      createFeatureEntitlement({ featureKey: 'mike.flow', enabled: true }),
    ],
  });
  const snapshot = await ctx.service.resolveTenantSnapshot();
  assert.deepEqual(Object.keys(snapshot.featureFlags), ['alpha.flow', 'mike.flow', 'zebra.sync']);
});

test('resolveTenantSnapshot forces hard-restricted features off and excludes their quotas', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx, { hardRestricted: ['ai.question_generator'] });
  const snapshot = await ctx.service.resolveTenantSnapshot();
  assert.equal(snapshot.featureFlags['ai.question_generator'], false);
  assert.equal('ai_requests_monthly' in snapshot.quotaLimits, false);
  assert.equal(snapshot.featureFlags['reports.export'], false);
});

test('resolveTenantSnapshot applies tenant overrides', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.tenantState.upsertOverride({
    tenantId: TENANT,
    featureKey: 'reports.export',
    enabled: true,
    updatedAt: new Date(),
  });
  const snapshot = await ctx.service.resolveTenantSnapshot();
  assert.equal(snapshot.featureFlags['ai.question_generator'], true);
  assert.equal(snapshot.featureFlags['reports.export'], true);
  assert.equal(snapshot.quotaLimits['ai_requests_monthly'], 100);
});

test('evaluateFeature denies hard-restricted features even when entitled', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx, { hardRestricted: ['ai.question_generator'] });
  const decision = await ctx.service.evaluateFeature({ featureKey: 'ai.question_generator' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_hard_restricted');
  assert.equal(decision.source, null);
});

test('evaluateFeature denies unassigned tenants by default', async () => {
  const { service } = createServices();
  const decision = await service.evaluateFeature({ featureKey: 'ai.question_generator' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_no_entitlement');
});

test('evaluateFeature allows an enabled plan feature with plan source', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const decision = await ctx.service.evaluateFeature({ featureKey: 'ai.question_generator' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'allowed');
  assert.equal(decision.source, 'plan');
});

test('evaluateFeature denies a disabled plan feature', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const decision = await ctx.service.evaluateFeature({ featureKey: 'reports.export' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_no_entitlement');
});

test('evaluateFeature denies when a tenant override disables the feature', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.tenantState.upsertOverride({
    tenantId: TENANT,
    featureKey: 'ai.question_generator',
    enabled: false,
    updatedAt: new Date(),
  });
  const decision = await ctx.service.evaluateFeature({ featureKey: 'ai.question_generator' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_no_entitlement');
  assert.equal(decision.source, null);
});

test('evaluateFeature allows when a tenant override enables the feature', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.tenantState.upsertOverride({
    tenantId: TENANT,
    featureKey: 'reports.export',
    enabled: true,
    updatedAt: new Date(),
  });
  const decision = await ctx.service.evaluateFeature({ featureKey: 'reports.export' });
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'override');
});

test('evaluateFeature fails closed without tenant context', async () => {
  const { service } = createServices(null);
  await assert.rejects(service.evaluateFeature({ featureKey: 'x' }), MissingTenantContextError);
});

test('checkQuotaAvailability rejects quota dimensions outside the snapshot', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await assert.rejects(
    ctx.service.checkQuotaAvailability({ quotaKey: 'storage_gb' }),
    QuotaDimensionNotFoundError,
  );
});

test('checkQuotaAvailability reports unlimited quotas as null', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx, {
    entitlements: [
      createFeatureEntitlement({
        featureKey: 'files.storage',
        enabled: true,
        quotaKey: 'storage_gb',
        quotaLimit: null,
      }),
    ],
  });
  const availability = await ctx.service.checkQuotaAvailability({ quotaKey: 'storage_gb' });
  assert.equal(availability.limit, null);
  assert.equal(availability.available, null);
});

test('checkQuotaAvailability computes available as the remaining headroom', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.quotas.create(createQuota({ consumed: 30, reserved: 20 }));
  const availability = await ctx.service.checkQuotaAvailability({ quotaKey: 'ai_requests_monthly' });
  assert.equal(availability.limit, 100);
  assert.equal(availability.consumed, 30);
  assert.equal(availability.reserved, 20);
  assert.equal(availability.available, 50);
});

test('checkQuotaAvailability floors availability at zero', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.quotas.create(createQuota({ consumed: 100, reserved: 10 }));
  const availability = await ctx.service.checkQuotaAvailability({ quotaKey: 'ai_requests_monthly' });
  assert.equal(availability.available, 0);
});

test('recordUsage fails closed without tenant context', async () => {
  const { service } = createServices(null);
  await assert.rejects(
    service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 5 }),
    MissingTenantContextError,
  );
});

test('recordUsage rejects non-positive amounts', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await assert.rejects(
    ctx.service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 0 }),
    NegativeUsageError,
  );
  await assert.rejects(
    ctx.service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: -5 }),
    NegativeUsageError,
  );
});

test('recordUsage creates the quota on first use and meters consumption', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 10, operationId: 'op-1' });
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.ok(quota !== null);
  assert.equal(quota.consumed, 10);
  assert.equal(quota.limit, 100);
  const meters = await ctx.meters.listByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(meters.length, 1);
  assert.equal(meters[0].kind, 'consumed');
  assert.equal(meters[0].operationId, 'op-1');
  const recorded = ctx.events.eventsOfType('entitlement.usage.recorded');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, 'consumed');
});

test('recordUsage rejects usage beyond the quota limit', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.quotas.create(createQuota({ consumed: 95 }));
  await assert.rejects(
    ctx.service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 10 }),
    QuotaExceededError,
  );
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.consumed, 95);
  const exceeded = ctx.events.eventsOfType('entitlement.quota.exceeded');
  assert.equal(exceeded.length, 1);
  assert.equal(exceeded[0].requested, 10);
  assert.equal(exceeded[0].available, 5);
});

test('recordUsage rolls over an expired monthly window', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const expired = createQuota({
    consumed: 90,
    reserved: 5,
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-01-31'),
  });
  await ctx.quotas.create(expired);
  await ctx.service.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 10 });
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.consumed, 10);
  assert.equal(quota?.reserved, 0);
  assert.ok(quota !== null && quota.periodEnd.getTime() > Date.now());
});

test('reserveUsage reserves capacity and records a reserved meter', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const reservation = await ctx.service.reserveUsage({
    quotaKey: 'ai_requests_monthly',
    amount: 25,
    operationId: 'op-2',
  });
  assert.equal(reservation.quotaKey, 'ai_requests_monthly');
  assert.equal(reservation.tenantId, TENANT);
  assert.equal(reservation.amount, 25);
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.reserved, 25);
  const meter = await ctx.meters.findById(reservation.reservationId);
  assert.ok(meter !== null);
  assert.equal(meter.kind, 'reserved');
  assert.equal(meter.operationId, 'op-2');
  const recorded = ctx.events.eventsOfType('entitlement.usage.recorded');
  assert.equal(recorded.some((event) => event.kind === 'reserved'), true);
});

test('reserveUsage prevents oversubscription', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await ctx.quotas.create(createQuota({ consumed: 80, reserved: 15 }));
  await assert.rejects(
    ctx.service.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 10 }),
    QuotaExceededError,
  );
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.consumed, 80);
  assert.equal(quota?.reserved, 15);
  assert.equal(ctx.meters.meters.size, 0);
  assert.equal(ctx.events.eventsOfType('entitlement.quota.exceeded').length, 1);
});

test('commitReservation moves reserved usage to consumed', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const reservation = await ctx.service.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 25 });
  await ctx.service.commitReservation({ reservationId: reservation.reservationId });
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.consumed, 25);
  assert.equal(quota?.reserved, 0);
  const meter = await ctx.meters.findById(reservation.reservationId);
  assert.equal(meter?.kind, 'committed');
  const recorded = ctx.events.eventsOfType('entitlement.usage.recorded');
  assert.equal(recorded.some((event) => event.kind === 'committed'), true);
});

test('commitReservation rejects unknown reservations', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  await assert.rejects(
    ctx.service.commitReservation({ reservationId: 'missing' }),
    ReservationNotFoundError,
  );
});

test('commitReservation denies reservations from another tenant', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const reservation = await ctx.service.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 5 });
  const other = new EntitlementEvaluationService(
    ctx.plans,
    ctx.features,
    ctx.tenantState,
    ctx.quotas,
    ctx.meters,
    new ImmediateEntitlementsTransactionRunner(),
    ctx.events,
    new FakeEntitlementsContextResolver('tenant-2'),
  );
  await assert.rejects(
    other.commitReservation({ reservationId: reservation.reservationId }),
    TenantContextMismatchError,
  );
});

test('commitReservation rejects reservations that were already committed', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const reservation = await ctx.service.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 5 });
  await ctx.service.commitReservation({ reservationId: reservation.reservationId });
  await assert.rejects(
    ctx.service.commitReservation({ reservationId: reservation.reservationId }),
    InvalidReservationOperationError,
  );
});

test('releaseReservation returns reserved capacity and marks the meter released', async () => {
  const ctx = createServices();
  await seedEntitledTenant(ctx);
  const reservation = await ctx.service.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 25 });
  await ctx.service.releaseReservation({ reservationId: reservation.reservationId });
  const quota = await ctx.quotas.findByTenantAndKey(TENANT, 'ai_requests_monthly');
  assert.equal(quota?.reserved, 0);
  assert.equal(quota?.consumed, 0);
  const meter = await ctx.meters.findById(reservation.reservationId);
  assert.equal(meter?.kind, 'released');
  const recorded = ctx.events.eventsOfType('entitlement.usage.recorded');
  assert.equal(recorded.some((event) => event.kind === 'released'), true);
});
