import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import { MANAGEMENT_PERMISSIONS } from '../../src/authorizations/authorization.dto.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping authorization smoke tests' : false;

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

test('authorization HTTP endpoints (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query(
      'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments CASCADE',
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
      const admin = await userCreation.registerUser({ email: `authz-admin-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const manager = await userCreation.registerUser({ email: `authz-manager-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const target = await userCreation.registerUser({ email: `authz-target-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const outsider = await userCreation.registerUser({ email: `authz-outsider-${Date.now()}@example.com`, password: 'smoke-password-123' });

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
      const managerCookie = await login(manager);
      const targetCookie = await login(target);
      const outsiderCookie = await login(outsider);
      const authHeader = (cookie: ParsedCookie) => ({ cookie: `${cookie.name}=${cookie.value}` });

      // --- institution + memberships ---
      const created = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        headers: authHeader(adminCookie),
        payload: { name: 'Manara Authz Smoke', type: 'university' },
      });
      assert.equal(created.statusCode, 201);
      const tenantId = JSON.parse(created.body).institution.id as string;
      for (const user of [admin, manager, target]) {
        await AlsTenantContextResolver.runWithTenant(tenantId, () =>
          membershipService.createMembership({ institutionId: tenantId, userId: user.id }),
        );
      }

      // --- seed the platform permission catalog + bootstrap roles (no seeds exist) ---
      const permissionIds = new Map<string, string>();
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        const id = randomUUID();
        const module = key.split(':')[0] ?? 'role';
        await database.query("INSERT INTO permissions (id, key, module, status) VALUES ($1, $2, $3, 'active')", [id, key, module]);
        permissionIds.set(key, id);
      }

      const adminRoleId = randomUUID();
      const viewerRoleId = randomUUID();
      const granterRoleId = randomUUID();
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Platform Admin', 'active')", [adminRoleId, tenantId]);
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Viewer', 'active')", [viewerRoleId, tenantId]);
      await database.query("INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Granters', 'active')", [granterRoleId, tenantId]);

      const viewerKeys = [
        MANAGEMENT_PERMISSIONS.roleList,
        MANAGEMENT_PERMISSIONS.roleRead,
        MANAGEMENT_PERMISSIONS.roleUpdate,
        MANAGEMENT_PERMISSIONS.rolePermissionList,
        MANAGEMENT_PERMISSIONS.roleAssignmentList,
        MANAGEMENT_PERMISSIONS.roleAssignmentAssign,
        MANAGEMENT_PERMISSIONS.permissionList,
        MANAGEMENT_PERMISSIONS.authorizationCheck,
        MANAGEMENT_PERMISSIONS.authorizationCheckMany,
      ];
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [adminRoleId, permissionIds.get(key), tenantId]);
      }
      for (const key of viewerKeys) {
        await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [viewerRoleId, permissionIds.get(key), tenantId]);
      }
      await database.query('INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)', [
        granterRoleId,
        permissionIds.get(MANAGEMENT_PERMISSIONS.rolePermissionGrant),
        tenantId,
      ]);

      const bootstrapAssignment = async (roleId: string, userId: string): Promise<void> => {
        await database.query(
          "INSERT INTO role_assignments (id, tenant_id, role_id, user_id, scope_type, created_by_user_id) VALUES ($1, $2, $3, $4, 'tenant', $4)",
          [randomUUID(), tenantId, roleId, userId],
        );
      };
      await bootstrapAssignment(adminRoleId, admin.id);
      await bootstrapAssignment(viewerRoleId, manager.id);
      await bootstrapAssignment(granterRoleId, target.id);

      // --- unauthenticated requests are rejected with 401 ---
      const noAuth = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/roles` });
      assert.equal(noAuth.statusCode, 401);
      const noAuthCatalog = await app.inject({ method: 'GET', url: '/v1/permissions' });
      assert.equal(noAuthCatalog.statusCode, 401);

      // --- role management ---
      const roleList = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/roles`, headers: authHeader(adminCookie) });
      assert.equal(roleList.statusCode, 200);
      assert.equal(JSON.parse(roleList.body).items.length, 3);
      assert.equal(JSON.parse(roleList.body).nextCursor, null);

      const createdRole = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles`,
        headers: authHeader(adminCookie),
        payload: { name: 'Instructor', description: 'Teaches courses' },
      });
      assert.equal(createdRole.statusCode, 201);
      const instructor = JSON.parse(createdRole.body).role;
      assert.equal(instructor.status, 'active');
      assert.equal(instructor.description, 'Teaches courses');
      const instructorRoleId = instructor.id as string;

      const duplicateRole = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles`,
        headers: authHeader(adminCookie),
        payload: { name: 'Instructor' },
      });
      assert.equal(duplicateRole.statusCode, 409);
      assert.equal(JSON.parse(duplicateRole.body).error.code, 'authorization.role_name_already_exists');

      const validationError = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles`,
        headers: authHeader(adminCookie),
        payload: { name: '' },
      });
      assert.equal(validationError.statusCode, 400);
      assert.equal(JSON.parse(validationError.body).error.code, 'http.validation_failed');

      const fetchedRole = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/roles/${instructorRoleId}`,
        headers: authHeader(adminCookie),
      });
      assert.equal(fetchedRole.statusCode, 200);
      assert.equal(JSON.parse(fetchedRole.body).role.id, instructorRoleId);

      const missingRole = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/roles/00000000-0000-4000-8000-000000000000`,
        headers: authHeader(adminCookie),
      });
      assert.equal(missingRole.statusCode, 404);
      assert.equal(JSON.parse(missingRole.body).error.code, 'authorization.role_not_found');

      const updatedRole = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/roles/${instructorRoleId}`,
        headers: authHeader(adminCookie),
        payload: { name: 'Instructor II' },
      });
      assert.equal(updatedRole.statusCode, 200);
      assert.equal(JSON.parse(updatedRole.body).role.name, 'Instructor II');

      // --- manager holds only viewer permissions ---
      const managerList = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/roles`, headers: authHeader(managerCookie) });
      assert.equal(managerList.statusCode, 200);
      const managerCreate = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles`,
        headers: authHeader(managerCookie),
        payload: { name: 'Forbidden' },
      });
      assert.equal(managerCreate.statusCode, 403);
      assert.equal(JSON.parse(managerCreate.body).error.code, 'http.forbidden');

      // --- permission catalog ---
      const catalog = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeader(adminCookie) });
      assert.equal(catalog.statusCode, 200);
      const catalogKeys = JSON.parse(catalog.body).items.map((item: { key: string }) => item.key);
      assert.ok(catalogKeys.length >= Object.values(MANAGEMENT_PERMISSIONS).length);
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        assert.ok(catalogKeys.includes(key));
      }
      const catalogFiltered = await app.inject({ method: 'GET', url: '/v1/permissions?module=role', headers: authHeader(adminCookie) });
      assert.equal(catalogFiltered.statusCode, 200);
      const filteredItems = JSON.parse(catalogFiltered.body).items as Array<{ module: string }>;
      assert.ok(filteredItems.length > 0);
      for (const item of filteredItems) {
        assert.equal(item.module, 'role');
      }
      const catalogByManager = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeader(managerCookie) });
      assert.equal(catalogByManager.statusCode, 200);
      const catalogByOutsider = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeader(outsiderCookie) });
      assert.equal(catalogByOutsider.statusCode, 403);
      const catalogBadLimit = await app.inject({ method: 'GET', url: '/v1/permissions?limit=0', headers: authHeader(adminCookie) });
      assert.equal(catalogBadLimit.statusCode, 400);

      // --- grants: create, conflicts, escalation, revoke-immediate ---
      const granterRoleIdView = JSON.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/tenants/${tenantId}/roles/${granterRoleId}`,
            headers: authHeader(adminCookie),
          })
        ).body,
      ).role.id as string;
      assert.equal(granterRoleIdView, granterRoleId);

      const grantTarget = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role:create' },
      });
      assert.equal(grantTarget.statusCode, 201);
      assert.equal(JSON.parse(grantTarget.body).grant.permissionKey, 'role:create');

      const duplicateGrant = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role:create' },
      });
      assert.equal(duplicateGrant.statusCode, 409);
      assert.equal(JSON.parse(duplicateGrant.body).error.code, 'authorization.permission_already_granted');

      const grantUnknownRole = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/00000000-0000-4000-8000-000000000000/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role:create' },
      });
      assert.equal(grantUnknownRole.statusCode, 404);
      assert.equal(JSON.parse(grantUnknownRole.body).error.code, 'authorization.role_not_found');

      // granting an unknown permission is blocked by the escalation guard
      // (the caller cannot hold a permission that does not exist)
      const grantUnknownPermission = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'never:exists' },
      });
      assert.equal(grantUnknownPermission.statusCode, 403);
      assert.equal(JSON.parse(grantUnknownPermission.body).error.code, 'http.forbidden');

      // escalation: the granter holds role_permission:grant but NOT role:create
      const escalatingGrant = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions`,
        headers: authHeader(targetCookie),
        payload: { permissionKey: 'role:update' },
      });
      assert.equal(escalatingGrant.statusCode, 403);
      // manager does not hold role_permission:grant at all
      const managerGrant = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions`,
        headers: authHeader(managerCookie),
        payload: { permissionKey: 'role:update' },
      });
      assert.equal(managerGrant.statusCode, 403);

      // the admin grants role:create to Granters; the target (a granter) can
      // now grant the permission it holds to another role
      const grantToGranter = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${granterRoleId}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role:create' },
      });
      assert.equal(grantToGranter.statusCode, 201);
      const nowAllowedGrant = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${instructorRoleId}/permissions`,
        headers: authHeader(targetCookie),
        payload: { permissionKey: 'role:create' },
      });
      assert.equal(nowAllowedGrant.statusCode, 201);
      assert.equal(JSON.parse(nowAllowedGrant.body).grant.permissionKey, 'role:create');

      const grantsList = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions?limit=100`,
        headers: authHeader(adminCookie),
      });
      assert.equal(grantsList.statusCode, 200);
      const grantKeys = JSON.parse(grantsList.body).items.map((item: { permissionKey: string }) => item.permissionKey);
      assert.ok(grantKeys.includes('role:create'));
      assert.ok(!grantKeys.includes('role:retire'));

      const revokeTwiceTarget = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions/role:create`,
        headers: authHeader(adminCookie),
      });
      assert.equal(revokeTwiceTarget.statusCode, 204);
      const revokeAgain = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/roles/${viewerRoleId}/permissions/role:create`,
        headers: authHeader(adminCookie),
      });
      assert.equal(revokeAgain.statusCode, 409);
      assert.equal(JSON.parse(revokeAgain.body).error.code, 'authorization.permission_not_granted');

      // --- assignments: create, conflicts, escalation, revoke-immediate ---
      const assignViewer = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: target.id, roleId: viewerRoleId, scope: { type: 'tenant' } },
      });
      assert.equal(assignViewer.statusCode, 201);
      const viewerAssignmentId = JSON.parse(assignViewer.body).assignment.id as string;

      const duplicateAssignment = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: target.id, roleId: viewerRoleId, scope: { type: 'tenant' } },
      });
      assert.equal(duplicateAssignment.statusCode, 409);
      assert.equal(JSON.parse(duplicateAssignment.body).error.code, 'authorization.assignment_already_exists');

      const assignUnknownRole = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: target.id, roleId: '00000000-0000-4000-8000-000000000000', scope: { type: 'tenant' } },
      });
      assert.equal(assignUnknownRole.statusCode, 404);
      assert.equal(JSON.parse(assignUnknownRole.body).error.code, 'authorization.role_not_found');

      // escalation: manager holds role_assignment:assign but NOT role:create
      const escalatingAssignment = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(managerCookie),
        payload: { userId: target.id, roleId: adminRoleId, scope: { type: 'tenant' } },
      });
      assert.equal(escalatingAssignment.statusCode, 403);

      const adminAssignment = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: target.id, roleId: adminRoleId, scope: { type: 'tenant' } },
      });
      assert.equal(adminAssignment.statusCode, 201);
      const adminAssignmentId = JSON.parse(adminAssignment.body).assignment.id as string;

      const assignmentList = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/role-assignments?limit=100`,
        headers: authHeader(managerCookie),
      });
      assert.equal(assignmentList.statusCode, 200);
      const assignmentIds = JSON.parse(assignmentList.body).items.map((item: { id: string }) => item.id);
      assert.ok(assignmentIds.includes(adminAssignmentId));
      assert.ok(assignmentIds.includes(viewerAssignmentId));

      // --- check / check-many ---
      const checkAllowed = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: admin.id }, permissionKey: 'role:create', resourceType: 'role' },
      });
      assert.equal(checkAllowed.statusCode, 200);
      assert.equal(JSON.parse(checkAllowed.body).allowed, true);

      const checkDenied = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: manager.id }, permissionKey: 'role:retire', resourceType: 'role' },
      });
      assert.equal(checkDenied.statusCode, 200);
      assert.equal(JSON.parse(checkDenied.body).allowed, false);

      const checkMismatch = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: admin.id }, permissionKey: 'role:create', resourceType: 'unit' },
      });
      assert.equal(checkMismatch.statusCode, 400);
      assert.equal(JSON.parse(checkMismatch.body).error.code, 'http.validation_failed');

      const checkMany = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check-many`,
        headers: authHeader(adminCookie),
        payload: {
          subject: { userId: admin.id },
          checks: [
            { permissionKey: 'role:create', resourceType: 'role' },
            { permissionKey: 'role:retire', resourceType: 'role' },
          ],
        },
      });
      assert.equal(checkMany.statusCode, 200);
      const checkManyBody = JSON.parse(checkMany.body);
      assert.equal(checkManyBody.allowed, true);
      assert.deepEqual(checkManyBody.results, [
        { permissionKey: 'role:create', allowed: true },
        { permissionKey: 'role:retire', allowed: true },
      ]);

      const checkManyMixed = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check-many`,
        headers: authHeader(adminCookie),
        payload: {
          subject: { userId: manager.id },
          checks: [
            { permissionKey: 'role:list', resourceType: 'role' },
            { permissionKey: 'role:retire', resourceType: 'role' },
          ],
        },
      });
      assert.equal(checkManyMixed.statusCode, 200);
      const mixedBody = JSON.parse(checkManyMixed.body);
      assert.equal(mixedBody.allowed, false);
      assert.deepEqual(mixedBody.results, [
        { permissionKey: 'role:list', allowed: true },
        { permissionKey: 'role:retire', allowed: false },
      ]);

      // --- retire-immediate: retiring a role stops granting immediately ---
      const tempRole = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/tenants/${tenantId}/roles`,
            headers: authHeader(adminCookie),
            payload: { name: 'Temp' },
          })
        ).body,
      ).role as { id: string };
      await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${tempRole.id}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role:create' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: manager.id, roleId: tempRole.id, scope: { type: 'tenant' } },
      });
      const beforeRetire = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: manager.id }, permissionKey: 'role:create', resourceType: 'role' },
      });
      assert.equal(JSON.parse(beforeRetire.body).allowed, true);

      const retired = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${tempRole.id}/retire`,
        headers: authHeader(adminCookie),
      });
      assert.equal(retired.statusCode, 200);
      assert.equal(JSON.parse(retired.body).role.status, 'retired');
      const retireAgain = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${tempRole.id}/retire`,
        headers: authHeader(adminCookie),
      });
      assert.equal(retireAgain.statusCode, 200);
      const afterRetire = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: manager.id }, permissionKey: 'role:create', resourceType: 'role' },
      });
      assert.equal(JSON.parse(afterRetire.body).allowed, false);

      // --- grant revoke-immediate: revoking a grant stops granting immediately ---
      const grantRole = JSON.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/tenants/${tenantId}/roles`,
            headers: authHeader(adminCookie),
            payload: { name: 'GrantTemp' },
          })
        ).body,
      ).role as { id: string };
      await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/roles/${grantRole.id}/permissions`,
        headers: authHeader(adminCookie),
        payload: { permissionKey: 'role_permission:grant' },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/role-assignments`,
        headers: authHeader(adminCookie),
        payload: { userId: manager.id, roleId: grantRole.id, scope: { type: 'tenant' } },
      });
      const revokeCheckBefore = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: manager.id }, permissionKey: 'role_permission:grant', resourceType: 'role_permission' },
      });
      assert.equal(JSON.parse(revokeCheckBefore.body).allowed, true);
      const revokedGrant = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/roles/${grantRole.id}/permissions/role_permission:grant`,
        headers: authHeader(adminCookie),
      });
      assert.equal(revokedGrant.statusCode, 204);
      const revokeCheckAfter = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: manager.id }, permissionKey: 'role_permission:grant', resourceType: 'role_permission' },
      });
      assert.equal(JSON.parse(revokeCheckAfter.body).allowed, false);

      // --- assignment revoke-immediate ---
      const revokeAdminAssignment = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/role-assignments/${adminAssignmentId}`,
        headers: authHeader(adminCookie),
      });
      assert.equal(revokeAdminAssignment.statusCode, 204);
      const afterRevoke = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/authorization/check`,
        headers: authHeader(adminCookie),
        payload: { subject: { userId: target.id }, permissionKey: 'role:retire', resourceType: 'role' },
      });
      assert.equal(JSON.parse(afterRevoke.body).allowed, false);
      const revokeMissing = await app.inject({
        method: 'DELETE',
        url: `/v1/tenants/${tenantId}/role-assignments/00000000-0000-4000-8000-000000000000`,
        headers: authHeader(adminCookie),
      });
      assert.equal(revokeMissing.statusCode, 404);
      assert.equal(JSON.parse(revokeMissing.body).error.code, 'authorization.assignment_not_found');

      // --- cross-tenant isolation ---
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
      const crossTenant = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/roles`,
        headers: authHeader(outsiderCookie),
      });
      assert.equal(crossTenant.statusCode, 403);
      const adminIntoOther = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${otherTenantId}/roles`,
        headers: authHeader(adminCookie),
      });
      assert.equal(adminIntoOther.statusCode, 403);

      // --- pagination over roles ---
      for (let index = 0; index < 4; index += 1) {
        const page = await app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/roles`,
          headers: authHeader(adminCookie),
          payload: { name: `Role ${index}` },
        });
        assert.equal(page.statusCode, 201);
      }
      const collectedRoleIds: string[] = [];
      let cursor: string | null = null;
      do {
        const pageUrl = cursor === null ? 'limit=2' : `limit=2&cursor=${encodeURIComponent(cursor)}`;
        const page = await app.inject({
          method: 'GET',
          url: `/v1/tenants/${tenantId}/roles?${pageUrl}`,
          headers: authHeader(adminCookie),
        });
        assert.equal(page.statusCode, 200);
        const body = JSON.parse(page.body);
        assert.ok(body.items.length <= 2);
        collectedRoleIds.push(...body.items.map((item: { id: string }) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      assert.equal(new Set(collectedRoleIds).size, collectedRoleIds.length);
      assert.ok(collectedRoleIds.length >= 7);

      const badLimit = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/roles?limit=0`, headers: authHeader(adminCookie) });
      assert.equal(badLimit.statusCode, 400);
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
        'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, roles, permissions, role_permissions, role_assignments CASCADE',
      );
    } finally {
      await database.close();
    }
  }
});
