import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import { PostgresInstitutionRepository } from '../../src/tenant/adapters/postgres-institution.repository.js';
import { PostgresInstitutionSettingsRepository } from '../../src/tenant/adapters/postgres-institution-settings.repository.js';
import { PostgresInvitationRepository } from '../../src/tenant/adapters/postgres-invitation.repository.js';
import { PostgresMembershipRepository } from '../../src/tenant/adapters/postgres-membership.repository.js';
import { PostgresTenantTransactionRunner } from '../../src/tenant/adapters/postgres-transaction-runner.js';
import { InstitutionService } from '../../src/tenant/application/institution.service.js';
import { InvitationService } from '../../src/tenant/application/invitation.service.js';
import { MembershipService } from '../../src/tenant/application/membership.service.js';
import {
  DeletedInstitutionError,
  InvitationAcceptanceRejectedError,
  MembershipAlreadyExistsError,
} from '../../src/tenant/domain/errors.js';
import { NoopTenantEventPublisher } from '../../src/tenant/domain/events.js';
import type { Invitation, Membership } from '../../src/tenant/domain/types.js';
import type { InvitationRepository } from '../../src/tenant/ports/invitation.repository.js';
import type { MembershipRepository } from '../../src/tenant/ports/membership.repository.js';
import { Sha256TokenHasher } from '../../src/tenant/token-hasher.js';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

type LifecycleMethod =
  | 'activateInstitution'
  | 'suspendInstitution'
  | 'restoreInstitution'
  | 'moveToGracePeriod'
  | 'archiveInstitution'
  | 'closeInstitution';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

class FailingMembershipRepository implements MembershipRepository {
  failNextCreate = false;

  constructor(private readonly inner: MembershipRepository) {}

  async create(membership: Membership): Promise<void> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('simulated membership write failure');
    }
    await this.inner.create(membership);
  }

  findById(id: string): Promise<Membership | null> {
    return this.inner.findById(id);
  }

  findByUserAndInstitution(userId: string, institutionId: string): Promise<Membership | null> {
    return this.inner.findByUserAndInstitution(userId, institutionId);
  }

  update(membership: Membership): Promise<void> {
    return this.inner.update(membership);
  }
}

class FailingInvitationRepository implements InvitationRepository {
  failNextUpdate = false;

  constructor(private readonly inner: InvitationRepository) {}

  create(invitation: Invitation): Promise<void> {
    return this.inner.create(invitation);
  }

  findById(id: string): Promise<Invitation | null> {
    return this.inner.findById(id);
  }

  findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    return this.inner.findByTokenHash(tokenHash);
  }

  async update(invitation: Invitation): Promise<void> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('simulated invitation write failure');
    }
    await this.inner.update(invitation);
  }
}

describe('tenant persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE institutions, institution_settings, memberships, invitations CASCADE');
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE institutions, institution_settings, memberships, invitations CASCADE');
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
    institutions: InstitutionService;
    memberships: MembershipService;
    invitations: InvitationService;
    resolver: AlsTenantContextResolver;
  } {
    const events = new NoopTenantEventPublisher();
    const resolver = new AlsTenantContextResolver();
    const transactionRunner = new PostgresTenantTransactionRunner(db);
    return {
      institutions: new InstitutionService(
        new PostgresInstitutionRepository(db),
        new PostgresInstitutionSettingsRepository(db),
        transactionRunner,
        events,
      ),
      memberships: new MembershipService(
        new PostgresMembershipRepository(db),
        transactionRunner,
        events,
        resolver,
      ),
      invitations: new InvitationService(
        new PostgresInvitationRepository(db),
        new PostgresMembershipRepository(db),
        new Sha256TokenHasher(),
        transactionRunner,
        events,
        resolver,
      ),
      resolver,
    };
  }

  async function createUserRow(db: PostgresDatabase, email: string): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.query('INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $4)', [
      id,
      email,
      now,
      now,
    ]);
    return id;
  }

  test('tenant migration creates the expected tables', async () => {
    const db = requireDb();
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('institutions', 'institution_settings', 'memberships', 'invitations')`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.table_name).sort(),
      ['institution_settings', 'institutions', 'invitations', 'memberships'],
    );
  });

  test('tenant-scoped indexes lead with tenant_id and uniqueness constraints exist', async () => {
    const db = requireDb();
    const result = await db.query<{ index_name: string; indexdef: string }>(
      `SELECT indexname AS index_name, indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename IN ('memberships', 'invitations', 'institution_settings')`,
    );
    const byName = new Map(result.rows.map((row) => [row.index_name, row.indexdef]));
    assert.ok(byName.get('memberships_tenant_id_user_id_active_key')?.startsWith('CREATE UNIQUE INDEX'));
    assert.ok(byName.get('invitations_token_hash_key')?.startsWith('CREATE UNIQUE INDEX'));
    for (const [name, definition] of byName) {
      if (
        name.endsWith('_pkey') ||
        name === 'invitations_token_hash_key'
      ) {
        continue;
      }
      assert.ok(
        /\(tenant_id[,)]/.test(definition),
        `expected index ${name} to lead with tenant_id but got: ${definition}`,
      );
    }
  });

  test('institution create/read/update lifecycle persists with real adapters', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `owner-${randomUUID()}@example.com`);
    const { institutions } = createServices(db);
    const created = await institutions.createInstitution({
      name: 'Manara University',
      type: 'university',
      createdByUserId: ownerId,
    });
    assert.equal(created.status, 'draft');
    const repo = new PostgresInstitutionRepository(db);
    const persisted = await repo.findById(created.id);
    assert.ok(persisted);
    assert.equal(persisted.name, 'Manara University');
    assert.equal(persisted.type, 'university');
    assert.equal(persisted.createdByUserId, ownerId);
    const activated = await institutions.activateInstitution({
      institutionId: created.id,
      actorUserId: ownerId,
    });
    assert.equal(activated.status, 'active');
    const afterActivation = await repo.findById(created.id);
    assert.ok(afterActivation);
    assert.equal(afterActivation.status, 'active');
  });

  test('institution settings are created with defaults and updates persist', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `settings-${randomUUID()}@example.com`);
    const { institutions } = createServices(db);
    const settingsRepo = new PostgresInstitutionSettingsRepository(db);
    const created = await institutions.createInstitution({
      name: 'Manara School',
      type: 'school',
      createdByUserId: ownerId,
    });
    const defaults = await settingsRepo.getByInstitutionId(created.id);
    assert.ok(defaults);
    assert.equal(defaults.branding.name, 'Manara School');
    assert.equal(defaults.branding.logoUrl, null);
    assert.equal(defaults.language, 'ar');
    assert.equal(defaults.rtl, true);
    assert.equal(defaults.version, 1);
    await settingsRepo.update({
      ...defaults,
      branding: { name: 'Manara School', logoUrl: 'https://cdn.example.com/logo.png', primaryColor: '#1d4ed8' },
      terminology: { teacher: 'مدرب' },
      version: 2,
      updatedAt: new Date(),
    });
    const afterUpdate = await settingsRepo.getByInstitutionId(created.id);
    assert.ok(afterUpdate);
    assert.equal(afterUpdate.branding.logoUrl, 'https://cdn.example.com/logo.png');
    assert.equal(afterUpdate.branding.primaryColor, '#1d4ed8');
    assert.deepEqual(afterUpdate.terminology, { teacher: 'مدرب' });
    assert.equal(afterUpdate.version, 2);
  });

  test('the full institution lifecycle persists and deleted is terminal without purging', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `lifecycle-${randomUUID()}@example.com`);
    const { institutions } = createServices(db);
    const repo = new PostgresInstitutionRepository(db);
    const created = await institutions.createInstitution({
      name: 'Lifecycle Institution',
      type: 'corporate',
      createdByUserId: ownerId,
    });
    const transitions: Array<[LifecycleMethod, string]> = [
      ['activateInstitution', 'active'],
      ['suspendInstitution', 'suspended'],
      ['restoreInstitution', 'active'],
      ['suspendInstitution', 'suspended'],
      ['moveToGracePeriod', 'grace_period'],
      ['archiveInstitution', 'archived'],
      ['closeInstitution', 'deleted'],
    ];
    for (const [method, expectedStatus] of transitions) {
      const current = await repo.findById(created.id);
      assert.ok(current);
      await institutions[method]({ institutionId: created.id, actorUserId: ownerId });
      const after = await repo.findById(created.id);
      assert.ok(after);
      assert.equal(after.status, expectedStatus);
    }
    const deleted = await repo.findById(created.id);
    assert.ok(deleted);
    assert.equal(deleted.status, 'deleted');
    await assert.rejects(
      () => institutions.activateInstitution({ institutionId: created.id, actorUserId: ownerId }),
      (error: unknown) => error instanceof DeletedInstitutionError,
    );
  });

  test('duplicate active membership for the same user and tenant is prevented', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `dup-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `dup-user-${randomUUID()}@example.com`);
    const { institutions, memberships, resolver } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Dup Institution',
      type: 'academy',
      createdByUserId: ownerId,
    });
    const first = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.createMembership({ institutionId: institution.id, userId }),
    );
    assert.equal(first.status, 'active');
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        memberships.createMembership({ institutionId: institution.id, userId }),
      ),
      (error: unknown) => error instanceof MembershipAlreadyExistsError,
    );
    const repo = new PostgresMembershipRepository(db);
    const now = new Date();
    await assert.rejects(
      repo.create({
        id: randomUUID(),
        institutionId: institution.id,
        userId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        endedAt: null,
      }),
      (error: unknown) => (error as { code?: string }).code === '23505',
    );
    assert.equal(resolver.resolveTenantId(), null);
  });

  test('a new membership is allowed after the previous one ended', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `renew-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `renew-user-${randomUUID()}@example.com`);
    const { institutions, memberships } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Renew Institution',
      type: 'school',
      createdByUserId: ownerId,
    });
    const first = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.createMembership({ institutionId: institution.id, userId }),
    );
    const ended = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.changeMembershipStatus({ membershipId: first.id, to: 'ended' }),
    );
    assert.equal(ended.status, 'ended');
    const second = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.createMembership({ institutionId: institution.id, userId }),
    );
    assert.equal(second.status, 'active');
    const repo = new PostgresMembershipRepository(db);
    const renewed = await repo.findByUserAndInstitution(userId, institution.id);
    assert.ok(renewed);
    assert.equal(renewed.id, second.id);
  });

  test('membership status changes persist with timestamps', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `status-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `status-user-${randomUUID()}@example.com`);
    const { institutions, memberships } = createServices(db);
    const repo = new PostgresMembershipRepository(db);
    const institution = await institutions.createInstitution({
      name: 'Status Institution',
      type: 'government',
      createdByUserId: ownerId,
    });
    const created = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.createMembership({ institutionId: institution.id, userId, status: 'pending' }),
    );
    assert.equal(created.status, 'pending');
    const activated = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.changeMembershipStatus({ membershipId: created.id, to: 'active' }),
    );
    assert.equal(activated.status, 'active');
    assert.ok(activated.startedAt);
    const suspended = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.changeMembershipStatus({ membershipId: created.id, to: 'suspended' }),
    );
    assert.equal(suspended.status, 'suspended');
    const restored = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.changeMembershipStatus({ membershipId: created.id, to: 'active' }),
    );
    assert.equal(restored.status, 'active');
    const ended = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      memberships.changeMembershipStatus({ membershipId: created.id, to: 'ended' }),
    );
    assert.equal(ended.status, 'ended');
    assert.ok(ended.endedAt);
    const persisted = await repo.findById(created.id);
    assert.ok(persisted);
    assert.equal(persisted.status, 'ended');
    assert.equal(persisted.startedAt?.getTime(), ended.startedAt?.getTime());
    assert.equal(persisted.endedAt?.getTime(), ended.endedAt?.getTime());
  });

  test('invitation creation persists only the token hash and is found by hash', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `inv-owner-${randomUUID()}@example.com`);
    const { institutions, invitations, resolver } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Invitation Institution',
      type: 'university',
      createdByUserId: ownerId,
    });
    const { invitation, rawToken } = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    assert.equal(invitation.status, 'pending');
    assert.notEqual(rawToken, invitation.tokenHash);
    const row = await db.query<{ token_hash: string }>('SELECT token_hash FROM invitations WHERE id = $1', [
      invitation.id,
    ]);
    assert.equal(row.rows[0]?.token_hash, hashToken(rawToken));
    const repo = new PostgresInvitationRepository(db);
    const byHash = await repo.findByTokenHash(hashToken(rawToken));
    assert.ok(byHash);
    assert.equal(byHash.id, invitation.id);
    const allRows = await db.query<Record<string, unknown>>('SELECT * FROM invitations');
    assert.ok(!JSON.stringify(allRows.rows).includes(rawToken));
    assert.equal(resolver.resolveTenantId(), null);
  });

  test('invitation token hashes are unique at the database level', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `hash-owner-${randomUUID()}@example.com`);
    const { institutions, invitations } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Hash Institution',
      type: 'training_centre',
      createdByUserId: ownerId,
    });
    const first = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const repo = new PostgresInvitationRepository(db);
    const now = new Date();
    const duplicate: Invitation = {
      id: randomUUID(),
      institutionId: institution.id,
      tokenHash: first.invitation.tokenHash,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
    };
    await assert.rejects(repo.create(duplicate), (error: unknown) => (error as { code?: string }).code === '23505');
  });

  test('invitation acceptance is atomic and single-use', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `accept-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `accept-user-${randomUUID()}@example.com`);
    const { institutions, invitations } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Accept Institution',
      type: 'school',
      createdByUserId: ownerId,
    });
    const { rawToken } = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const outcome = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.acceptInvitation({ rawToken, userId }),
    );
    assert.equal(outcome.invitation.status, 'accepted');
    assert.equal(outcome.invitation.acceptedByUserId, userId);
    assert.ok(outcome.invitation.acceptedAt);
    assert.equal(outcome.membership.status, 'active');
    const repo = new PostgresInvitationRepository(db);
    const persistedInvitation = await repo.findByTokenHash(hashToken(rawToken));
    assert.ok(persistedInvitation);
    assert.equal(persistedInvitation.status, 'accepted');
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        invitations.acceptInvitation({ rawToken, userId }),
      ),
      (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
    );
    const memberships = new PostgresMembershipRepository(db);
    const membership = await memberships.findByUserAndInstitution(userId, institution.id);
    assert.ok(membership);
    assert.equal(membership.status, 'active');
  });

  test('acceptance rollback leaves no partial membership and the invitation unconsumed', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `rollback-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `rollback-user-${randomUUID()}@example.com`);
    const { institutions, invitations, memberships: membershipService } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Rollback Institution',
      type: 'academy',
      createdByUserId: ownerId,
    });
    const invitationRepo = new PostgresInvitationRepository(db);
    const membershipRepo = new PostgresMembershipRepository(db);
    const failingInvitations = new FailingInvitationRepository(invitationRepo);
    const failingMemberships = new FailingMembershipRepository(membershipRepo);
    const events = new NoopTenantEventPublisher();
    const transactionRunner = new PostgresTenantTransactionRunner(db);
    const resolver = new AlsTenantContextResolver();
    const { rawToken } = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const firstMembership = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      membershipService.createMembership({ institutionId: institution.id, userId, status: 'ended' }),
    );
    assert.equal(firstMembership.status, 'ended');
    const withFailingInvitationUpdate = new InvitationService(
      failingInvitations,
      membershipRepo,
      new Sha256TokenHasher(),
      transactionRunner,
      events,
      resolver,
    );
    failingInvitations.failNextUpdate = true;
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        withFailingInvitationUpdate.acceptInvitation({ rawToken, userId }),
      ),
      (error: unknown) => error instanceof Error && error.message === 'simulated invitation write failure',
    );
    const membershipAfterFailure = await membershipRepo.findByUserAndInstitution(userId, institution.id);
    assert.ok(membershipAfterFailure);
    assert.equal(membershipAfterFailure.status, 'ended');
    const invitationAfterFailure = await invitationRepo.findByTokenHash(hashToken(rawToken));
    assert.ok(invitationAfterFailure);
    assert.equal(invitationAfterFailure.status, 'pending');
    const secondUserId = await createUserRow(db, `rollback-user-2-${randomUUID()}@example.com`);
    const { rawToken: rawTokenTwo } = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const withFailingMembershipCreate = new InvitationService(
      invitationRepo,
      failingMemberships,
      new Sha256TokenHasher(),
      transactionRunner,
      events,
      resolver,
    );
    failingMemberships.failNextCreate = true;
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        withFailingMembershipCreate.acceptInvitation({ rawToken: rawTokenTwo, userId: secondUserId }),
      ),
      (error: unknown) => error instanceof Error && error.message === 'simulated membership write failure',
    );
    assert.equal(await membershipRepo.findByUserAndInstitution(secondUserId, institution.id), null);
    const invitationTwoAfterFailure = await invitationRepo.findByTokenHash(hashToken(rawTokenTwo));
    assert.ok(invitationTwoAfterFailure);
    assert.equal(invitationTwoAfterFailure.status, 'pending');
    const outcome = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.acceptInvitation({ rawToken: rawTokenTwo, userId: secondUserId }),
    );
    assert.equal(outcome.invitation.status, 'accepted');
    assert.equal(outcome.membership.status, 'active');
  });

  test('invitation revoke and expire persist and remain idempotent for the same status', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `revoke-owner-${randomUUID()}@example.com`);
    const { institutions, invitations } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Revoke Institution',
      type: 'corporate',
      createdByUserId: ownerId,
    });
    const revoked = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const revokedResult = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.revokeInvitation({ invitationId: revoked.invitation.id }),
    );
    assert.equal(revokedResult.status, 'revoked');
    assert.ok(revokedResult.revokedAt);
    const revokedAgain = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.revokeInvitation({ invitationId: revoked.invitation.id }),
    );
    assert.equal(revokedAgain.status, 'revoked');
    const expired = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    const expiredResult = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.expireInvitation({ invitationId: expired.invitation.id }),
    );
    assert.equal(expiredResult.status, 'expired');
    const repo = new PostgresInvitationRepository(db);
    const persisted = await repo.findById(expired.invitation.id);
    assert.ok(persisted);
    assert.equal(persisted.status, 'expired');
  });

  test('accepting an expired or revoked invitation is rejected', async () => {
    const db = requireDb();
    const ownerId = await createUserRow(db, `expired-owner-${randomUUID()}@example.com`);
    const userId = await createUserRow(db, `expired-user-${randomUUID()}@example.com`);
    const { institutions, invitations } = createServices(db);
    const institution = await institutions.createInstitution({
      name: 'Expired Institution',
      type: 'non_profit',
      createdByUserId: ownerId,
    });
    const expired = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() - 1_000),
        createdByUserId: ownerId,
      }),
    );
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        invitations.acceptInvitation({ rawToken: expired.rawToken, userId }),
      ),
      (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
    );
    const revoked = await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.createInvitation({
        institutionId: institution.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerId,
      }),
    );
    await AlsTenantContextResolver.runWithTenant(institution.id, () =>
      invitations.revokeInvitation({ invitationId: revoked.invitation.id }),
    );
    await assert.rejects(
      AlsTenantContextResolver.runWithTenant(institution.id, () =>
        invitations.acceptInvitation({ rawToken: revoked.rawToken, userId }),
      ),
      (error: unknown) => error instanceof InvitationAcceptanceRejectedError,
    );
  });
});
