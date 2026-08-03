import assert from 'node:assert/strict';
import test from 'node:test';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import {
  InvalidEmailError,
  UserAlreadyExistsError,
  WeakPasswordError,
} from '../../src/identity/domain/errors.js';
import {
  FakePasswordHasher,
  FakePasswordIdentityRepository,
  FakeUserRepository,
  RecordingEventPublisher,
  TrackingTransactionRunner,
} from './helpers.js';

function createService(runner?: TrackingTransactionRunner): {
  service: UserCreationService;
  users: FakeUserRepository;
  identities: FakePasswordIdentityRepository;
  events: RecordingEventPublisher;
  runner: TrackingTransactionRunner;
} {
  const users = new FakeUserRepository();
  const identities = new FakePasswordIdentityRepository();
  const events = new RecordingEventPublisher();
  const transactionRunner = runner ?? new TrackingTransactionRunner();
  const service = new UserCreationService(users, identities, new FakePasswordHasher(), events, transactionRunner);
  return { service, users, identities, events, runner: transactionRunner };
}

test('registers the user and password identity inside a single transaction', async () => {
  const { service, users, identities, runner } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  assert.equal(runner.calls, 1);
  assert.equal(runner.maxDepth, 1);
  assert.ok(await users.findByEmail('student@example.com'));
  assert.ok(await identities.findByUserId(user.id));
});

test('registers a user with a normalized email', async () => {
  const { service } = createService();
  const user = await service.registerUser({ email: '  Student@Example.COM ', password: 'correct-horse-9' });
  assert.equal(user.email, 'student@example.com');
});

test('stores a password hash, never the plaintext', async () => {
  const { service, identities } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  const identity = await identities.findByUserId(user.id);
  assert.ok(identity);
  assert.notEqual(identity.passwordHash, 'correct-horse-9');
  assert.ok(!identity.passwordHash.includes('correct-horse-9'));
});

test('publishes user.registered and password.identity.attached events', async () => {
  const { service, events } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  const registered = events.eventsOfType('user.registered');
  const attached = events.eventsOfType('password.identity.attached');
  assert.equal(registered.length, 1);
  assert.equal(attached.length, 1);
  assert.equal(registered[0]?.userId, user.id);
  assert.equal(registered[0]?.email, 'student@example.com');
});

test('rejects an invalid email', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.registerUser({ email: 'not-an-email', password: 'correct-horse-9' }),
    (error: unknown) => error instanceof InvalidEmailError && error.code === 'identity.invalid_email',
  );
});

test('rejects a password below the minimum length', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.registerUser({ email: 'student@example.com', password: 'x'.repeat(11) }),
    (error: unknown) => error instanceof WeakPasswordError,
  );
});

test('accepts a password at the exact minimum length', async () => {
  const { service } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'x'.repeat(12) });
  assert.equal(user.email, 'student@example.com');
});

test('accepts a lowercase-only password without composition requirements', async () => {
  const { service } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'alllowercasepass' });
  assert.equal(user.email, 'student@example.com');
});

test('accepts a digits-only password', async () => {
  const { service } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: '123456789012' });
  assert.equal(user.email, 'student@example.com');
});

test('accepts a multi-word passphrase', async () => {
  const { service } = createService();
  const user = await service.registerUser({ email: 'student@example.com', password: 'correct horse battery staple' });
  assert.equal(user.email, 'student@example.com');
});

test('rejects a password above the maximum length', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.registerUser({ email: 'student@example.com', password: 'x'.repeat(129) }),
    (error: unknown) => error instanceof WeakPasswordError,
  );
});

test('rejects a duplicate email', async () => {
  const { service } = createService();
  await service.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  await assert.rejects(
    () => service.registerUser({ email: 'student@example.com', password: 'another-password-1' }),
    (error: unknown) => error instanceof UserAlreadyExistsError,
  );
});

test('publishes no events when the transaction work fails', async () => {
  const failingRunner = new TrackingTransactionRunner();
  failingRunner.runInTransaction = async () => {
    throw new Error('transaction aborted');
  };
  const { service, users, identities, events } = createService(failingRunner);
  await assert.rejects(
    () => service.registerUser({ email: 'failed@example.com', password: 'correct-horse-9' }),
    (error: unknown) => error instanceof Error && error.message === 'transaction aborted',
  );
  assert.equal(events.published.length, 0);
  assert.equal(await users.findByEmail('failed@example.com'), null);
  assert.equal(await identities.findByUserId('any'), null);
});
