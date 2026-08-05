import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { InstitutionService } from '../../src/tenant/application/institution.service.js';
import type { InvitationService } from '../../src/tenant/application/invitation.service.js';
import type { MembershipService } from '../../src/tenant/application/membership.service.js';
import { InstitutionNotFoundError } from '../../src/tenant/domain/errors.js';
import type { Institution, Invitation } from '../../src/tenant/domain/types.js';
import { InvitationController, TenantController } from '../../src/tenants/tenant.controller.js';
import { createInstitution, createMembership } from './tenant-helpers.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

function createInvitation(overrides?: Partial<Invitation>): Invitation {
  const now = new Date();
  return {
    id: randomUUID(),
    institutionId: TENANT_ID,
    tokenHash: 'not-exposed',
    status: 'pending',
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

interface TenantServiceStubs {
  createInstitution?: InstitutionService['createInstitution'];
  getInstitution?: InstitutionService['getInstitution'];
  activateInstitution?: InstitutionService['activateInstitution'];
  suspendInstitution?: InstitutionService['suspendInstitution'];
  moveToGracePeriod?: InstitutionService['moveToGracePeriod'];
  archiveInstitution?: InstitutionService['archiveInstitution'];
  closeInstitution?: InstitutionService['closeInstitution'];
  createMembership?: MembershipService['createMembership'];
  changeMembershipStatus?: MembershipService['changeMembershipStatus'];
  listMemberships?: MembershipService['listMemberships'];
  createInvitation?: InvitationService['createInvitation'];
  listInvitations?: InvitationService['listInvitations'];
  revokeInvitation?: InvitationService['revokeInvitation'];
  acceptInvitation?: InvitationService['acceptInvitation'];
}

function createControllers(overrides: TenantServiceStubs = {}): {
  tenant: TenantController;
  invitations: InvitationController;
} {
  const institutions = {
    createInstitution: overrides.createInstitution ?? (async (command: { name: string; type: Institution['type']; createdByUserId: string }) => createInstitution({ id: TENANT_ID, name: command.name, type: command.type, createdByUserId: command.createdByUserId })),
    getInstitution: overrides.getInstitution ?? (async () => createInstitution({ id: TENANT_ID })),
    activateInstitution: overrides.activateInstitution ?? (async () => createInstitution({ id: TENANT_ID, status: 'active' })),
    suspendInstitution: overrides.suspendInstitution ?? (async () => createInstitution({ id: TENANT_ID, status: 'suspended' })),
    moveToGracePeriod: overrides.moveToGracePeriod ?? (async () => createInstitution({ id: TENANT_ID, status: 'grace_period' })),
    archiveInstitution: overrides.archiveInstitution ?? (async () => createInstitution({ id: TENANT_ID, status: 'archived' })),
    closeInstitution: overrides.closeInstitution ?? (async () => createInstitution({ id: TENANT_ID, status: 'deleted' })),
  } as unknown as InstitutionService;
  const memberships = {
    createMembership: overrides.createMembership ?? (async () => createMembership({ id: randomUUID(), institutionId: TENANT_ID })),
    changeMembershipStatus: overrides.changeMembershipStatus ?? (async () => createMembership({ id: randomUUID(), institutionId: TENANT_ID })),
    listMemberships: overrides.listMemberships ?? (async () => ({ items: [], nextCursor: null })),
  } as unknown as MembershipService;
  const invitations = {
    createInvitation: overrides.createInvitation ?? (async () => ({ invitation: createInvitation(), rawToken: 'one-time-token' })),
    listInvitations: overrides.listInvitations ?? (async () => ({ items: [], nextCursor: null })),
    revokeInvitation: overrides.revokeInvitation ?? (async () => createInvitation({ status: 'revoked', revokedAt: new Date() })),
    acceptInvitation: overrides.acceptInvitation ?? (async () => ({
      invitation: createInvitation({ status: 'accepted', acceptedByUserId: USER_ID, acceptedAt: new Date() }),
      membership: createMembership({ id: randomUUID(), institutionId: TENANT_ID, userId: USER_ID }),
      activated: false,
      previousStatus: null,
    })),
  } as unknown as InvitationService;
  const requestContext = {
    get: () => ({ authenticatedUserId: USER_ID }),
    update: () => undefined,
  };
  return {
    tenant: new TenantController(
      institutions,
      memberships,
      invitations,
      requestContext as never,
    ),
    invitations: new InvitationController(invitations, requestContext as never),
  };
}

test('createInstitution forwards the authenticated user and returns the institution view', async () => {
  let createdBy: string | undefined;
  const { tenant } = createControllers({
    createInstitution: async (command) => {
      createdBy = command.createdByUserId;
      return createInstitution({ id: TENANT_ID, name: command.name, type: command.type });
    },
  });
  const response = await tenant.createInstitution({ name: 'Manara University', type: 'university' });
  assert.equal(createdBy, USER_ID);
  assert.equal(response.institution.id, TENANT_ID);
  assert.equal(response.institution.name, 'Manara University');
  assert.equal(response.institution.status, 'draft');
  assert.deepEqual(Object.keys(response.institution).sort(), ['createdAt', 'id', 'name', 'status', 'type', 'updatedAt']);
});

test('getInstitution returns the institution for the requested tenant', async () => {
  let requestedId: string | undefined;
  const { tenant } = createControllers({
    getInstitution: async (command) => {
      requestedId = command.institutionId;
      return createInstitution({ id: TENANT_ID, name: 'Manara Academy' });
    },
  });
  const response = await tenant.getInstitution({ tenantId: TENANT_ID });
  assert.equal(requestedId, TENANT_ID);
  assert.equal(response.institution.name, 'Manara Academy');
});

test('getInstitution propagates not-found errors', async () => {
  const { tenant } = createControllers({
    getInstitution: async () => {
      throw new InstitutionNotFoundError('Institution not found');
    },
  });
  await assert.rejects(tenant.getInstitution({ tenantId: TENANT_ID }), InstitutionNotFoundError);
});

test('changeTenantStatus maps each target status to the lifecycle method', async () => {
  const calls: Array<{ method: string; institutionId: string }> = [];
  const record =
    (method: string) =>
    async (command: { institutionId: string }): Promise<Institution> => {
      calls.push({ method, institutionId: command.institutionId });
      return createInstitution({ id: command.institutionId });
    };
  const { tenant } = createControllers({
    activateInstitution: record('activate'),
    suspendInstitution: record('suspend'),
    moveToGracePeriod: record('grace'),
    archiveInstitution: record('archive'),
    closeInstitution: record('close'),
  });
  await tenant.changeTenantStatus({ tenantId: TENANT_ID }, { status: 'active' });
  await tenant.changeTenantStatus({ tenantId: TENANT_ID }, { status: 'suspended' });
  await tenant.changeTenantStatus({ tenantId: TENANT_ID }, { status: 'grace_period' });
  await tenant.changeTenantStatus({ tenantId: TENANT_ID }, { status: 'archived' });
  await tenant.changeTenantStatus({ tenantId: TENANT_ID }, { status: 'deleted' });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['activate', 'suspend', 'grace', 'archive', 'close'],
  );
  for (const call of calls) {
    assert.equal(call.institutionId, TENANT_ID);
  }
});

test('listMemberships returns the paginated envelope', async () => {
  let received: { institutionId: string; limit: number; cursor: string | null } | undefined;
  const { tenant } = createControllers({
    listMemberships: async (command) => {
      received = command;
      return {
        items: [createMembership({ id: randomUUID(), institutionId: command.institutionId, userId: USER_ID })],
        nextCursor: 'next-page',
      };
    },
  });
  const response = await tenant.listMemberships({ tenantId: TENANT_ID }, { limit: 25, cursor: 'cursor-value' });
  assert.deepEqual(received, { institutionId: TENANT_ID, limit: 25, cursor: 'cursor-value' });
  assert.equal(response.items.length, 1);
  assert.equal(response.nextCursor, 'next-page');
  assert.ok(!('tokenHash' in response.items[0]!));
});

test('createMembership forwards userId and status', async () => {
  let received: { institutionId: string; userId: string; status: string } | undefined;
  const { tenant } = createControllers({
    createMembership: async (command) => {
      received = command;
      return createMembership({ id: randomUUID(), institutionId: command.institutionId, userId: command.userId });
    },
  });
  const response = await tenant.createMembership({ tenantId: TENANT_ID }, { userId: USER_ID, status: 'pending' });
  assert.deepEqual(received, { institutionId: TENANT_ID, userId: USER_ID, status: 'pending' });
  assert.equal(response.membership.userId, USER_ID);
});

test('changeMembershipStatus forwards membershipId and target status', async () => {
  const membershipId = randomUUID();
  let received: { membershipId: string; to: string } | undefined;
  const { tenant } = createControllers({
    changeMembershipStatus: async (command) => {
      received = command;
      return createMembership({ id: command.membershipId, institutionId: TENANT_ID, userId: USER_ID });
    },
  });
  await tenant.changeMembershipStatus({ tenantId: TENANT_ID, membershipId }, { status: 'inactive' });
  assert.deepEqual(received, { membershipId, to: 'inactive' });
});

test('listInvitations returns the paginated envelope without token hashes', async () => {
  let received: { institutionId: string; limit: number; cursor: string | null } | undefined;
  const { tenant } = createControllers({
    listInvitations: async (command) => {
      received = command;
      return { items: [createInvitation()], nextCursor: null };
    },
  });
  const response = await tenant.listInvitations({ tenantId: TENANT_ID }, { limit: 50 });
  assert.deepEqual(received, { institutionId: TENANT_ID, limit: 50, cursor: null });
  assert.equal(response.items.length, 1);
  assert.deepEqual(
    Object.keys(response.items[0]!).sort(),
    ['acceptedAt', 'acceptedByUserId', 'createdAt', 'expiresAt', 'id', 'institutionId', 'revokedAt', 'status'],
  );
});

test('createInvitation returns the raw token exactly once with the invitation view', async () => {
  const { tenant } = createControllers({
    createInvitation: async () => ({ invitation: createInvitation(), rawToken: 'one-time-raw-token' }),
  });
  const response = await tenant.createInvitation({ tenantId: TENANT_ID }, { expiresAt: new Date() });
  assert.equal(response.rawToken, 'one-time-raw-token');
  assert.ok(!('tokenHash' in response.invitation));
});

test('revokeInvitation forwards the invitation id', async () => {
  const invitationId = randomUUID();
  let received: { invitationId: string } | undefined;
  const { tenant } = createControllers({
    revokeInvitation: async (command) => {
      received = command;
      return createInvitation({ id: command.invitationId, status: 'revoked', revokedAt: new Date() });
    },
  });
  const response = await tenant.revokeInvitation({ tenantId: TENANT_ID, invitationId });
  assert.deepEqual(received, { invitationId });
  assert.equal(response.invitation.status, 'revoked');
  assert.ok(!('tokenHash' in response.invitation));
});

test('acceptInvitation forwards the raw token and the authenticated user', async () => {
  let received: { rawToken: string; userId: string } | undefined;
  const { invitations } = createControllers({
    acceptInvitation: async (command) => {
      received = command;
      return {
        invitation: createInvitation({ status: 'accepted', acceptedByUserId: command.userId, acceptedAt: new Date() }),
        membership: createMembership({ id: randomUUID(), institutionId: TENANT_ID, userId: command.userId }),
        activated: true,
        previousStatus: 'pending',
      };
    },
  });
  const response = await invitations.acceptInvitation({ rawToken: 'one-time-raw-token' });
  assert.deepEqual(received, { rawToken: 'one-time-raw-token', userId: USER_ID });
  assert.equal(response.activated, true);
  assert.equal(response.previousStatus, 'pending');
  assert.equal(response.membership.userId, USER_ID);
  assert.ok(!('tokenHash' in response.invitation));
});

test('controllers fail fast when the authenticated user is missing', async () => {
  const requestContext = {
    get: () => ({ authenticatedUserId: null }),
    update: () => undefined,
  };
  const institutions = {
    createInstitution: async () => createInstitution({ id: TENANT_ID }),
  } as unknown as InstitutionService;
  const memberships = {} as unknown as MembershipService;
  const invitations = {} as unknown as InvitationService;
  const tenant = new TenantController(institutions, memberships, invitations, requestContext as never);
  await assert.rejects(
    () => tenant.createInstitution({ name: 'Manara University', type: 'university' }),
    (error: unknown) => error instanceof Error && /authenticatedUserId/.test(error.message),
  );
});

test('acceptInvitation fails fast when the authenticated user is missing', async () => {
  const requestContext = {
    get: () => ({ authenticatedUserId: null }),
    update: () => undefined,
  };
  const invitations = {} as unknown as InvitationService;
  const controller = new InvitationController(invitations, requestContext as never);
  await assert.rejects(
    () => controller.acceptInvitation({ rawToken: 'one-time-raw-token' }),
    (error: unknown) => error instanceof Error && /authenticatedUserId/.test(error.message),
  );
});
