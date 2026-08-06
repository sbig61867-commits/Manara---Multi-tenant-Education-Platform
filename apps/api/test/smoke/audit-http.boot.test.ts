import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import { AUDIT_PERMISSIONS } from '../../src/audit-http/audit.dto.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping audit smoke tests' : false;

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

test('audit HTTP endpoints (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query(
      'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments, audit_log CASCADE',
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
      const admin = await userCreation.registerUser({ email: `audit-admin-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const viewer = await userCreation.registerUser({ email: `audit-viewer-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const outsider = await userCreation.registerUser({ email: `audit-outsider-${Date.now()}@example.com`, password: 'smoke-password-123' });

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
        payload: { name: 'Manara Audit Smoke', type: 'university' },
      });
      assert.equal(created.statusCode, 201);
      const tenantId = JSON.parse(created.body).institution.id as string;
      for (const user of [admin, viewer, outsider]) {
        await AlsTenantContextResolver.runWithTenant(tenantId, () =>
          membershipService.createMembership({ institutionId: tenantId, userId: user.id }),
        );
      }

      // --- seed the platform permission catalog + roles ---
      const permissionIds = new Map<string, string>();
      for (const key of Object.values(AUDIT_PERMISSIONS)) {
        const id = randomUUID();
        await database.query("INSERT INTO permissions (id, key, module, status) VALUES ($1, $2, 'audit', 'active')", [id, key]);
        permissionIds.set(key, id);
      }
      const adminRoleId = randomUUID();
      const viewerRoleId = randomUUID();
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Audit Admin', 'active')", [adminRoleId, tenantId]);
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Audit Viewer', 'active')", [viewerRoleId, tenantId]);
      for (const key of Object.values(AUDIT_PERMISSIONS)) {
        await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [adminRoleId, permissionIds.get(key), tenantId]);
      }
      await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [
        viewerRoleId,
        permissionIds.get(AUDIT_PERMISSIONS.auditList),
        tenantId,
      ]);
      for (const [roleId, userId] of [
        [adminRoleId, admin.id],
        [viewerRoleId, viewer.id],
      ] as const) {
        await database.query(
          "INSERT INTO role_assignments (id, tenant_id, role_id, user_id, scope_type, created_by_user_id) VALUES ($1, $2, $3, $4, 'tenant', $4)",
          [randomUUID(), tenantId, roleId, userId],
        );
      }

      // --- seed audit events directly (the HTTP layer is read-only) ---
      const eventUserLogin = randomUUID();
      const eventRoleUpdated = randomUUID();
      const eventRollup = randomUUID();
      const eventPlatform = randomUUID();
      await database.query(
        `INSERT INTO audit_log (id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at)
         VALUES ($1, 'tenant', $2, $3, NULL, 'user.login', 'user', $4, NULL, 'req-1', '{}'::jsonb, '2026-08-04T12:00:00.000Z')`,
        [eventUserLogin, tenantId, admin.id, admin.id],
      );
      await database.query(
        `INSERT INTO audit_log (id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at)
         VALUES ($1, 'tenant', $2, $3, NULL, 'role.updated', 'role', $4, NULL, 'req-2', '{"note":"ok"}'::jsonb, '2026-08-04T13:00:00.000Z')`,
        [eventRoleUpdated, tenantId, viewer.id, randomUUID()],
      );
      await database.query(
        `INSERT INTO audit_log (id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at)
         VALUES ($1, 'tenant', $2, NULL, 'rollup-worker', 'attendance.rollup', 'attendance', $3, NULL, 'req-3', '{}'::jsonb, '2026-08-04T14:00:00.000Z')`,
        [eventRollup, tenantId, randomUUID()],
      );
      await database.query(
        `INSERT INTO audit_log (id, scope, tenant_id, actor_user_id, actor_platform_role, action, target_entity_type, target_entity_id, reason, request_id, metadata_json, occurred_at)
         VALUES ($1, 'platform', NULL, NULL, 'scheduler', 'plan.retired', 'plan', $2, 'retirement window reached', 'req-p1', '{}'::jsonb, '2026-08-04T15:00:00.000Z')`,
        [eventPlatform, randomUUID()],
      );

      // --- unauthenticated requests are rejected with 401 ---
      const noAuthTenant = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events` });
      assert.equal(noAuthTenant.statusCode, 401);
      const noAuthPlatform = await app.inject({ method: 'GET', url: '/v1/platform/audit-events' });
      assert.equal(noAuthPlatform.statusCode, 401);

      // --- tenant audit list: ordering, filters, pagination ---
      const listPage = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events`, headers: authHeader(adminCookie) });
      assert.equal(listPage.statusCode, 200);
      const listBody = JSON.parse(listPage.body) as {
        items: Array<{ id: string; scope: string; tenantId: string | null; action: string; requestId: string }>;
        nextCursor: string | null;
      };
      assert.equal(listBody.items.length, 3);
      assert.ok(listBody.items.every((item) => item.scope === 'tenant' && item.tenantId === tenantId));
      assert.deepEqual(listBody.items.map((item) => item.action), ['attendance.rollup', 'role.updated', 'user.login']);

      const byActor = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/audit-events?actorUserId=${admin.id}`,
        headers: authHeader(adminCookie),
      });
      assert.equal(byActor.statusCode, 200);
      assert.equal(JSON.parse(byActor.body).items.length, 1);
      assert.equal(JSON.parse(byActor.body).items[0].action, 'user.login');

      const byRequest = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/audit-events?requestId=req-2`,
        headers: authHeader(adminCookie),
      });
      assert.equal(byRequest.statusCode, 200);
      assert.equal(JSON.parse(byRequest.body).items[0].action, 'role.updated');

      const badRange = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/audit-events?occurredFrom=2026-08-05T00:00:00.000Z&occurredTo=2026-08-04T00:00:00.000Z`,
        headers: authHeader(adminCookie),
      });
      assert.equal(badRange.statusCode, 400);
      assert.equal(JSON.parse(badRange.body).error.code, 'http.validation_failed');

      const firstPage = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events?limit=2`, headers: authHeader(adminCookie) });
      assert.equal(firstPage.statusCode, 200);
      const firstPageBody = JSON.parse(firstPage.body) as { items: Array<{ id: string }>; nextCursor: string | null };
      assert.equal(firstPageBody.items.length, 2);
      assert.ok(firstPageBody.nextCursor !== null);
      const secondPage = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/audit-events?limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? '')}`,
        headers: authHeader(adminCookie),
      });
      assert.equal(secondPage.statusCode, 200);
      const secondPageBody = JSON.parse(secondPage.body) as { items: Array<{ id: string }>; nextCursor: string | null };
      assert.equal(secondPageBody.items.length, 1);
      assert.equal(secondPageBody.nextCursor, null);

      // --- tenant audit single event: found, 404, and permission scoping ---
      const single = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events/${eventUserLogin}`, headers: authHeader(adminCookie) });
      assert.equal(single.statusCode, 200);
      const singleBody = JSON.parse(single.body) as { event: { id: string; scope: string; requestId: string; metadata: Record<string, unknown> } };
      assert.equal(singleBody.event.id, eventUserLogin);
      assert.equal(singleBody.event.scope, 'tenant');
      assert.equal(singleBody.event.requestId, 'req-1');
      assert.deepEqual(singleBody.event.metadata, {});

      const missing = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/audit-events/00000000-0000-4000-8000-000000000000`,
        headers: authHeader(adminCookie),
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(JSON.parse(missing.body).error.code, 'http.not_found');

      const viewerList = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events`, headers: authHeader(viewerCookie) });
      assert.equal(viewerList.statusCode, 200);
      const viewerSingle = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events/${eventUserLogin}`, headers: authHeader(viewerCookie) });
      assert.equal(viewerSingle.statusCode, 403);
      assert.equal(JSON.parse(viewerSingle.body).error.code, 'http.forbidden');

      // --- platform audit routes: platform-scoped, permission-protected ---
      const platformList = await app.inject({ method: 'GET', url: '/v1/platform/audit-events', headers: authHeader(adminCookie) });
      assert.equal(platformList.statusCode, 200);
      const platformItems = JSON.parse(platformList.body).items as Array<{
        id: string;
        scope: string;
        tenantId: string | null;
        action: string;
        reason: string | null;
      }>;
      assert.equal(platformItems.length, 1);
      assert.equal(platformItems[0]?.id, eventPlatform);
      assert.equal(platformItems[0]?.scope, 'platform');
      assert.equal(platformItems[0]?.tenantId, null);
      assert.equal(platformItems[0]?.action, 'plan.retired');
      assert.equal(platformItems[0]?.reason, 'retirement window reached');

      const platformSingle = await app.inject({ method: 'GET', url: `/v1/platform/audit-events/${eventPlatform}`, headers: authHeader(adminCookie) });
      assert.equal(platformSingle.statusCode, 200);
      assert.equal(JSON.parse(platformSingle.body).event.id, eventPlatform);

      const viewerPlatform = await app.inject({ method: 'GET', url: '/v1/platform/audit-events', headers: authHeader(viewerCookie) });
      assert.equal(viewerPlatform.statusCode, 403);
      assert.equal(JSON.parse(viewerPlatform.body).error.code, 'http.forbidden');

      // --- cross-tenant isolation for non-members ---
      const outsiderTenant = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/audit-events`, headers: authHeader(outsiderCookie) });
      assert.equal(outsiderTenant.statusCode, 403);
      const outsiderPlatform = await app.inject({ method: 'GET', url: '/v1/platform/audit-events', headers: authHeader(outsiderCookie) });
      assert.equal(outsiderPlatform.statusCode, 403);
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
        'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments, audit_log CASCADE',
      );
    } finally {
      await database.close();
    }
  }
});
