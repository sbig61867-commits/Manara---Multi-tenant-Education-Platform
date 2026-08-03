import assert from 'node:assert/strict';
import test from 'node:test';
import { CredentialVerificationService } from '../../src/identity/application/credential-verification.service.js';
import { InvalidCredentialsError } from '../../src/identity/domain/errors.js';
import { UserCreationService } from '../../src/identity/application/user-creation.service.js';
import {
  FakePasswordHasher,
  FakePasswordIdentityRepository,
  FakeUserRepository,
  RecordingEventPublisher,
  TrackingTransactionRunner,
  createUser,
} from './helpers.js';

function createServices(): {
  verification: CredentialVerificationService;
  users: FakeUserRepository;
  identities: FakePasswordIdentityRepository;
} {
  const users = new FakeUserRepository();
  const identities = new FakePasswordIdentityRepository();
  const hasher = new FakePasswordHasher();
  const verification = new CredentialVerificationService(users, identities, hasher);
  return { verification, users, identities };
}

function createRegistration(
  users: FakeUserRepository,
  identities: FakePasswordIdentityRepository,
): UserCreationService {
  return new UserCreationService(
    users,
    identities,
    new FakePasswordHasher(),
    new RecordingEventPublisher(),
    new TrackingTransactionRunner(),
  );
}

test('authenticate returns the user for valid credentials', async () => {
  const { verification, users, identities } = createServices();
  const registration = createRegistration(users, identities);
  await registration.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  const user = await verification.authenticate('student@example.com', 'correct-horse-9');
  assert.equal(user.email, 'student@example.com');
});

test('authenticate matches email case-insensitively', async () => {
  const { verification, users, identities } = createServices();
  const registration = createRegistration(users, identities);
  await registration.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  const user = await verification.authenticate('  Student@Example.COM ', 'correct-horse-9');
  assert.equal(user.email, 'student@example.com');
});

test('authenticate rejects an unknown email with InvalidCredentialsError', async () => {
  const { verification } = createServices();
  await assert.rejects(
    () => verification.authenticate('nobody@example.com', 'whatever-password-1'),
    (error: unknown) => error instanceof InvalidCredentialsError && error.code === 'identity.invalid_credentials',
  );
});

test('authenticate rejects a wrong password with InvalidCredentialsError', async () => {
  const { verification, users, identities } = createServices();
  const registration = createRegistration(users, identities);
  await registration.registerUser({ email: 'student@example.com', password: 'correct-horse-9' });
  await assert.rejects(
    () => verification.authenticate('student@example.com', 'wrong-password-1'),
    (error: unknown) => error instanceof InvalidCredentialsError,
  );
});

test('authenticate rejects a user without a password identity', async () => {
  const { verification, users } = createServices();
  await users.create(createUser({ email: 'sso-only@example.com' }));
  await assert.rejects(
    () => verification.authenticate('sso-only@example.com', 'whatever-password-1'),
    (error: unknown) => error instanceof InvalidCredentialsError,
  );
});
