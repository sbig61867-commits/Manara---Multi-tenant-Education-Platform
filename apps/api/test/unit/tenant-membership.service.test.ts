import assert from 'node:assert/strict';
import test from 'node:test';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import {
  InvalidMembershipTransitionError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/tenant/domain/errors.js';
import {
  createMembership,
  FakeMembershipRepository,
  FakeTenantContextResolver,
  RecordingTenantEventPublisher,
  TrackingTenantTransactionRunner,
} from './tenant-helpers.js';

const TENANT = 'institution-1';

function createService(tenantId: string | null = TENANT): {
  service: MembershipService;
  memberships: FakeMembershipRepository;
  events: RecordingTenantEventPublisher;
  runner: TrackingTenantTransactionRunner;
} {
  const memberships = new FakeMembershipRepository();
  const events = new RecordingTenantEventPublisher();
  const runner = new TrackingTenantTransactionRunner();
  const service = new MembershipService(
    memberships,
    runner,
    events,
    new FakeTenantContextResolver(tenantId),
  );
  return { service, memberships, events, runner };
}

test('creates an active membership within the tenant context', async () => {
  const { service, memberships, runner } = createService();
  const membership = await service.createMembership({ institutionId: TENANT, userId: 'user-1' });
  assert.equal(membership.status, 'active');
  assert.equal(membership.institutionId, TENANT);
  assert.equal(membership.userId, 'user-1');
  assert.equal(runner.calls, 1);
  assert.ok(await memberships.findById(membership.id));
});

test('publishes membership.created', async () => {
  const { service, events } = createService();
  const membership = await service.createMembership({ institutionId: TENANT, userId: 'user-1' });
  const created = events.eventsOfType('membership.created');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.membershipId, membership.id);
  assert.equal(created[0]?.status, 'active');
});

test('rejects a duplicate active membership for the same user and institution', async () => {
  const { service, memberships } = createService();
  await memberships.create(createMembership());
  await assert.rejects(
    () => service.createMembership({ institutionId: TENANT, userId: 'user-1' }),
    (error: unknown) => error instanceof MembershipAlreadyExistsError,
  );
});

test('allows a new membership after the previous one ended', async () => {
  const { service, memberships } = createService();
  await memberships.create(createMembership({ status: 'ended', endedAt: new Date() }));
  const membership = await service.createMembership({ institutionId: TENANT, userId: 'user-1' });
  assert.equal(membership.status, 'active');
});

test('creates a pending membership when requested', async () => {
  const { service } = createService();
  const membership = await service.createMembership({
    institutionId: TENANT,
    userId: 'user-1',
    status: 'pending',
  });
  assert.equal(membership.status, 'pending');
  assert.equal(membership.startedAt, null);
});

test('fails closed when tenant context is missing', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.createMembership({ institutionId: TENANT, userId: 'user-1' }),
    (error: unknown) => error instanceof MissingTenantContextError && error.code === 'tenant.context_missing',
  );
});

test('denies a cross-tenant membership creation', async () => {
  const { service } = createService('institution-other');
  await assert.rejects(
    () => service.createMembership({ institutionId: TENANT, userId: 'user-1' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('changes an active membership to suspended', async () => {
  const { service, memberships, events } = createService();
  const membership = createMembership();
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'suspended' });
  assert.equal(updated.status, 'suspended');
  const changed = events.eventsOfType('membership.status.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.from, 'active');
  assert.equal(changed[0]?.to, 'suspended');
});

test('restores a suspended membership to active', async () => {
  const { service, memberships } = createService();
  const membership = createMembership({ status: 'suspended' });
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'active' });
  assert.equal(updated.status, 'active');
});

test('ends an active membership', async () => {
  const { service, memberships } = createService();
  const membership = createMembership();
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'ended' });
  assert.equal(updated.status, 'ended');
  assert.ok(updated.endedAt);
});

test('activates a pending membership', async () => {
  const { service, memberships } = createService();
  const membership = createMembership({ status: 'pending', startedAt: null });
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'active' });
  assert.equal(updated.status, 'active');
  assert.ok(updated.startedAt);
});

test('deactivates an active membership', async () => {
  const { service, memberships } = createService();
  const membership = createMembership();
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'inactive' });
  assert.equal(updated.status, 'inactive');
});

test('reactivates an inactive membership', async () => {
  const { service, memberships } = createService();
  const membership = createMembership({ status: 'inactive' });
  await memberships.create(membership);
  const updated = await service.changeMembershipStatus({ membershipId: membership.id, to: 'active' });
  assert.equal(updated.status, 'active');
});

test('rejects an invalid membership transition', async () => {
  const { service, memberships } = createService();
  const membership = createMembership({ status: 'pending' });
  await memberships.create(membership);
  await assert.rejects(
    () => service.changeMembershipStatus({ membershipId: membership.id, to: 'suspended' }),
    (error: unknown) => error instanceof InvalidMembershipTransitionError,
  );
});

test('ended is terminal: no transition out of ended', async () => {
  const { service, memberships } = createService();
  const membership = createMembership({ status: 'ended', endedAt: new Date() });
  await memberships.create(membership);
  await assert.rejects(
    () => service.changeMembershipStatus({ membershipId: membership.id, to: 'active' }),
    (error: unknown) => error instanceof InvalidMembershipTransitionError,
  );
});

test('throws when the membership does not exist', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.changeMembershipStatus({ membershipId: 'missing', to: 'ended' }),
    (error: unknown) => error instanceof MembershipNotFoundError,
  );
});

test('denies a cross-tenant membership status change', async () => {
  const { service, memberships } = createService('institution-other');
  const membership = createMembership();
  await memberships.create(membership);
  await assert.rejects(
    () => service.changeMembershipStatus({ membershipId: membership.id, to: 'ended' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('fails closed on membership status change without context', async () => {
  const { service, memberships } = createService(null);
  const membership = createMembership();
  await memberships.create(membership);
  await assert.rejects(
    () => service.changeMembershipStatus({ membershipId: membership.id, to: 'ended' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});
