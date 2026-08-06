import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { AlsEntitlementsContextResolver } from '../../src/entitlements/adapters/als-entitlements-context.resolver.js';
import { PostgresFeatureDefinitionRepository } from '../../src/entitlements/adapters/postgres-feature-definition.repository.js';
import { PostgresPlanRepository } from '../../src/entitlements/adapters/postgres-plan.repository.js';
import { PostgresTenantEntitlementRepository } from '../../src/entitlements/adapters/postgres-tenant-entitlement.repository.js';
import { PostgresEntitlementsTransactionRunner } from '../../src/entitlements/adapters/postgres-transaction-runner.js';
import { PostgresUsageMeterRepository } from '../../src/entitlements/adapters/postgres-usage-meter.repository.js';
import { PostgresUsageQuotaRepository } from '../../src/entitlements/adapters/postgres-usage-quota.repository.js';
import { EntitlementEvaluationService } from '../../src/entitlements/application/entitlement-evaluation.service.js';
import { FeatureCatalogService } from '../../src/entitlements/application/feature-catalog.service.js';
import { PlanCatalogService } from '../../src/entitlements/application/plan-catalog.service.js';
import { TenantEntitlementService } from '../../src/entitlements/application/tenant-entitlement.service.js';
import {
  FeatureHardRestrictedError,
  InvalidReservationOperationError,
  QuotaExceededError,
  ReservationNotFoundError,
  TenantAlreadyAssignedError,
  TenantContextMismatchError,
} from '../../src/entitlements/domain/errors.js';
import { NoopEntitlementEventPublisher } from '../../src/entitlements/domain/events.js';
import type { UsageMeter } from '../../src/entitlements/domain/types.js';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

function isPgErrorCode(error: unknown, code: string): boolean {
  return (error as { code?: string }).code === code;
}

function assertRejectedWith<T>(
  result: PromiseSettledResult<T>,
  errorType: new (...args: never[]) => Error,
): void {
  assert.equal(result.status, 'rejected');
  assert.ok(result.reason instanceof errorType);
}

describe('entitlements persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let tenantA = '';
  let tenantB = '';
  let userA = '';
  let userB = '';

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query(
      'TRUNCATE TABLE plans, plan_versions, feature_definitions, feature_entitlements, tenant_plan_assignments, tenant_feature_overrides, usage_quotas, usage_meters CASCADE',
    );
    tenantA = randomUUID();
    tenantB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    await database.query(
      'INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)',
      [userA, `ent-user-a-${randomUUID()}@test.local`, userB, `ent-user-b-${randomUUID()}@test.local`],
    );
    await database.query(
      'INSERT INTO institutions (id, name, type, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        tenantA,
        'Entitlements University A',
        'university',
        'active',
        userA,
        tenantB,
        'Entitlements University B',
        'university',
        'active',
        userB,
      ],
    );
  });

  beforeEach(async () => {
    const db = requireDb();
    await db.query(
      'TRUNCATE TABLE plans, plan_versions, feature_definitions, feature_entitlements, tenant_plan_assignments, tenant_feature_overrides, usage_quotas, usage_meters CASCADE',
    );
  });

  after(async () => {
    if (database) {
      try {
        await database.query(
          'TRUNCATE TABLE plans, plan_versions, feature_definitions, feature_entitlements, tenant_plan_assignments, tenant_feature_overrides, usage_quotas, usage_meters CASCADE',
        );
      } finally {
        await database.close();
      }
    }
  });

  function requireDb(): PostgresDatabase {
    if (database === undefined) {
      throw new Error('before hook did not create the database');
    }
    return database;
  }

  function createServices(db: PostgresDatabase): {
    plans: PostgresPlanRepository;
    features: PostgresFeatureDefinitionRepository;
    tenantState: PostgresTenantEntitlementRepository;
    quotas: PostgresUsageQuotaRepository;
    meters: PostgresUsageMeterRepository;
    context: AlsEntitlementsContextResolver;
    catalog: PlanCatalogService;
    featureCatalog: FeatureCatalogService;
    tenantService: TenantEntitlementService;
    evaluation: EntitlementEvaluationService;
  } {
    const plans = new PostgresPlanRepository(db);
    const features = new PostgresFeatureDefinitionRepository(db);
    const tenantState = new PostgresTenantEntitlementRepository(db);
    const quotas = new PostgresUsageQuotaRepository(db);
    const meters = new PostgresUsageMeterRepository(db);
    const context = new AlsEntitlementsContextResolver();
    const events = new NoopEntitlementEventPublisher();
    const transactionRunner = new PostgresEntitlementsTransactionRunner(db);
    const catalog = new PlanCatalogService(plans, features, events);
    const featureCatalog = new FeatureCatalogService(features, events);
    const tenantService = new TenantEntitlementService(plans, features, tenantState, events, context);
    const evaluation = new EntitlementEvaluationService(
      plans,
      features,
      tenantState,
      quotas,
      meters,
      transactionRunner,
      events,
      context,
    );
    return {
      plans,
      features,
      tenantState,
      quotas,
      meters,
      context,
      catalog,
      featureCatalog,
      tenantService,
      evaluation,
    };
  }

  async function seedEntitledTenant(
    db: PostgresDatabase,
    options?: {
      tenantId?: string;
      featureKey?: string;
      quotaLimit?: number;
      overridable?: boolean;
    },
  ): Promise<{ planId: string; versionId: string; featureKey: string }> {
    const ctx = createServices(db);
    const tenantId = options?.tenantId ?? tenantA;
    const featureKey = options?.featureKey ?? `ai.question_generator_${randomUUID().slice(0, 8)}`;
    await ctx.featureCatalog.createFeatureDefinition({ key: featureKey, name: `Feature ${featureKey}` });
    const plan = await ctx.catalog.createPlan({ name: `Plan ${randomUUID().slice(0, 8)}` });
    await ctx.catalog.createPlanVersion({
      planId: plan.id,
      features: [
        {
          featureKey,
          enabled: true,
          overridable: options?.overridable ?? true,
          quotaKey: 'ai_requests_monthly',
          quotaLimit: options?.quotaLimit ?? 100,
        },
      ],
    });
    const version = (await ctx.catalog.listPlanVersions(plan.id))[0] as { id: string };
    await ctx.catalog.activatePlanVersion({ planId: plan.id, versionId: version.id });
    await AlsEntitlementsContextResolver.runWithTenant(tenantId, () =>
      ctx.tenantService.assignPlanToTenant({ planId: plan.id, assignedByUserId: userA }),
    );
    return { planId: plan.id, versionId: version.id, featureKey };
  }

  test('entitlements migration creates the expected tables', async () => {
    const db = requireDb();
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('plans', 'plan_versions', 'feature_definitions', 'feature_entitlements', 'tenant_plan_assignments', 'tenant_feature_overrides', 'usage_quotas', 'usage_meters')`,
    );
    const names = result.rows.map((row) => row.table_name).sort();
    assert.deepEqual(names, [
      'feature_definitions',
      'feature_entitlements',
      'plan_versions',
      'plans',
      'tenant_feature_overrides',
      'tenant_plan_assignments',
      'usage_meters',
      'usage_quotas',
    ]);
  });

  test('tenant-scoped indexes lead with tenant_id and catalog uniqueness constraints exist', async () => {
    const db = requireDb();

    const assignmentIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tenant_plan_assignments'`,
    );
    const activeIndex = assignmentIndexes.rows.find(
      (row) => row.indexname === 'tenant_plan_assignments_tenant_id_active_key',
    );
    assert.ok(activeIndex);
    assert.match(activeIndex.indexdef, /UNIQUE INDEX/);
    assert.match(activeIndex.indexdef, /USING btree \(tenant_id\) WHERE \(status = 'active'::text\)/);
    const tenantIndex = assignmentIndexes.rows.find(
      (row) => row.indexname === 'tenant_plan_assignments_tenant_id_idx',
    );
    assert.ok(tenantIndex);
    assert.match(tenantIndex.indexdef, /USING btree \(tenant_id\)/);

    const overrideIndexes = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tenant_feature_overrides'`,
    );
    assert.ok(overrideIndexes.rows.some((row) => /btree \(tenant_id, feature_key\)/.test(row.indexdef)));

    const quotaIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'usage_quotas'`,
    );
    const quotaUnique = quotaIndexes.rows.find(
      (row) => row.indexname === 'usage_quotas_tenant_id_quota_key_key',
    );
    assert.ok(quotaUnique);
    assert.match(quotaUnique.indexdef, /UNIQUE INDEX/);
    assert.match(quotaUnique.indexdef, /USING btree \(tenant_id, quota_key\)/);

    const meterIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'usage_meters'`,
    );
    const meterTenantKey = meterIndexes.rows.find(
      (row) => row.indexname === 'usage_meters_tenant_id_quota_key_idx',
    );
    assert.ok(meterTenantKey);
    assert.match(meterTenantKey.indexdef, /USING btree \(tenant_id, quota_key\)/);

    const catalogUniques = await db.query<{ constraint_name: string; table_name: string }>(
      `SELECT constraint_name, table_name FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND constraint_type = 'UNIQUE'
         AND table_name IN ('plans', 'plan_versions', 'feature_definitions')`,
    );
    assert.ok(catalogUniques.rows.some((row) => row.constraint_name === 'plans_name_key'));
    assert.ok(
      catalogUniques.rows.some((row) => row.constraint_name === 'plan_versions_plan_id_version_key'),
    );
    assert.ok(
      catalogUniques.rows.some((row) => row.constraint_name === 'feature_definitions_key_key'),
    );
  });

  test('activated plan versions are immutable at the database level', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    const featureKey = `immutable.${randomUUID().slice(0, 8)}`;
    await ctx.featureCatalog.createFeatureDefinition({ key: featureKey, name: featureKey });
    const plan = await ctx.catalog.createPlan({ name: `Immutable ${randomUUID().slice(0, 8)}` });
    await ctx.catalog.createPlanVersion({ planId: plan.id, features: [{ featureKey, enabled: true }] });
    const version = (await ctx.catalog.listPlanVersions(plan.id))[0] as { id: string };
    await ctx.catalog.activatePlanVersion({ planId: plan.id, versionId: version.id });
    await assert.rejects(
      db.query('UPDATE plan_versions SET label = $2 WHERE id = $1', [version.id, 'tampered']),
      (error: unknown) =>
        (error as Error).message.includes('activated plan versions are immutable'),
    );
    await assert.rejects(
      db.query('DELETE FROM plan_versions WHERE id = $1', [version.id]),
      (error: unknown) =>
        (error as Error).message.includes('activated plan versions are immutable'),
    );
  });

  test('a plan created through the service persists and is readable', async () => {
    const db = requireDb();
    const { catalog, plans } = createServices(db);
    const created = await catalog.createPlan({ name: `Persistence ${randomUUID().slice(0, 8)}` });
    const read = await plans.findById(created.id);
    assert.ok(read);
    assert.equal(read?.name, created.name);
    assert.equal(read?.status, 'active');
    assert.equal(read?.currentVersionId, null);
    const found = await plans.findByName(created.name);
    assert.equal(found?.id, created.id);
  });

  test('plan versions and feature entitlements persist', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    const featureKey = `versions.${randomUUID().slice(0, 8)}`;
    await ctx.featureCatalog.createFeatureDefinition({ key: featureKey, name: featureKey });
    const plan = await ctx.catalog.createPlan({ name: `Versions ${randomUUID().slice(0, 8)}` });
    await ctx.catalog.createPlanVersion({
      planId: plan.id,
      features: [
        { featureKey, enabled: true, quotaKey: 'ai_requests_monthly', quotaLimit: 500 },
      ],
    });
    const versions = await ctx.plans.listVersionsByPlanId(plan.id);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.version, 1);
    const entitlements = await ctx.plans.listFeatureEntitlementsByVersion(versions[0]?.id as string);
    assert.equal(entitlements.length, 1);
    assert.equal(entitlements[0]?.featureKey, featureKey);
    assert.equal(entitlements[0]?.quotaLimit, 500);
  });

  test('feature definitions are globally unique at the database level', async () => {
    const db = requireDb();
    const key = `duplicate.${randomUUID().slice(0, 8)}`;
    const { featureCatalog } = createServices(db);
    await featureCatalog.createFeatureDefinition({ key, name: key });
    await assert.rejects(
      db.query(
        `INSERT INTO feature_definitions (id, key, name, description, category, hard_restriction, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, NULL, 'none', now(), now())`,
        [randomUUID(), key, key],
      ),
      (error: unknown) => isPgErrorCode(error, '23505'),
    );
  });

  test('tenant plan assignment persists and is unique per tenant', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    const { planId } = await seedEntitledTenant(db);
    const assignment = await ctx.tenantState.findActiveAssignmentByTenant(tenantA);
    assert.ok(assignment);
    assert.equal(assignment?.planId, planId);
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.tenantService.assignPlanToTenant({ planId }),
        ),
      (error: unknown) => error instanceof TenantAlreadyAssignedError,
    );
    await assert.rejects(
      db.query(
        `INSERT INTO tenant_plan_assignments (id, tenant_id, plan_id, plan_version_id, status, assigned_at)
         VALUES ($1, $2, $3, $4, 'active', now())`,
         [randomUUID(), tenantA, planId, planId],
      ),
      (error: unknown) => isPgErrorCode(error, '23505'),
    );
  });

  test('feature overrides persist and cannot bypass hard restrictions', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    const blockedKey = `blocked.${randomUUID().slice(0, 8)}`;
    await ctx.featureCatalog.createFeatureDefinition({
      key: blockedKey,
      name: blockedKey,
      hardRestriction: 'blocked',
    });
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.tenantService.applyFeatureOverride({ featureKey: blockedKey, enabled: true }),
        ),
      (error: unknown) => error instanceof FeatureHardRestrictedError,
    );
    const { featureKey } = await seedEntitledTenant(db);
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.tenantService.applyFeatureOverride({ featureKey, enabled: false }),
    );
    const override = await ctx.tenantState.findOverride(tenantA, featureKey);
    assert.ok(override);
    assert.equal(override?.enabled, false);
    const decision = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.evaluateFeature({ featureKey }),
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'denied_no_entitlement');
  });

  test('usage quota counters persist through the service', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 10, operationId: 'op-1' }),
    );
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.ok(quota);
    assert.equal(quota?.consumed, 10);
    assert.equal(quota?.reserved, 0);
    assert.equal(quota?.limit, 100);
    const meters = await ctx.meters.listByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(meters.length, 1);
    assert.equal(meters[0]?.kind, 'consumed');
    assert.equal(meters[0]?.operationId, 'op-1');
    const listed = await ctx.quotas.listByTenant(tenantA);
    assert.ok(listed.some((item) => item.quotaKey === 'ai_requests_monthly'));
  });

  test('usage beyond the quota limit is rejected and leaves no partial state', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db, { quotaLimit: 10 });
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 9 }),
    );
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 2 }),
        ),
      (error: unknown) => error instanceof QuotaExceededError,
    );
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota?.consumed, 9);
    const meters = await ctx.meters.listByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(meters.length, 1);
  });

  test('usage reservations persist and commit atomically', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 25, operationId: 'op-2' }),
    );
    const reservedMeter = await ctx.meters.findById(reservation.reservationId);
    assert.ok(reservedMeter);
    assert.equal(reservedMeter?.kind, 'reserved');
    assert.equal(reservedMeter?.operationId, 'op-2');
    let quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota?.reserved, 25);
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.commitReservation({ reservationId: reservation.reservationId }),
    );
    quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota?.consumed, 25);
    assert.equal(quota?.reserved, 0);
    const committedMeter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(committedMeter?.kind, 'committed');
  });

  test('usage release persists and returns reserved capacity', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 25 }),
    );
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.releaseReservation({ reservationId: reservation.reservationId }),
    );
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota?.reserved, 0);
    assert.equal(quota?.consumed, 0);
    const releasedMeter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(releasedMeter?.kind, 'released');
  });

  test('a release with missing quota state fails without partial writes', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 10 }),
    );
    await db.query('DELETE FROM usage_quotas WHERE tenant_id = $1 AND quota_key = $2', [
      tenantA,
      'ai_requests_monthly',
    ]);
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.releaseReservation({ reservationId: reservation.reservationId }),
        ),
      (error: unknown) => error instanceof ReservationNotFoundError,
    );
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(meter?.kind, 'reserved');
  });

  test('a failed transaction rolls back and leaves no leaked reservations', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const now = new Date();
    const reservationId = randomUUID();
    await assert.rejects(
      db.withTransaction(async () => {
        await ctx.quotas.create({
          id: randomUUID(),
          tenantId: tenantA,
          quotaKey: 'ai_requests_monthly',
          period: 'monthly',
          limit: 100,
          consumed: 0,
          reserved: 10,
          periodStart: now,
          periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          updatedAt: now,
        });
        await ctx.meters.record({
          id: reservationId,
          tenantId: tenantA,
          quotaKey: 'ai_requests_monthly',
          amount: 10,
          kind: 'reserved',
          operationId: null,
          recordedAt: now,
        });
        throw new Error('boom');
      }),
    );
    assert.equal(await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly'), null);
    assert.equal(await ctx.meters.findById(reservationId), null);
  });

  test('cross-tenant reservation operations are rejected and leave state intact', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 20 }),
    );
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantB, () =>
          ctx.evaluation.commitReservation({ reservationId: reservation.reservationId }),
        ),
      (error: unknown) => error instanceof TenantContextMismatchError,
    );
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota?.reserved, 20);
    assert.equal(quota?.consumed, 0);
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(meter?.kind, 'reserved');
  });

  test('concurrent reservations against an existing quota never exceed the limit', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db, { quotaLimit: 100 });
    const now = new Date();
    await ctx.quotas.create({
      id: randomUUID(),
      tenantId: tenantA,
      quotaKey: 'ai_requests_monthly',
      period: 'monthly',
      limit: 100,
      consumed: 0,
      reserved: 0,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.reserveUsage({
            quotaKey: 'ai_requests_monthly',
            amount: 60,
            operationId: `reserve-existing-${index}`,
          }),
        ),
      ),
    );

    const successful = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);
    for (const result of rejected) {
      assertRejectedWith(result, QuotaExceededError);
    }
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meters = await ctx.meters.listByTenantAndKey(tenantA, 'ai_requests_monthly');
    const reservedMeterTotal = meters
      .filter((meter) => meter.kind === 'reserved')
      .reduce((total, meter) => total + meter.amount, 0);
    assert.equal(quota?.reserved, 60);
    assert.equal(quota?.consumed, 0);
    assert.ok((quota?.reserved ?? 0) + (quota?.consumed ?? 0) <= 100);
    assert.equal(reservedMeterTotal, quota?.reserved);
  });

  test('concurrent first-use reservations create one quota row and never leak unique conflicts', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db, { quotaLimit: 100 });

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.reserveUsage({
            quotaKey: 'ai_requests_monthly',
            amount: 60,
            operationId: `reserve-first-use-${index}`,
          }),
        ),
      ),
    );

    const successful = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);
    for (const result of rejected) {
      assertRejectedWith(result, QuotaExceededError);
    }
    const quotaRows = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM usage_quotas WHERE tenant_id = $1 AND quota_key = $2',
      [tenantA, 'ai_requests_monthly'],
    );
    assert.equal(Number(quotaRows.rows[0]?.count), 1);
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meters = await ctx.meters.listByTenantAndKey(tenantA, 'ai_requests_monthly');
    const reservedMeterTotal = meters
      .filter((meter) => meter.kind === 'reserved')
      .reduce((total, meter) => total + meter.amount, 0);
    assert.equal(quota?.reserved, 60);
    assert.ok((quota?.reserved ?? 0) + (quota?.consumed ?? 0) <= 100);
    assert.equal(reservedMeterTotal, quota?.reserved);
  });

  test('concurrent recordUsage operations never consume beyond the limit', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db, { quotaLimit: 100 });
    const now = new Date();
    await ctx.quotas.create({
      id: randomUUID(),
      tenantId: tenantA,
      quotaKey: 'ai_requests_monthly',
      period: 'monthly',
      limit: 100,
      consumed: 0,
      reserved: 0,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.recordUsage({
            quotaKey: 'ai_requests_monthly',
            amount: 60,
            operationId: `record-${index}`,
          }),
        ),
      ),
    );

    const successful = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);
    for (const result of rejected) {
      assertRejectedWith(result, QuotaExceededError);
    }
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meters = await ctx.meters.listByTenantAndKey(tenantA, 'ai_requests_monthly');
    const consumedMeterTotal = meters
      .filter((meter) => meter.kind === 'consumed')
      .reduce((total, meter) => total + meter.amount, 0);
    assert.equal(quota?.consumed, 60);
    assert.equal(quota?.reserved, 0);
    assert.ok((quota?.reserved ?? 0) + (quota?.consumed ?? 0) <= 100);
    assert.equal(consumedMeterTotal, quota?.consumed);
  });

  test('concurrent commit of the same reservation applies exactly once', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 30 }),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.commitReservation({ reservationId: reservation.reservationId }),
        ),
      ),
    );

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assertRejectedWith(rejected[0] as PromiseRejectedResult, InvalidReservationOperationError);
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(quota?.consumed, 30);
    assert.equal(quota?.reserved, 0);
    assert.equal(meter?.kind, 'committed');
  });

  test('concurrent release of the same reservation applies exactly once', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 30 }),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          ctx.evaluation.releaseReservation({ reservationId: reservation.reservationId }),
        ),
      ),
    );

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assertRejectedWith(rejected[0] as PromiseRejectedResult, InvalidReservationOperationError);
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(quota?.consumed, 0);
    assert.equal(quota?.reserved, 0);
    assert.equal(meter?.kind, 'released');
  });

  test('commit versus release race leaves one terminal transition and consistent counters', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 30 }),
    );

    const results = await Promise.allSettled([
      AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
        ctx.evaluation.commitReservation({ reservationId: reservation.reservationId }),
      ),
      AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
        ctx.evaluation.releaseReservation({ reservationId: reservation.reservationId }),
      ),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assertRejectedWith(rejected[0] as PromiseRejectedResult, InvalidReservationOperationError);
    const quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(quota?.reserved, 0);
    assert.ok(quota?.consumed === 0 || quota?.consumed === 30);
    assert.ok(meter?.kind === 'committed' || meter?.kind === 'released');
    assert.equal(meter?.kind === 'committed' ? 30 : 0, quota?.consumed);
  });

  test('quota counters roll back when meter insert or update fails', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    await seedEntitledTenant(db);
    const transactionRunner = new PostgresEntitlementsTransactionRunner(db);

    class FailingRecordUsageMeterRepository extends PostgresUsageMeterRepository {
      override async record(_meter: UsageMeter): Promise<void> {
        throw new Error('meter insert failed');
      }
    }

    const failingRecordService = new EntitlementEvaluationService(
      ctx.plans,
      ctx.features,
      ctx.tenantState,
      ctx.quotas,
      new FailingRecordUsageMeterRepository(db),
      transactionRunner,
      new NoopEntitlementEventPublisher(),
      ctx.context,
    );
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          failingRecordService.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 20 }),
        ),
      /meter insert failed/,
    );
    let quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    assert.equal(quota, null);

    const reservation = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.reserveUsage({ quotaKey: 'ai_requests_monthly', amount: 20 }),
    );

    class FailingUpdateUsageMeterRepository extends PostgresUsageMeterRepository {
      override async update(_meter: UsageMeter): Promise<void> {
        throw new Error('meter update failed');
      }
    }

    const failingUpdateService = new EntitlementEvaluationService(
      ctx.plans,
      ctx.features,
      ctx.tenantState,
      ctx.quotas,
      new FailingUpdateUsageMeterRepository(db),
      transactionRunner,
      new NoopEntitlementEventPublisher(),
      ctx.context,
    );
    await assert.rejects(
      () =>
        AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
          failingUpdateService.commitReservation({ reservationId: reservation.reservationId }),
        ),
      /meter update failed/,
    );
    quota = await ctx.quotas.findByTenantAndKey(tenantA, 'ai_requests_monthly');
    const meter = await ctx.meters.findById(reservation.reservationId);
    assert.equal(quota?.consumed, 0);
    assert.equal(quota?.reserved, 20);
    assert.equal(meter?.kind, 'reserved');
  });

  test('end-to-end entitlement evaluation works against real adapters', async () => {
    const db = requireDb();
    const ctx = createServices(db);
    const { featureKey } = await seedEntitledTenant(db);
    const snapshot = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.resolveTenantSnapshot(),
    );
    assert.equal(snapshot.tenantId, tenantA);
    assert.equal(snapshot.featureFlags[featureKey], true);
    assert.equal(snapshot.quotaLimits['ai_requests_monthly'], 100);
    const decision = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.evaluateFeature({ featureKey }),
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.source, 'plan');
    await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.recordUsage({ quotaKey: 'ai_requests_monthly', amount: 30 }),
    );
    const availability = await AlsEntitlementsContextResolver.runWithTenant(tenantA, () =>
      ctx.evaluation.checkQuotaAvailability({ quotaKey: 'ai_requests_monthly' }),
    );
    assert.equal(availability.limit, 100);
    assert.equal(availability.consumed, 30);
    assert.equal(availability.available, 70);
    const otherTenantSnapshot = await AlsEntitlementsContextResolver.runWithTenant(tenantB, () =>
      ctx.evaluation.resolveTenantSnapshot(),
    );
    assert.deepEqual(otherTenantSnapshot.featureFlags, {});
  });
});
