import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { apiEnvSchema, loadConfig } from '@manara/config';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { OutboxService } from '@manara/outbox';
import { createApiApplication } from '../../src/bootstrap.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import { MANAGEMENT_PERMISSIONS } from '../../src/tenants/tenant.dto.js';
import { MIGRATIONS_DIR, createTestDatabase, getTestDatabaseUrl } from '../integration/helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping tenant smoke tests' : false;

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

test('tenant HTTP endpoints (boot smoke)', { skip }, async () => {
  const database: PostgresDatabase = createTestDatabase();
  try {
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query(
      'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations, outbox_messages CASCADE',
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
      const owner = await userCreation.registerUser({ email: `tenant-owner-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const member = await userCreation.registerUser({ email: `tenant-member-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const invitee = await userCreation.registerUser({ email: `tenant-invitee-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const outsider = await userCreation.registerUser({ email: `tenant-outsider-${Date.now()}@example.com`, password: 'smoke-password-123' });
      const paginationUsers: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const user = await userCreation.registerUser({ email: `tenant-paging-${Date.now()}-${index}@example.com`, password: 'smoke-password-123' });
        paginationUsers.push(user.id);
      }

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

      const ownerCookie = await login(owner);
      const memberCookie = await login(member);
      const inviteeCookie = await login(invitee);
      const outsiderCookie = await login(outsider);

      const authHeader = (cookie: ParsedCookie) => ({ cookie: `${cookie.name}=${cookie.value}` });

      // --- unauthenticated requests are rejected with 401 ---
      const noAuthCreate = await app.inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Unauth', type: 'university' } });
      assert.equal(noAuthCreate.statusCode, 401);

      // --- institution creation ---
      const created = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        headers: authHeader(ownerCookie),
        payload: { name: 'Manara Smoke University', type: 'university' },
      });
      assert.equal(created.statusCode, 201);
      const institution = JSON.parse(created.body).institution;
      assert.equal(institution.status, 'draft');
      assert.equal(institution.name, 'Manara Smoke University');
      assert.equal(institution.type, 'university');
      const tenantId = institution.id as string;

      const noAuthGet = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}` });
      assert.equal(noAuthGet.statusCode, 401);

      // the owner must hold a membership to manage the tenant; bootstrap it
      await AlsTenantContextResolver.runWithTenant(tenantId, () =>
        membershipService.createMembership({ institutionId: tenantId, userId: owner.id }),
      );
      const memberMembership = await AlsTenantContextResolver.runWithTenant(tenantId, () =>
        membershipService.createMembership({ institutionId: tenantId, userId: member.id }),
      );

      // Test-only permission catalog and tenant-scoped admin role. Production
      // permission provisioning is deliberately outside this smoke fixture.
      const permissionIds = new Map<string, string>();
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        await database.query(
          "INSERT INTO permissions (id, key, module, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (key) DO NOTHING",
          [randomUUID(), key, key.split(':')[0]],
        );
        const permission = await database.query<{ id: string }>('SELECT id FROM permissions WHERE key = $1', [key]);
        const permissionId = permission.rows[0]?.id;
        if (permissionId === undefined) {
          throw new Error(`Permission fixture row was not found for ${key}`);
        }
        permissionIds.set(key, permissionId);
      }
      const adminRoleId = randomUUID();
      await database.query(
        "INSERT INTO roles (id, tenant_id, name, status) VALUES ($1, $2, 'Tenant Admin', 'active')",
        [adminRoleId, tenantId],
      );
      for (const key of Object.values(MANAGEMENT_PERMISSIONS)) {
        await database.query(
          'INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)',
          [adminRoleId, permissionIds.get(key), tenantId],
        );
      }
      await database.query(
        "INSERT INTO role_assignments (id, tenant_id, role_id, user_id, scope_type) VALUES ($1, $2, $3, $4, 'tenant')",
        [randomUUID(), tenantId, adminRoleId, owner.id],
      );

      // --- cross-tenant access is rejected with 403 ---
      const outsiderGet = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}`, headers: authHeader(outsiderCookie) });
      assert.equal(outsiderGet.statusCode, 403);
      assert.equal(JSON.parse(outsiderGet.body).error.code, 'http.forbidden');
      const outsiderMembership = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/memberships`,
        headers: authHeader(outsiderCookie),
        payload: { userId: outsider.id },
      });
      assert.equal(outsiderMembership.statusCode, 403);
      const outsiderList = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/memberships`, headers: authHeader(outsiderCookie) });
      assert.equal(outsiderList.statusCode, 403);

      // --- an active member without grants can read but cannot administer ---
      const memberRead = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}`, headers: authHeader(memberCookie) });
      assert.equal(memberRead.statusCode, 200);
      const memberMemberships = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/memberships`, headers: authHeader(memberCookie) });
      assert.equal(memberMemberships.statusCode, 200);
      const memberInvitations = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/invitations`, headers: authHeader(memberCookie) });
      assert.equal(memberInvitations.statusCode, 200);

      const memberLifecycle = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/status`,
        headers: authHeader(memberCookie),
        payload: { status: 'active' },
      });
      assert.equal(memberLifecycle.statusCode, 403);
      const memberCreateMembership = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/memberships`,
        headers: authHeader(memberCookie),
        payload: { userId: outsider.id },
      });
      assert.equal(memberCreateMembership.statusCode, 403);
      const memberChangeMembership = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/memberships/${memberMembership.id}/status`,
        headers: authHeader(memberCookie),
        payload: { status: 'inactive' },
      });
      assert.equal(memberChangeMembership.statusCode, 403);
      const memberCreateInvitation = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations`,
        headers: authHeader(memberCookie),
        payload: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
      assert.equal(memberCreateInvitation.statusCode, 403);
      const memberRevokeInvitation = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations/${randomUUID()}/revoke`,
        headers: authHeader(memberCookie),
      });
      assert.equal(memberRevokeInvitation.statusCode, 403);

      // --- institution read and lifecycle ---
      const fetched = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}`, headers: authHeader(ownerCookie) });
      assert.equal(fetched.statusCode, 200);
      assert.equal(JSON.parse(fetched.body).institution.id, tenantId);

      const activated = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/status`,
        headers: authHeader(ownerCookie),
        payload: { status: 'active' },
      });
      assert.equal(activated.statusCode, 200);
      assert.equal(JSON.parse(activated.body).institution.status, 'active');

      const invalidTransition = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/status`,
        headers: authHeader(ownerCookie),
        payload: { status: 'deleted' },
      });
      assert.equal(invalidTransition.statusCode, 409);
      assert.equal(JSON.parse(invalidTransition.body).error.code, 'tenant.invalid_lifecycle_transition');

      const validationError = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        headers: authHeader(ownerCookie),
        payload: { name: '', type: 'school' },
      });
      assert.equal(validationError.statusCode, 400);
      assert.equal(JSON.parse(validationError.body).error.code, 'http.validation_failed');

      // --- memberships ---
      const pendingMembership = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/memberships`,
        headers: authHeader(ownerCookie),
        payload: { userId: outsider.id, status: 'pending' },
      });
      assert.equal(pendingMembership.statusCode, 201);
      assert.equal(JSON.parse(pendingMembership.body).membership.status, 'pending');
      const outsiderMembershipId = JSON.parse(pendingMembership.body).membership.id as string;

      const activatedMembership = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/memberships/${outsiderMembershipId}/status`,
        headers: authHeader(ownerCookie),
        payload: { status: 'active' },
      });
      assert.equal(activatedMembership.statusCode, 200);
      assert.equal(JSON.parse(activatedMembership.body).membership.status, 'active');

      const duplicateMembership = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/memberships`,
        headers: authHeader(ownerCookie),
        payload: { userId: outsider.id },
      });
      assert.equal(duplicateMembership.statusCode, 409);
      assert.equal(JSON.parse(duplicateMembership.body).error.code, 'tenant.membership_already_exists');

      const invalidMembershipTransition = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/memberships/${outsiderMembershipId}/status`,
        headers: authHeader(ownerCookie),
        payload: { status: 'active' },
      });
      assert.equal(invalidMembershipTransition.statusCode, 409);
      assert.equal(JSON.parse(invalidMembershipTransition.body).error.code, 'tenant.invalid_membership_transition');

      const missingMembership = await app.inject({
        method: 'PATCH',
        url: `/v1/tenants/${tenantId}/memberships/00000000-0000-4000-8000-000000000000/status`,
        headers: authHeader(ownerCookie),
        payload: { status: 'ended' },
      });
      assert.equal(missingMembership.statusCode, 404);
      assert.equal(JSON.parse(missingMembership.body).error.code, 'tenant.membership_not_found');

      const membershipList = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/memberships?limit=100`,
        headers: authHeader(ownerCookie),
      });
      assert.equal(membershipList.statusCode, 200);
      const membershipIds = JSON.parse(membershipList.body).items.map((item: { id: string }) => item.id);
      assert.ok(membershipIds.includes(outsiderMembershipId));

      // --- invitations: create (raw token once), list, revoke, accept, failures ---
      const invitation = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations`,
        headers: authHeader(ownerCookie),
        payload: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
      assert.equal(invitation.statusCode, 201);
      const invitationBody = JSON.parse(invitation.body);
      assert.ok(invitationBody.rawToken.length > 0);
      assert.ok(!('tokenHash' in invitationBody.invitation));
      const rawToken = invitationBody.rawToken as string;

      const invitationList = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/invitations?limit=100`,
        headers: authHeader(ownerCookie),
      });
      assert.equal(invitationList.statusCode, 200);
      const invitationItems = JSON.parse(invitationList.body).items as Array<Record<string, unknown>>;
      assert.ok(invitationItems.length >= 1);
      for (const item of invitationItems) {
        assert.ok(!('tokenHash' in item));
        assert.ok(!('rawToken' in item));
      }

      const accepted = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: authHeader(inviteeCookie),
        payload: { rawToken },
      });
      assert.equal(accepted.statusCode, 200);
      const acceptBody = JSON.parse(accepted.body);
      assert.equal(acceptBody.invitation.status, 'accepted');
      assert.equal(acceptBody.membership.status, 'active');
      assert.equal(acceptBody.activated, false);
      assert.equal(acceptBody.previousStatus, null);
      assert.ok(!('tokenHash' in acceptBody.invitation));

      const reusedInvitation = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: authHeader(inviteeCookie),
        payload: { rawToken },
      });
      assert.equal(reusedInvitation.statusCode, 409);
      assert.equal(JSON.parse(reusedInvitation.body).error.code, 'tenant.invitation_acceptance_rejected');

      const revokeTarget = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations`,
        headers: authHeader(ownerCookie),
        payload: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
      const revokedToken = JSON.parse(revokeTarget.body).rawToken as string;
      const revokedInvitationId = JSON.parse(revokeTarget.body).invitation.id as string;
      const revoked = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations/${revokedInvitationId}/revoke`,
        headers: authHeader(ownerCookie),
      });
      assert.equal(revoked.statusCode, 200);
      assert.equal(JSON.parse(revoked.body).invitation.status, 'revoked');
      const revokedAgain = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations/${revokedInvitationId}/revoke`,
        headers: authHeader(ownerCookie),
      });
      assert.equal(revokedAgain.statusCode, 200);
      const acceptRevoked = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: authHeader(inviteeCookie),
        payload: { rawToken: revokedToken },
      });
      assert.equal(acceptRevoked.statusCode, 409);
      assert.equal(JSON.parse(acceptRevoked.body).error.code, 'tenant.invitation_acceptance_rejected');

      const expiredInvitation = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations`,
        headers: authHeader(ownerCookie),
        payload: { expiresAt: new Date(Date.now() - 1_000).toISOString() },
      });
      assert.equal(expiredInvitation.statusCode, 201);
      const acceptExpired = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: authHeader(inviteeCookie),
        payload: { rawToken: JSON.parse(expiredInvitation.body).rawToken },
      });
      assert.equal(acceptExpired.statusCode, 409);
      assert.equal(JSON.parse(acceptExpired.body).error.code, 'tenant.invitation_acceptance_rejected');

      const unknownToken = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: authHeader(inviteeCookie),
        payload: { rawToken: 'unknown-token-that-was-never-issued' },
      });
      assert.equal(unknownToken.statusCode, 409);
      assert.equal(JSON.parse(unknownToken.body).error.code, 'tenant.invitation_acceptance_rejected');

      const missingInvitation = await app.inject({
        method: 'POST',
        url: `/v1/tenants/${tenantId}/invitations/00000000-0000-4000-8000-000000000000/revoke`,
        headers: authHeader(ownerCookie),
      });
      assert.equal(missingInvitation.statusCode, 404);
      assert.equal(JSON.parse(missingInvitation.body).error.code, 'tenant.invitation_not_found');

      // the invitee is now a member and can read tenant data
      const inviteeRead = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}`, headers: authHeader(inviteeCookie) });
      assert.equal(inviteeRead.statusCode, 200);

      // --- pagination: bounded limits and stable pages ---
      const badLimitZero = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/memberships?limit=0`, headers: authHeader(ownerCookie) });
      assert.equal(badLimitZero.statusCode, 400);
      const badLimitHigh = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/memberships?limit=101`, headers: authHeader(ownerCookie) });
      assert.equal(badLimitHigh.statusCode, 400);

      for (const userId of paginationUsers) {
        const createdMembership = await app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/memberships`,
          headers: authHeader(ownerCookie),
          payload: { userId },
        });
        assert.equal(createdMembership.statusCode, 201);
      }

      const collectedMembershipIds: string[] = [];
      let cursor: string | null = null;
      do {
        const pageUrl = cursor === null ? `limit=3` : `limit=3&cursor=${encodeURIComponent(cursor)}`;
        const page = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/memberships?${pageUrl}`, headers: authHeader(ownerCookie) });
        assert.equal(page.statusCode, 200);
        const body = JSON.parse(page.body);
        assert.ok(body.items.length <= 3);
        collectedMembershipIds.push(...body.items.map((item: { id: string }) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      assert.equal(new Set(collectedMembershipIds).size, collectedMembershipIds.length);
      assert.ok(collectedMembershipIds.length >= 7);

      const collectedInvitationIds: string[] = [];
      cursor = null;
      do {
        const pageUrl = cursor === null ? `limit=2` : `limit=2&cursor=${encodeURIComponent(cursor)}`;
        const page = await app.inject({ method: 'GET', url: `/v1/tenants/${tenantId}/invitations?${pageUrl}`, headers: authHeader(ownerCookie) });
        assert.equal(page.statusCode, 200);
        const body = JSON.parse(page.body);
        assert.ok(body.items.length <= 2);
        collectedInvitationIds.push(...body.items.map((item: { id: string }) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      assert.equal(new Set(collectedInvitationIds).size, collectedInvitationIds.length);
      assert.ok(collectedInvitationIds.length >= 3);

      // --- outbox isolation: business flows never enqueue dead-letter-bound messages ---
      const outbox = app.get(OutboxService);
      await assert.rejects(
        () =>
          outbox.enqueue({
            scope: 'platform',
            tenantId: null,
            eventSource: 'smoke',
            eventType: 'membership.created',
            occurrenceId: randomUUID(),
            payload: { proof: 'strict-policy' },
          }),
        /would guarantee a dead letter/,
      );
      const outboxCount = await database.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM outbox_messages',
      );
      assert.equal(outboxCount.rows[0]?.total, 0);
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
        'TRUNCATE TABLE users, password_identities, auth_sessions, institutions, institution_settings, memberships, invitations CASCADE',
      );
    } finally {
      await database.close();
    }
  }
});
