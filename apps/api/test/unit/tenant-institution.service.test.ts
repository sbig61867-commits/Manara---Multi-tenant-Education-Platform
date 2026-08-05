import assert from 'node:assert/strict';
import test from 'node:test';
import { InstitutionService } from '../../src/tenant/application/institution.service.js';
import {
  DeletedInstitutionError,
  InstitutionNotFoundError,
  InvalidLifecycleTransitionError,
} from '../../src/tenant/domain/errors.js';
import {
  createInstitution,
  createInstitutionWithStatus,
  FakeInstitutionRepository,
  FakeInstitutionSettingsRepository,
  RecordingTenantEventPublisher,
  TrackingTenantTransactionRunner,
} from './tenant-helpers.js';

function createService(): {
  service: InstitutionService;
  institutions: FakeInstitutionRepository;
  settings: FakeInstitutionSettingsRepository;
  events: RecordingTenantEventPublisher;
  runner: TrackingTenantTransactionRunner;
} {
  const institutions = new FakeInstitutionRepository();
  const settings = new FakeInstitutionSettingsRepository();
  const events = new RecordingTenantEventPublisher();
  const runner = new TrackingTenantTransactionRunner();
  const service = new InstitutionService(institutions, settings, runner, events);
  return { service, institutions, settings, events, runner };
}

test('creates a draft institution with default settings in a single transaction', async () => {
  const { service, institutions, settings, runner } = createService();
  const institution = await service.createInstitution({
    name: 'Manara University',
    type: 'university',
    createdByUserId: 'user-owner',
  });
  assert.equal(institution.status, 'draft');
  assert.equal(institution.createdByUserId, 'user-owner');
  assert.equal(runner.calls, 1);
  assert.equal(runner.maxDepth, 1);
  const stored = await institutions.findById(institution.id);
  assert.ok(stored);
  const storedSettings = await settings.getByInstitutionId(institution.id);
  assert.ok(storedSettings);
  assert.equal(storedSettings.branding.name, 'Manara University');
  assert.equal(storedSettings.version, 1);
});

test('publishes tenant.created on institution creation', async () => {
  const { service, events } = createService();
  const institution = await service.createInstitution({
    name: 'Manara School',
    type: 'school',
    createdByUserId: 'user-owner',
  });
  const created = events.eventsOfType('tenant.created');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.institutionId, institution.id);
  assert.equal(created[0]?.createdByUserId, 'user-owner');
});

test('activates a draft institution', async () => {
  const { service, institutions, events } = createService();
  const draft = createInstitution();
  await institutions.create(draft);
  const activated = await service.activateInstitution({
    institutionId: draft.id,
    actorUserId: 'user-owner',
  });
  assert.equal(activated.status, 'active');
  const changed = events.eventsOfType('tenant.status.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.from, 'draft');
  assert.equal(changed[0]?.to, 'active');
  assert.equal(changed[0]?.actorUserId, 'user-owner');
});

test('rejects activating an already active institution', async () => {
  const { service, institutions } = createService();
  const active = createInstitutionWithStatus('active');
  await institutions.create(active);
  await assert.rejects(
    () => service.activateInstitution({ institutionId: active.id, actorUserId: 'user-owner' }),
    (error: unknown) =>
      error instanceof InvalidLifecycleTransitionError && error.code === 'tenant.invalid_lifecycle_transition',
  );
});

test('suspends an active institution', async () => {
  const { service, institutions } = createService();
  const active = createInstitutionWithStatus('active');
  await institutions.create(active);
  const suspended = await service.suspendInstitution({ institutionId: active.id, actorUserId: 'user-owner' });
  assert.equal(suspended.status, 'suspended');
});

test('rejects suspending a draft institution', async () => {
  const { service, institutions } = createService();
  const draft = createInstitution();
  await institutions.create(draft);
  await assert.rejects(
    () => service.suspendInstitution({ institutionId: draft.id, actorUserId: 'user-owner' }),
    (error: unknown) => error instanceof InvalidLifecycleTransitionError,
  );
});

test('restores a suspended institution to active', async () => {
  const { service, institutions } = createService();
  const suspended = createInstitutionWithStatus('suspended');
  await institutions.create(suspended);
  const restored = await service.restoreInstitution({ institutionId: suspended.id, actorUserId: 'user-owner' });
  assert.equal(restored.status, 'active');
});

test('restores an institution from grace period to active', async () => {
  const { service, institutions } = createService();
  const grace = createInstitutionWithStatus('grace_period');
  await institutions.create(grace);
  const restored = await service.restoreInstitution({ institutionId: grace.id, actorUserId: 'user-owner' });
  assert.equal(restored.status, 'active');
});

test('moves a suspended institution to grace period', async () => {
  const { service, institutions } = createService();
  const suspended = createInstitutionWithStatus('suspended');
  await institutions.create(suspended);
  const grace = await service.moveToGracePeriod({ institutionId: suspended.id, actorUserId: 'user-owner' });
  assert.equal(grace.status, 'grace_period');
});

test('rejects moving an active institution to grace period', async () => {
  const { service, institutions } = createService();
  const active = createInstitutionWithStatus('active');
  await institutions.create(active);
  await assert.rejects(
    () => service.moveToGracePeriod({ institutionId: active.id, actorUserId: 'user-owner' }),
    (error: unknown) => error instanceof InvalidLifecycleTransitionError,
  );
});

test('archives an institution from grace period', async () => {
  const { service, institutions, events } = createService();
  const grace = createInstitutionWithStatus('grace_period');
  await institutions.create(grace);
  const archived = await service.archiveInstitution({
    institutionId: grace.id,
    actorUserId: 'user-owner',
    reason: 'offboarding complete',
  });
  assert.equal(archived.status, 'archived');
  const changed = events.eventsOfType('tenant.status.changed');
  assert.equal(changed[0]?.reason, 'offboarding complete');
});

test('rejects archiving an active institution directly', async () => {
  const { service, institutions } = createService();
  const active = createInstitutionWithStatus('active');
  await institutions.create(active);
  await assert.rejects(
    () => service.archiveInstitution({ institutionId: active.id, actorUserId: 'user-owner' }),
    (error: unknown) => error instanceof InvalidLifecycleTransitionError,
  );
});

test('closes an archived institution to deleted', async () => {
  const { service, institutions } = createService();
  const archived = createInstitutionWithStatus('archived');
  await institutions.create(archived);
  const closed = await service.closeInstitution({ institutionId: archived.id, actorUserId: 'user-owner' });
  assert.equal(closed.status, 'deleted');
});

test('rejects closing an active institution', async () => {
  const { service, institutions } = createService();
  const active = createInstitutionWithStatus('active');
  await institutions.create(active);
  await assert.rejects(
    () => service.closeInstitution({ institutionId: active.id, actorUserId: 'user-owner' }),
    (error: unknown) => error instanceof InvalidLifecycleTransitionError,
  );
});

test('deleted is terminal: every transition from deleted is rejected', async () => {
  const { service, institutions } = createService();
  const deleted = createInstitutionWithStatus('deleted');
  await institutions.create(deleted);
  const attempts = [
    () => service.activateInstitution({ institutionId: deleted.id, actorUserId: 'user-owner' }),
    () => service.suspendInstitution({ institutionId: deleted.id, actorUserId: 'user-owner' }),
    () => service.restoreInstitution({ institutionId: deleted.id, actorUserId: 'user-owner' }),
    () => service.moveToGracePeriod({ institutionId: deleted.id, actorUserId: 'user-owner' }),
    () => service.archiveInstitution({ institutionId: deleted.id, actorUserId: 'user-owner' }),
    () => service.closeInstitution({ institutionId: deleted.id, actorUserId: 'user-owner' }),
  ];
  for (const attempt of attempts) {
    await assert.rejects(attempt, (error: unknown) => error instanceof DeletedInstitutionError);
  }
});

test('throws when the institution does not exist', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.activateInstitution({ institutionId: 'missing', actorUserId: 'user-owner' }),
    (error: unknown) => error instanceof InstitutionNotFoundError,
  );
});

test('gets an existing institution', async () => {
  const { service, institutions } = createService();
  const institution = createInstitution();
  await institutions.create(institution);
  const fetched = await service.getInstitution({ institutionId: institution.id });
  assert.equal(fetched.id, institution.id);
  assert.equal(fetched.name, institution.name);
  assert.equal(fetched.type, institution.type);
  assert.equal(fetched.status, institution.status);
});

test('getInstitution throws when the institution does not exist', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.getInstitution({ institutionId: 'missing' }),
    (error: unknown) => error instanceof InstitutionNotFoundError,
  );
});
