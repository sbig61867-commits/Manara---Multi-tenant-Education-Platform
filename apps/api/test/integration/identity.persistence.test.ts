import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { PostgresPasswordIdentityRepository } from '../../src/identity/adapters/postgres-password-identity.repository.js';
import { PostgresSessionRepository } from '../../src/identity/adapters/postgres-session.repository.js';
import { PostgresTransactionRunner } from '../../src/identity/adapters/postgres-transaction-runner.js';
import { PostgresUserRepository } from '../../src/identity/adapters/postgres-user.repository.js';
import { CredentialVerificationService } from '../../src/identity/application/credential-verification.service.js';
import { PasswordIdentityService } from '../../src/identity/application/password-identity.service.js';
import { SessionService } from '../../src/identity/application/session.service.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import { InvalidCredentialsError } from '../../src/identity/domain/errors.js';
import { NoopIdentityEventPublisher } from '../../src/identity/domain/events.js';
import type { AuthSession, PasswordIdentity, User } from '../../src/identity/domain/types.js';
import { Argon2idPasswordHasher } from '../../src/identity/hasher.js';
import type { PasswordIdentityRepository } from '../../src/identity/ports/identity.repository.js';
import {
  CollectingLogger,
  MIGRATIONS_DIR,
  createTestDatabase,
  getTestDatabaseUrl,
} from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('identity persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE users, password_identities, auth_sessions CASCADE');
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE users, password_identities, auth_sessions CASCADE');
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

  async function createUserRow(repo: PostgresUserRepository, email: string): Promise<User> {
    const now = new Date();
    const user: User = { id: randomUUID(), email, createdAt: now, updatedAt: now };
    await repo.create(user);
    return user;
  }

  function createRegistration(
    db: PostgresDatabase,
    users: PostgresUserRepository,
    identities: PostgresPasswordIdentityRepository,
    events = new NoopIdentityEventPublisher(),
  ): UserCreationService {
    return new UserCreationService(
      users,
      identities,
      new Argon2idPasswordHasher(),
      events,
      new PostgresTransactionRunner(db),
    );
  }

  class FailingIdentityRepository implements PasswordIdentityRepository {
    constructor(private readonly inner: PasswordIdentityRepository) {}

    async create(_identity: PasswordIdentity): Promise<void> {
      throw new Error('simulated password identity write failure');
    }

    findByUserId(userId: string): Promise<PasswordIdentity | null> {
      return this.inner.findByUserId(userId);
    }

    update(identity: PasswordIdentity): Promise<void> {
      return this.inner.update(identity);
    }
  }

  test('identity migration creates the expected tables', async () => {
    const db = requireDb();
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'password_identities', 'auth_sessions')`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.table_name).sort(),
      ['auth_sessions', 'password_identities', 'users'],
    );
  });

  test('user repository create, find, and update flows', async () => {
    const db = requireDb();
    const repo = new PostgresUserRepository(db);
    const user = await createUserRow(repo, 'student@example.com');
    const byEmail = await repo.findByEmail('STUDENT@Example.COM');
    assert.ok(byEmail);
    assert.equal(byEmail.id, user.id);
    assert.equal(byEmail.email, 'student@example.com');
    const byId = await repo.findById(user.id);
    assert.ok(byId);
    assert.equal(byId.id, user.id);
    await repo.update({ ...user, email: 'renamed@example.com', updatedAt: new Date() });
    assert.equal(await repo.findByEmail('student@example.com'), null);
    assert.ok(await repo.findByEmail('renamed@example.com'));
  });

  test('email uniqueness is enforced case-insensitively', async () => {
    const db = requireDb();
    const repo = new PostgresUserRepository(db);
    const now = new Date();
    await repo.create({ id: randomUUID(), email: 'unique@example.com', createdAt: now, updatedAt: now });
    await assert.rejects(
      repo.create({ id: randomUUID(), email: 'UNIQUE@example.com', createdAt: now, updatedAt: now }),
      (error: unknown) => (error as { code?: string }).code === '23505',
    );
  });

  test('password identity repository create, find, and update flows', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const user = await createUserRow(users, 'identity@example.com');
    const now = new Date();
    const identity: PasswordIdentity = {
      id: randomUUID(),
      userId: user.id,
      passwordHash: 'argon2id$first-hash',
      createdAt: now,
      updatedAt: now,
    };
    await identities.create(identity);
    const found = await identities.findByUserId(user.id);
    assert.ok(found);
    assert.equal(found.passwordHash, 'argon2id$first-hash');
    await identities.update({ ...found, passwordHash: 'argon2id$second-hash', updatedAt: new Date() });
    const afterUpdate = await identities.findByUserId(user.id);
    assert.ok(afterUpdate);
    assert.equal(afterUpdate.passwordHash, 'argon2id$second-hash');
  });

  test('session repository create, find, update, and revoke flows', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const sessions = new PostgresSessionRepository(db);
    const user = await createUserRow(users, 'sessions@example.com');
    const now = new Date();
    const session: AuthSession = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashToken('raw-token-one'),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      idleExpiresAt: new Date(now.getTime() + 1_800_000),
      revokedAt: null,
    };
    const second: AuthSession = {
      ...session,
      id: randomUUID(),
      tokenHash: hashToken('raw-token-two'),
    };
    await sessions.create(session);
    await sessions.create(second);
    assert.ok(await sessions.findById(session.id));
    assert.ok(await sessions.findByTokenHash(hashToken('raw-token-one')));
    await sessions.update({ ...session, idleExpiresAt: new Date(now.getTime() + 900_000) });
    const refreshed = await sessions.findById(session.id);
    assert.ok(refreshed);
    assert.equal(refreshed.idleExpiresAt.getTime(), now.getTime() + 900_000);
    const revoked = await sessions.revokeAllForUser(user.id);
    assert.equal(revoked, 2);
    assert.equal(await sessions.findById(session.id), null);
    assert.equal(await sessions.findByTokenHash(hashToken('raw-token-one')), null);
    assert.equal(await sessions.revokeAllForUser(user.id), 0);
  });

  test('session tokens are persisted only as hashes', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const sessions = new PostgresSessionRepository(db);
    const user = await createUserRow(users, 'hash-only@example.com');
    const service = new SessionService(sessions, new NoopIdentityEventPublisher());
    const { session, token } = await service.createSession(user.id);
    const row = await db.query<{ token_hash: string }>(
      'SELECT token_hash FROM auth_sessions WHERE id = $1',
      [session.id],
    );
    assert.equal(row.rows[0]?.token_hash, hashToken(token));
    const allRows = await db.query<Record<string, unknown>>('SELECT * FROM auth_sessions');
    assert.ok(!JSON.stringify(allRows.rows).includes(token));
  });

  test('repository writes roll back when the ambient transaction fails', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const now = new Date();
    const user: User = { id: randomUUID(), email: 'rollback@example.com', createdAt: now, updatedAt: now };
    await assert.rejects(
      db.withTransaction(async () => {
        await users.create(user);
        throw new Error('boom');
      }),
    );
    assert.equal(await users.findByEmail('rollback@example.com'), null);
  });

  test('repository writes commit when the ambient transaction succeeds', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const now = new Date();
    const user: User = { id: randomUUID(), email: 'committed@example.com', createdAt: now, updatedAt: now };
    await db.withTransaction(async () => {
      await users.create(user);
    });
    assert.ok(await users.findByEmail('committed@example.com'));
  });

  test('repository reads observe writes inside the ambient transaction', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const now = new Date();
    const user: User = { id: randomUUID(), email: 'visible@example.com', createdAt: now, updatedAt: now };
    let visible = false;
    await db.withTransaction(async () => {
      await users.create(user);
      visible = (await users.findByEmail('visible@example.com')) !== null;
    });
    assert.equal(visible, true);
  });

  test('registerUser commits the user and its password identity atomically', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const registration = createRegistration(db, users, identities);

    const user = await registration.registerUser({ email: 'atomic-commit@example.com', password: 'correct-horse-9' });
    assert.ok(await users.findByEmail('atomic-commit@example.com'));
    assert.ok(await identities.findByUserId(user.id));
  });

  test('registerUser rolls back and leaves no partial user when the password identity write fails', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const failingIdentities = new FailingIdentityRepository(identities);
    const registration = new UserCreationService(
      users,
      failingIdentities,
      new Argon2idPasswordHasher(),
      new NoopIdentityEventPublisher(),
      new PostgresTransactionRunner(db),
    );

    await assert.rejects(
      () => registration.registerUser({ email: 'atomic-rollback@example.com', password: 'correct-horse-9' }),
      (error: unknown) => error instanceof Error && error.message === 'simulated password identity write failure',
    );
    assert.equal(await users.findByEmail('atomic-rollback@example.com'), null);
  });

  test('registration, authentication, and session rotation work against real adapters', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const sessions = new PostgresSessionRepository(db);
    const events = new NoopIdentityEventPublisher();
    const hasher = new Argon2idPasswordHasher();
    const registration = createRegistration(db, users, identities, events);
    const verification = new CredentialVerificationService(users, identities, hasher);
    const sessionService = new SessionService(sessions, events);

    const user = await registration.registerUser({ email: 'flow@example.com', password: 'correct-horse-9' });
    const authenticated = await verification.authenticate('flow@example.com', 'correct-horse-9');
    assert.equal(authenticated.id, user.id);
    const first = await sessionService.createSession(user.id);
    const rotated = await sessionService.rotateSession(first.token);
    assert.ok(rotated);
    assert.equal(await sessionService.validateSession(first.token), null);
    assert.ok(await sessionService.validateSession(rotated.token));
    assert.equal(await sessionService.revokeSession(rotated.token), true);
    assert.equal(await sessionService.revokeSession(rotated.token), false);
  });

  test('password change revokes all active sessions', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const sessions = new PostgresSessionRepository(db);
    const events = new NoopIdentityEventPublisher();
    const hasher = new Argon2idPasswordHasher();
    const registration = createRegistration(db, users, identities, events);
    const verification = new CredentialVerificationService(users, identities, hasher);
    const sessionService = new SessionService(sessions, events);
    const passwordService = new PasswordIdentityService(users, identities, hasher, sessionService, events);

    const user = await registration.registerUser({ email: 'change@example.com', password: 'correct-horse-9' });
    const active = await sessionService.createSession(user.id);
    const second = await sessionService.createSession(user.id);
    await passwordService.changePassword(user.id, 'correct-horse-9', 'new-password-1');
    assert.equal(await sessionService.validateSession(active.token), null);
    assert.equal(await sessionService.validateSession(second.token), null);
    await assert.rejects(
      () => verification.authenticate('change@example.com', 'correct-horse-9'),
      (error: unknown) => error instanceof InvalidCredentialsError,
    );
    const fresh = await verification.authenticate('change@example.com', 'new-password-1');
    assert.equal(fresh.id, user.id);
  });

  test('password reset revokes all active sessions', async () => {
    const db = requireDb();
    const users = new PostgresUserRepository(db);
    const identities = new PostgresPasswordIdentityRepository(db);
    const sessions = new PostgresSessionRepository(db);
    const events = new NoopIdentityEventPublisher();
    const hasher = new Argon2idPasswordHasher();
    const registration = createRegistration(db, users, identities, events);
    const sessionService = new SessionService(sessions, events);
    const passwordService = new PasswordIdentityService(users, identities, hasher, sessionService, events);

    const user = await registration.registerUser({ email: 'reset@example.com', password: 'correct-horse-9' });
    const active = await sessionService.createSession(user.id);
    await passwordService.resetPassword(user.id, 'recovered-password-1');
    assert.equal(await sessionService.validateSession(active.token), null);
    assert.equal((await sessions.revokeAllForUser(user.id)), 0);
  });

  test('no secrets appear in database logs', async () => {
    const logger = new CollectingLogger();
    const db = createTestDatabase(logger);
    try {
      const runner = new MigrationRunner(db, { migrationsDir: MIGRATIONS_DIR });
      await runner.runMigrations();
      await db.query(`DELETE FROM users WHERE email = $1`, ['logs@example.com']);
      const users = new PostgresUserRepository(db);
      const identities = new PostgresPasswordIdentityRepository(db);
      const sessions = new PostgresSessionRepository(db);
      const events = new NoopIdentityEventPublisher();
      const hasher = new Argon2idPasswordHasher();
      const registration = createRegistration(db, users, identities, events);
      const verification = new CredentialVerificationService(users, identities, hasher);
      const sessionService = new SessionService(sessions, events);

      const password = 'log-secret-password-1';
      const user = await registration.registerUser({ email: 'logs@example.com', password });
      const { token } = await sessionService.createSession(user.id);
      const identity = await identities.findByUserId(user.id);
      assert.ok(identity);
      await verification.authenticate('logs@example.com', password);
      const serialized = JSON.stringify(logger.events);
      assert.ok(!serialized.includes(password));
      assert.ok(!serialized.includes(token));
      assert.ok(!serialized.includes(identity.passwordHash));
    } finally {
      await db.close();
    }
  });
});
