import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import { FeatureCatalogService } from '../../src/entitlements/application/feature-catalog.service.js';
import { PlanCatalogService } from '../../src/entitlements/application/plan-catalog.service.js';
import { MANAGEMENT_PERMISSIONS } from '../../src/entitlements-http/entitlements.dto.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping entitlements smoke tests' : false;

interface ParsedCookie {
  name: string;
  value: string;
}

function cookieFromSetCookie(header: string | string[] | undefined): ParsedCookie | null {
  if (typeof header !== 'string') {
    return null;
  }
  const first = header.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

test('entitlements HTTP endpoints (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query(
      'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments, plans, plan_versions, feature_definitions, feature_entitlements, tenant_plan_assignments, tenant_feature_overrides, usage_quotas, usage_meters CASCADE',
    );

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ LOG_LEVEL: 'error', LOG_PRETTY: 'false', NODE_ENV: 'test' })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
    const app = await createApiApplication(config);
    try {
      const userCreation = app.get(UserCreationService);
      const membershipService = app.get(MembershipService);
      const featureCatalog = app.get(FeatureCatalogService);
      const planCatalog = app.get(PlanCatalogService);
      const admin = await userCreation.registerUser({ email: `ent-admin-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const viewer = await userCreation.registerUser({ email: `ent-viewer-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const outsider = await userCreation.registerUser({ email: `ent-outsider-${Date.now()}@example.com`, password: 'smoke-password-123' });

      const login = async (user: { id: string; email: string }): Promise<ParsedCookie> => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: user.email, password: 'smoke-password-123' },
        });
        assert.equal(response.statusCode, 200);
        const cookie = cookieFromSetCookie(response.headers['set-cookie']);
        assert.ok(cookie);
        return cookie;
      };

      const adminCookie = await login(admin);
      const viewerCookie = await login(viewer);
      const outsiderCookie = await login(outsider);
      const authHeader = (cookie: ParsedCookie) => ({ cookie: `${cookie.name}=${cookie.value}` });

      // --- institution + memberships ---
      const created = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        headers: authHeader(adminCookie),
        payload: { name: 'Manara Entitlements Smoke', type: 'university' },
      });
      assert.equal(created.statusCode, 201);
      const tenantId = JSON.parse(created.body).institution.id as string;
      for (const user of [admin, viewer]) {
        await AlsTenantContextResolver.runWithTenant(tenantId, () =>
          membershipService.createMembership({ institutionId: tenantId, userId: user.id }),
        );
      }

      // --- seed the platform permission catalog + roles ---
      const permissionIds = new Map<string, string>();
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        const id = randomUUID();
        const module = key.split(':')[0] ?? 'entitlement';
        await database.query("INSERT INTO permissions (id, key, module, status) VALUES ($1, $2, $3, 'active')", [id, key, module]);
        permissionIds.set(key, id);
      }
      const adminRoleId = randomUUID();
      const viewerRoleId = randomUUID();
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Entitlements Admin', 'active')", [adminRoleId, tenantId]);
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Entitlements Viewer', 'active')", [viewerRoleId, tenantId]);
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [adminRoleId, permissionIds.get(key), tenantId]);
      }
      const viewerKeys = [
        MANAGEMENT_PERMISSIONS.planList,
        MANAGEMENT_PERMISSIONS.planRead,
        MANAGEMENT_PERMISSIONS.planVersionList,
        MANAGEMENT_PERMISSIONS.featureList,
        MANAGEMENT_PERMISSIONS.entitlementRead,
        MANAGEMENT_PERMISSIONS.entitlementCheck,
        MANAGEMENT_PERMISSIONS.quotaRead,
        MANAGEMENT_PERMISSIONS.usageList,
      ];
      for (const key of viewerKeys) {
        await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [viewerRoleId, permissionIds.get(key), tenantId]);
      }
      for (const [roleId, userId] of [
        [adminRoleId, admin.id],
        [viewerRoleId, viewer.id],
      ] as const) {
        await database.query(
          "INSERT INTO role_assignments (id, tenant_id, role_id, user_id, scope_type, created_by_user_id) VALUES ($1, $2, $3, $4, 'tenant', $4)",
          [randomUUID(), tenantId, roleId, userId],
        );
      }

      // --- seed the platform feature/plan catalog (business services, no HTTP) ---
      await featureCatalog.createFeatureDefinition({
        key: 'ai.question_generator',
        name: 'AI Question Generator',
        category: 'ai',
      });
      await featureCatalog.createFeatureDefinition({
        key: 'reports.export',
        name: 'Reports Export',
        category: 'reports',
      });
      await featureCatalog.createFeatureDefinition({
        key: 'gradebook.analytics',
        name: 'Gradebook Analytics',
        category: 'gradebook',
      });
      const plan = await planCatalog.createPlan({ name: 'Enterprise', description: 'Enterprise plan' });
      const version = await planCatalog.createPlanVersion({
        planId: plan.id,
        label: 'v1',
        features: [
          { featureKey: 'ai.question_generator', enabled: true, quotaKey: 'ai_requests_monthly', quotaLimit: 100 },
          { featureKey: 'reports.export', enabled: false, overridable: true },
        ],
      });
      await planCatalog.activatePlanVersion({ planId: plan.id, versionId: version.id });

      // --- unauthenticated requests are rejected with 401 ---
      const noAuthPlans = await app.inject({ method: 'GET', url: '/v1/plans' });
      assert.equal(noAuthPlans.statusCode, 401);
      const noAuthEntitlements = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements` });
      assert.equal(noAuthEntitlements.statusCode, 401);

      // --- platform plan catalog ---
      const plansPage = await app.inject({ method: 'GET', url: '/v1/plans', headers: authHeader(adminCookie) });
      assert.equal(plansPage.statusCode, 200);
      const planKeys = JSON.parse(plansPage.body).items as Array<{ name: string }>;
      assert.ok(planKeys.some((item) => item.name === 'Enterprise'));
      const badLimit = await app.inject({ method: 'GET', url: '/v1/plans?limit=0', headers: authHeader(adminCookie) });
      assert.equal(badLimit.statusCode, 400);

      const planById = await app.inject({ method: 'GET', url: `/v1/plans/${plan.id}`, headers: authHeader(adminCookie) });
      assert.equal(planById.statusCode, 200);
      assert.equal(JSON.parse(planById.body).plan.name, 'Enterprise');
      const missingPlan = await app.inject({
        method: 'GET',
        url: '/v1/plans/00000000-0000-4000-8000-000000000000',
        headers: authHeader(adminCookie),
      });
      assert.equal(missingPlan.statusCode, 404);
      assert.equal(JSON.parse(missingPlan.body).error.code, 'http.not_found');

      const versionsPage = await app.inject({ method: 'GET', url: `/v1/plans/${plan.id}/versions`, headers: authHeader(adminCookie) });
      assert.equal(versionsPage.statusCode, 200);
      assert.equal(JSON.parse(versionsPage.body).items[0]?.status, 'active');

      const featuresPage = await app.inject({ method: 'GET', url: '/v1/features', headers: authHeader(adminCookie) });
      assert.equal(featuresPage.statusCode, 200);
      const featureKeys = JSON.parse(featuresPage.body).items as Array<{ key: string }>;
      assert.ok(featureKeys.some((item) => item.key === 'ai.question_generator'));
      assert.ok(featureKeys.some((item) => item.key === 'reports.export'));

      // --- entitlements before assignment: empty snapshot, denied checks ---
      const beforeAssignment = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements`, headers: authHeader(adminCookie) });
      assert.equal(beforeAssignment.statusCode, 200);
      assert.equal(JSON.parse(beforeAssignment.body).snapshot.planId, null);

      const checkBefore = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/check`,
        headers: authHeader(adminCookie),
        payload: { featureKey: 'ai.question_generator' },
      });
      assert.equal(checkBefore.statusCode, 200);
      assert.equal(JSON.parse(checkBefore.body).decision.allowed, false);
      assert.equal(JSON.parse(checkBefore.body).decision.reason, 'denied_no_entitlement');

      const quotaBefore = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/check`,
        headers: authHeader(adminCookie),
      });
      assert.equal(quotaBefore.statusCode, 404);
      assert.equal(JSON.parse(quotaBefore.body).error.code, 'entitlements.quota_dimension_not_found');

      // --- assign the plan ---
      const assigned = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/assign-plan`,
        headers: authHeader(adminCookie),
        payload: { planId: plan.id },
      });
      assert.equal(assigned.statusCode, 201);
      const assignment = JSON.parse(assigned.body).assignment;
      assert.equal(assignment.planId, plan.id);
      assert.equal(assignment.assignedByUserId, admin.id);

      const duplicateAssignment = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/assign-plan`,
        headers: authHeader(adminCookie),
        payload: { planId: plan.id },
      });
      assert.equal(duplicateAssignment.statusCode, 409);
      assert.equal(JSON.parse(duplicateAssignment.body).error.code, 'entitlements.tenant_already_assigned');

      // --- snapshot now reflects the assigned plan ---
      const snapshotPage = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements/snapshot`, headers: authHeader(adminCookie) });
      assert.equal(snapshotPage.statusCode, 200);
      const snapshot = JSON.parse(snapshotPage.body).snapshot;
      assert.equal(snapshot.planId, plan.id);
      assert.equal(snapshot.planName, 'Enterprise');
      assert.equal(snapshot.featureFlags['ai.question_generator'], true);
      assert.equal(snapshot.quotaLimits.ai_requests_monthly, 100);

      const checkAfter = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/check`,
        headers: authHeader(adminCookie),
        payload: { featureKey: 'ai.question_generator' },
      });
      assert.equal(checkAfter.statusCode, 200);
      assert.equal(JSON.parse(checkAfter.body).decision.allowed, true);
      assert.equal(JSON.parse(checkAfter.body).decision.source, 'plan');

      // --- quota check / reserve / release ---
      const quotaCheck = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/check`,
        headers: authHeader(adminCookie),
      });
      assert.equal(quotaCheck.statusCode, 200);
      const availability = JSON.parse(quotaCheck.body).quota;
      assert.equal(availability.limit, 100);
      assert.equal(availability.consumed, 0);
      assert.equal(availability.reserved, 0);
      assert.equal(availability.available, 100);

      const reserved = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/reserve`,
        headers: authHeader(adminCookie),
        payload: { amount: 25, operationId: 'op-smoke' },
      });
      assert.equal(reserved.statusCode, 201);
      const reservationId = JSON.parse(reserved.body).reservation.reservationId as string;
      assert.equal(JSON.parse(reserved.body).reservation.amount, 25);

      const quotaAfterReserve = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/check`,
        headers: authHeader(adminCookie),
      });
      assert.equal(JSON.parse(quotaAfterReserve.body).quota.reserved, 25);
      assert.equal(JSON.parse(quotaAfterReserve.body).quota.available, 75);

      const oversubscribed = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/reserve`,
        headers: authHeader(adminCookie),
        payload: { amount: 200 },
      });
      assert.equal(oversubscribed.statusCode, 409);
      assert.equal(JSON.parse(oversubscribed.body).error.code, 'entitlements.quota_exceeded');

      const invalidReserve = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/reserve`,
        headers: authHeader(adminCookie),
        payload: { amount: 0 },
      });
      assert.equal(invalidReserve.statusCode, 400);
      assert.equal(JSON.parse(invalidReserve.body).error.code, 'http.validation_failed');

      const released = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/release`,
        headers: authHeader(adminCookie),
        payload: { reservationId },
      });
      assert.equal(released.statusCode, 204);

      const releasedAgain = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/release`,
        headers: authHeader(adminCookie),
        payload: { reservationId },
      });
      assert.equal(releasedAgain.statusCode, 409);
      assert.equal(JSON.parse(releasedAgain.body).error.code, 'entitlements.invalid_reservation_operation');

      const quotaAfterRelease = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/quotas/ai_requests_monthly/check`,
        headers: authHeader(adminCookie),
      });
      assert.equal(JSON.parse(quotaAfterRelease.body).quota.reserved, 0);
      assert.equal(JSON.parse(quotaAfterRelease.body).quota.available, 100);

      // --- feature overrides ---
      const overridden = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/overrides`,
        headers: authHeader(adminCookie),
        payload: { featureKey: 'reports.export', enabled: true },
      });
      assert.equal(overridden.statusCode, 201);
      assert.equal(JSON.parse(overridden.body).override.featureKey, 'reports.export');

      const snapshotWithOverride = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements`, headers: authHeader(adminCookie) });
      assert.equal(JSON.parse(snapshotWithOverride.body).snapshot.featureFlags['reports.export'], true);

      const overrideUnknown = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/overrides`,
        headers: authHeader(adminCookie),
        payload: { featureKey: 'unknown.feature', enabled: true },
      });
      assert.equal(overrideUnknown.statusCode, 404);
      assert.equal(JSON.parse(overrideUnknown.body).error.code, 'entitlements.feature_definition_not_found');

      const overrideNotInPlan = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/overrides`,
        headers: authHeader(adminCookie),
        payload: { featureKey: 'gradebook.analytics', enabled: true },
      });
      assert.equal(overrideNotInPlan.statusCode, 409);
      assert.equal(JSON.parse(overrideNotInPlan.body).error.code, 'entitlements.feature_not_in_plan');

      const removedOverride = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/entitlements/overrides/reports.export`,
        headers: authHeader(adminCookie),
      });
      assert.equal(removedOverride.statusCode, 204);
      const snapshotAfterRemove = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements`, headers: authHeader(adminCookie) });
      assert.equal(JSON.parse(snapshotAfterRemove.body).snapshot.featureFlags['reports.export'], false);

      // --- usage meters list ---
      const usagePage = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/usage`, headers: authHeader(adminCookie) });
      assert.equal(usagePage.statusCode, 200);
      const usageItems = JSON.parse(usagePage.body).items as Array<{ quotaKey: string; kind: string; operationId: string | null }>;
      assert.ok(usageItems.length >= 1);
      assert.ok(usageItems.every((item) => item.quotaKey === 'ai_requests_monthly'));
      assert.ok(usageItems.some((item) => item.kind === 'released' && item.operationId === 'op-smoke'));

      // --- read-only viewer and cross-tenant isolation ---
      const viewerPlans = await app.inject({ method: 'GET', url: '/v1/plans', headers: authHeader(viewerCookie) });
      assert.equal(viewerPlans.statusCode, 200);
      const viewerAssign = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/entitlements/assign-plan`,
        headers: authHeader(viewerCookie),
        payload: { planId: plan.id },
      });
      assert.equal(viewerAssign.statusCode, 403);
      assert.equal(JSON.parse(viewerAssign.body).error.code, 'http.forbidden');
      const viewerSnapshot = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements`, headers: authHeader(viewerCookie) });
      assert.equal(viewerSnapshot.statusCode, 200);

      const outsiderEntitlements = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/entitlements`, headers: authHeader(outsiderCookie) });
      assert.equal(outsiderEntitlements.statusCode, 403);
      const outsiderPlans = await app.inject({ method: 'GET', url: '/v1/plans', headers: authHeader(outsiderCookie) });
      assert.equal(outsiderPlans.statusCode, 403);

      const otherTenant = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        headers: authHeader(outsiderCookie),
        payload: { name: 'Other Tenant', type: 'university' },
      });
      const otherTenantId = JSON.parse(otherTenant.body).institution.id as string;
      await AlsTenantContextResolver.runWithTenant(otherTenantId, () =>
        membershipService.createMembership({ institutionId: otherTenantId, userId: outsider.id }),
      );
      const adminIntoOther = await app.inject({ method: 'GET', url: `/v1/tenants/${otherTenantId}/entitlements`, headers: authHeader(adminCookie) });
      assert.equal(adminIntoOther.statusCode, 403);
    } finally {
      await app.close();
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  } finally {
    try {
      await database.query(
        'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments, plans, plan_versions, feature_definitions, feature_entitlements, tenant_plan_assignments, tenant_feature_overrides, usage_quotas, usage_meters CASCADE',
      );
    } finally {
      await database.close();
    }
  }
});
