import assert from 'node:assert/strict';
import test from 'node:test';
import { PasswordIdentityService } from '../../src/identity/application/password-identity.service.js';
import { SessionService } from '../../src/identity/application/session.service.js';
import {
  InvalidCredentialsError,
  PasswordIdentityAlreadyExistsError,
  PasswordIdentityNotFoundError,
  UserNotFoundError,
} from '../../src/identity/domain/errors.js';
import {
  FakePasswordHasher,
  FakePasswordIdentityRepository,
  FakeSessionRepository,
  FakeUserRepository,
  RecordingEventPublisher,
  createUser,
} from './helpers.js';

function createService(): {
  service: PasswordIdentityService;
  users: FakeUserRepository;
  sessions: SessionService;
  sessionRepository: FakeSessionRepository;
  identities: FakePasswordIdentityRepository;
  events: RecordingEventPublisher;
  hasher: FakePasswordHasher;
} {
  const users = new FakeUserRepository();
  const identities = new FakePasswordIdentityRepository();
  const sessionRepository = new FakeSessionRepository();
  const events = new RecordingEventPublisher();
  const hasher = new FakePasswordHasher();
  const sessions = new SessionService(sessionRepository, events);
  const service = new PasswordIdentityService(users, identities, hasher, sessions, events);
  return { service, users, sessions, sessionRepository, identities, events, hasher };
}

test('attachPasswordIdentity creates the identity and publishes an event', async () => {
  const { service, users, identities, events } = createService();
  const user = createUser();
  await users.create(user);
  await service.attachPasswordIdentity(user.id, 'correct-horse-9');
  const identity = await identities.findByUserId(user.id);
  assert.ok(identity);
  assert.notEqual(identity.passwordHash, 'correct-horse-9');
  assert.equal(events.eventsOfType('password.identity.attached').length, 1);
});

test('attachPasswordIdentity rejects an unknown user', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.attachPasswordIdentity('missing-user', 'correct-horse-9'),
    (error: unknown) => error instanceof UserNotFoundError,
  );
});

test('attachPasswordIdentity rejects a duplicate identity', async () => {
  const { service, users } = createService();
  const user = createUser();
  await users.create(user);
  await service.attachPasswordIdentity(user.id, 'correct-horse-9');
  await assert.rejects(
    () => service.attachPasswordIdentity(user.id, 'another-password-1'),
    (error: unknown) => error instanceof PasswordIdentityAlreadyExistsError,
  );
});

test('changePassword rejects a wrong current password', async () => {
  const { service, users } = createService();
  const user = createUser();
  await users.create(user);
  await service.attachPasswordIdentity(user.id, 'correct-horse-9');
  await assert.rejects(
    () => service.changePassword(user.id, 'wrong-password-1', 'new-password-1'),
    (error: unknown) => error instanceof InvalidCredentialsError,
  );
});

test('changePassword updates the hash, revokes all sessions, and publishes an event', async () => {
  const { service, users, sessions, sessionRepository, identities, events, hasher } = createService();
  const user = createUser();
  await users.create(user);
  await service.attachPasswordIdentity(user.id, 'correct-horse-9');
  const { token } = await sessions.createSession(user.id);
  await service.changePassword(user.id, 'correct-horse-9', 'new-password-1');
  const identity = await identities.findByUserId(user.id);
  assert.ok(identity);
  assert.equal(await hasher.verify('new-password-1', identity.passwordHash), true);
  assert.equal(await sessions.validateSession(token), null);
  assert.equal(sessionRepository.storedSessions().every((session) => session.revokedAt !== null), true);
  assert.equal(events.eventsOfType('user.password.reset').length, 1);
});

test('changePassword rejects when no password identity exists', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.changePassword('user-without-identity', 'correct-horse-9', 'new-password-1'),
    (error: unknown) => error instanceof PasswordIdentityNotFoundError,
  );
});

test('resetPassword updates the hash and revokes all sessions without a current password', async () => {
  const { service, users, sessions, identities, events } = createService();
  const user = createUser();
  await users.create(user);
  await service.attachPasswordIdentity(user.id, 'correct-horse-9');
  const { token } = await sessions.createSession(user.id);
  await service.resetPassword(user.id, 'recovered-password-1');
  const identity = await identities.findByUserId(user.id);
  assert.ok(identity);
  assert.equal(await sessions.validateSession(token), null);
  assert.equal(events.eventsOfType('user.password.reset').length, 1);
});

test('resetPassword rejects when no password identity exists', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.resetPassword('user-without-identity', 'recovered-password-1'),
    (error: unknown) => error instanceof PasswordIdentityNotFoundError,
  );
});
