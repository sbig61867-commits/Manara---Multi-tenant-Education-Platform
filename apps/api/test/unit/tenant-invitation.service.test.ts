import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { InvitationService } from '../../src/tenant/application/invitation.service.js';
import {
  InvitationAcceptanceRejectedError,
  InvitationAlreadyHandledError,
  InvitationNotFoundError,
  MembershipAlreadyActiveError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/tenant/domain/errors.js';
import type { Invitation } from '../../src/tenant/domain/types.js';
import { Sha256TokenHasher } from '../../src/tenant/token-hasher.js';
import {
  createMembership,
  FakeInvitationRepository,
  FakeMembershipRepository,
  FakeTenantContextResolver,
  RecordingTenantEventPublisher,
  sha256,
  TrackingTenantTransactionRunner,
} from './tenant-helpers.js';

const TENANT = 'institution-1';

function createService(tenantId: string | null = TENANT): {
  service: InvitationService;
  invitations: FakeInvitationRepository;
  memberships: FakeMembershipRepository;
  events: RecordingTenantEventPublisher;
  runner: TrackingTenantTransactionRunner;
} {
  const invitations = new FakeInvitationRepository();
  const memberships = new FakeMembershipRepository();
  const events = new RecordingTenantEventPublisher();
  const runner = new TrackingTenantTransactionRunner();
  const service = new InvitationService(
    invitations,
    memberships,
    new Sha256TokenHasher(),
    runner,
    events,
    new FakeTenantContextResolver(tenantId),
  );
  return { service, invitations, memberships, events, runner };
}

function future(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function past(): Date {
  return new Date(Date.now() - 60 * 1000);
}

test('creates an invitation storing only the token hash and returning the raw token once', async () => {
  const { service, invitations } = createService();
  const result = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const stored = await invitations.findById(result.invitation.id);
  assert.ok(stored);
  assert.equal(stored.status, 'pending');
  assert.notEqual(stored.tokenHash, result.rawToken);
  assert.equal(stored.tokenHash, sha256(result.rawToken));
  assert.ok(result.rawToken.length >= 32);
  assert.ok(!JSON.stringify(stored).includes(result.rawToken));
});

test('publishes invitation.created without the raw token or its hash', async () => {
  const { service, events } = createService();
  const result = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const created = events.eventsOfType('invitation.created');
  assert.equal(created.length, 1);
  const serialized = JSON.stringify(created[0]);
  assert.ok(!serialized.includes(result.rawToken));
  assert.ok(!serialized.includes(result.invitation.tokenHash));
});

test('accepts an invitation and creates an active membership atomically', async () => {
  const { service, memberships, runner, events } = createService();
  const { rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const outcome = await service.acceptInvitation({ rawToken, userId: 'user-1' });
  assert.equal(runner.calls, 1);
  assert.equal(runner.maxDepth, 1);
  assert.equal(outcome.invitation.status, 'accepted');
  assert.equal(outcome.invitation.acceptedByUserId, 'user-1');
  assert.equal(outcome.membership.status, 'active');
  assert.equal(outcome.membership.userId, 'user-1');
  assert.equal(outcome.activated, false);
  const membership = await memberships.findByUserAndInstitution('user-1', TENANT);
  assert.ok(membership);
  const accepted = events.eventsOfType('invitation.accepted');
  assert.equal(accepted.length, 1);
  const created = events.eventsOfType('membership.created');
  assert.equal(created.length, 1);
  const serializedEvents = JSON.stringify(events.published);
  assert.ok(!serializedEvents.includes(rawToken));
});

test('acceptance is single-use: a second acceptance is rejected', async () => {
  const { service } = createService();
  const { rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  await service.acceptInvitation({ rawToken, userId: 'user-1' });
  await assert.rejects(
    () => service.acceptInvitation({ rawToken, userId: 'user-2' }),
    (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
  );
});

test('rejects accepting an expired invitation', async () => {
  const { service } = createService();
  const { rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: past(),
    createdByUserId: 'user-admin',
  });
  await assert.rejects(
    () => service.acceptInvitation({ rawToken, userId: 'user-1' }),
    (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
  );
});

test('rejects accepting an unknown token with the same generic error', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.acceptInvitation({ rawToken: 'does-not-exist', userId: 'user-1' }),
    (error: unknown) =>
      error instanceof InvitationAcceptanceRejectedError && error.code === 'tenant.invitation_acceptance_rejected',
  );
});

test('rejects accepting a revoked invitation with the generic error', async () => {
  const { service, invitations } = createService();
  const { invitation, rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const revoked = { ...invitation, status: 'revoked' as const, revokedAt: new Date() };
  await invitations.update(revoked);
  await assert.rejects(
    () => service.acceptInvitation({ rawToken, userId: 'user-1' }),
    (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
  );
});

test('rejects accepting when a duplicate active membership exists', async () => {
  const { service, memberships } = createService();
  const { rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  await memberships.create(createMembership());
  await assert.rejects(
    () => service.acceptInvitation({ rawToken, userId: 'user-1' }),
    (error: unknown) => error instanceof MembershipAlreadyActiveError,
  );
});

test('acceptance activates an existing ended membership instead of creating a duplicate', async () => {
  const { service, memberships, events } = createService();
  const { rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  await memberships.create(createMembership({ status: 'ended', endedAt: new Date() }));
  const outcome = await service.acceptInvitation({ rawToken, userId: 'user-1' });
  assert.equal(outcome.activated, true);
  assert.equal(outcome.membership.status, 'active');
  assert.equal(outcome.previousStatus, 'ended');
  const membershipsForUser = [...memberships.memberships.values()].filter((m) => m.userId === 'user-1');
  assert.equal(membershipsForUser.length, 1);
  const changed = events.eventsOfType('membership.status.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.from, 'ended');
  assert.equal(changed[0]?.to, 'active');
});

test('a failed membership write inside acceptance leaves the invitation pending (rollback-safe ordering)', async () => {
  const { service, memberships, invitations } = createService();
  const { invitation, rawToken } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  memberships.failNextCreate = true;
  await assert.rejects(
    () => service.acceptInvitation({ rawToken, userId: 'user-1' }),
    (error: unknown) => error instanceof Error && error.message === 'simulated persistence failure',
  );
  const stored = await invitations.findById(invitation.id);
  assert.ok(stored);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.acceptedByUserId, null);
});

test('revokes a pending invitation', async () => {
  const { service, events } = createService();
  const { invitation } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const revoked = await service.revokeInvitation({ invitationId: invitation.id });
  assert.equal(revoked.status, 'revoked');
  const revokedEvents = events.eventsOfType('invitation.revoked');
  assert.equal(revokedEvents.length, 1);
});

test('revoking is idempotent for an already revoked invitation', async () => {
  const { service, events } = createService();
  const { invitation } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const revoked = await service.revokeInvitation({ invitationId: invitation.id });
  const again = await service.revokeInvitation({ invitationId: invitation.id });
  assert.equal(again.status, 'revoked');
  assert.deepEqual(again, revoked);
  assert.equal(events.eventsOfType('invitation.revoked').length, 1);
});

test('rejects revoking an accepted invitation', async () => {
  const { service, invitations } = createService();
  const { invitation } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  await invitations.update({ ...invitation, status: 'accepted', acceptedByUserId: 'user-1', acceptedAt: new Date() });
  await assert.rejects(
    () => service.revokeInvitation({ invitationId: invitation.id }),
    (error: unknown) => error instanceof InvitationAlreadyHandledError,
  );
});

test('expires a pending invitation', async () => {
  const { service, events } = createService();
  const { invitation } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  const expired = await service.expireInvitation({ invitationId: invitation.id });
  assert.equal(expired.status, 'expired');
  assert.equal(events.eventsOfType('invitation.expired').length, 1);
});

test('rejects expiring an already accepted invitation', async () => {
  const { service, invitations } = createService();
  const { invitation } = await service.createInvitation({
    institutionId: TENANT,
    expiresAt: future(),
    createdByUserId: 'user-admin',
  });
  await invitations.update({ ...invitation, status: 'accepted', acceptedByUserId: 'user-1', acceptedAt: new Date() });
  await assert.rejects(
    () => service.expireInvitation({ invitationId: invitation.id }),
    (error: unknown) => error instanceof InvitationAlreadyHandledError,
  );
});

test('throws when revoking an unknown invitation', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.revokeInvitation({ invitationId: 'missing' }),
    (error: unknown) => error instanceof InvitationNotFoundError,
  );
});

test('fails closed on invitation creation without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.createInvitation({ institutionId: TENANT, expiresAt: future(), createdByUserId: 'user-admin' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('denies creating an invitation for another tenant', async () => {
  const { service } = createService('institution-other');
  await assert.rejects(
    () => service.createInvitation({ institutionId: TENANT, expiresAt: future(), createdByUserId: 'user-admin' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('denies accepting an invitation for another tenant', async () => {
  const { service, invitations } = createService('institution-other');
  const tokenHash = sha256('some-raw-token');
  const invitation: Invitation = {
    id: 'invitation-x',
    institutionId: TENANT,
    tokenHash,
    status: 'pending',
    expiresAt: future(),
    createdAt: new Date(),
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
  };
  await invitations.create(invitation);
  await assert.rejects(
    () => service.acceptInvitation({ rawToken: 'some-raw-token', userId: 'user-1' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('acceptance never mutates when the invitation belongs to another tenant', async () => {
  const { service, invitations, memberships } = createService('institution-other');
  const tokenHash = sha256('some-raw-token');
  const invitation: Invitation = {
    id: 'invitation-x',
    institutionId: TENANT,
    tokenHash,
    status: 'pending',
    expiresAt: future(),
    createdAt: new Date(),
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
  };
  await invitations.create(invitation);
  await assert.rejects(
    () => service.acceptInvitation({ rawToken: 'some-raw-token', userId: 'user-1' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
  const stored = await invitations.findById(invitation.id);
  assert.equal(stored?.status, 'pending');
  assert.equal(await memberships.findByUserAndInstitution('user-1', TENANT), null);
});

test('denies a cross-tenant revoke', async () => {
  const { service, invitations } = createService('institution-other');
  const invitation: Invitation = {
    id: 'invitation-x',
    institutionId: TENANT,
    tokenHash: sha256('some-raw-token'),
    status: 'pending',
    expiresAt: future(),
    createdAt: new Date(),
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
  };
  await invitations.create(invitation);
  await assert.rejects(
    () => service.revokeInvitation({ invitationId: invitation.id }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('lists invitations newest first with their internal token hashes', async () => {
  const { service, invitations } = createService();
  const now = Date.now();
  for (let index = 0; index < 3; index += 1) {
    await invitations.create({
      id: randomUUID(),
      institutionId: TENANT,
      tokenHash: sha256(`raw-token-${index}`),
      status: 'pending',
      expiresAt: future(),
      createdAt: new Date(now + index * 1000),
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
    });
  }
  const result = await service.listInvitations({ institutionId: TENANT, limit: 10, cursor: null });
  assert.equal(result.items.length, 3);
  assert.equal(result.nextCursor, null);
  assert.ok(result.items[0]?.createdAt.getTime() >= result.items[1]!.createdAt.getTime());
  assert.ok(result.items[0]!.tokenHash.length > 0);
});

test('pages invitations with an opaque cursor', async () => {
  const { service, invitations } = createService();
  const now = Date.now();
  const created: Array<{ id: string; createdAt: Date }> = [];
  for (let index = 0; index < 5; index += 1) {
    const id = randomUUID();
    await invitations.create({
      id,
      institutionId: TENANT,
      tokenHash: sha256(`raw-token-${index}`),
      status: 'pending',
      expiresAt: future(),
      createdAt: new Date(now + index * 1000),
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
    });
    created.push({ id, createdAt: new Date(now + index * 1000) });
  }
  const first = await service.listInvitations({ institutionId: TENANT, limit: 2, cursor: null });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await service.listInvitations({ institutionId: TENANT, limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 2);
  assert.ok(second.nextCursor);
  const third = await service.listInvitations({ institutionId: TENANT, limit: 2, cursor: second.nextCursor });
  assert.equal(third.items.length, 1);
  assert.equal(third.nextCursor, null);
  const seen = new Set([...first.items, ...second.items, ...third.items].map((item) => item.id));
  assert.equal(seen.size, 5);
});

test('listing invitations fails closed without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.listInvitations({ institutionId: TENANT, limit: 10, cursor: null }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('listing invitations denies a cross-tenant target', async () => {
  const { service } = createService('institution-other');
  await assert.rejects(
    () => service.listInvitations({ institutionId: TENANT, limit: 10, cursor: null }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});
