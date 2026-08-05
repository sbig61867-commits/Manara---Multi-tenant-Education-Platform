import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller.js';
import type { SessionCookieOptions } from '../../src/http/cookie-options.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import type { CredentialVerificationService } from '../../src/identity/application/credential-verification.service.js';
import type { SessionService } from '../../src/identity/application/session.service.js';
import { InvalidCredentialsError } from '../../src/identity/domain/errors.js';
import type { AuthSession } from '../../src/identity/domain/types.js';
import { createUser } from './helpers.js';

const INSECURE_COOKIE: SessionCookieOptions = {
  name: 'manara_session',
  options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 86_400 },
};

const SECURE_COOKIE: SessionCookieOptions = {
  name: '__Host-manara_session',
  options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 86_400 },
};

function createAuthSession(overrides?: Partial<AuthSession>): AuthSession {
  const now = new Date();
  return {
    id: 'session-1',
    userId: '11111111-1111-4111-8111-111111111111',
    tokenHash: 'token-hash',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    idleExpiresAt: new Date(now.getTime() + 1_800_000),
    revokedAt: null,
    ...overrides,
  };
}

interface ServiceOverrides {
  authenticate?: CredentialVerificationService['authenticate'];
  createSession?: SessionService['createSession'];
  validateSession?: SessionService['validateSession'];
  rotateSession?: SessionService['rotateSession'];
  revokeSession?: SessionService['revokeSession'];
}

function createController(
  overrides: ServiceOverrides = {},
  cookie: SessionCookieOptions = INSECURE_COOKIE,
): {
  controller: AuthController;
  contextUpdates: Array<Record<string, unknown>>;
} {
  const credentials = {
    authenticate: overrides.authenticate ?? (async () => createUser({ id: '11111111-1111-4111-8111-111111111111' })),
  } as unknown as CredentialVerificationService;
  const sessions = {
    createSession: overrides.createSession ?? (async () => ({ session: createAuthSession(), token: 'session-token' })),
    validateSession: overrides.validateSession ?? (async () => createAuthSession()),
    rotateSession: overrides.rotateSession ?? (async () => ({ session: createAuthSession(), token: 'rotated-token' })),
    revokeSession: overrides.revokeSession ?? (async () => true),
  } as unknown as SessionService;
  const contextUpdates: Array<Record<string, unknown>> = [];
  const requestContext = {
    update: (fields: Record<string, unknown>) => {
      contextUpdates.push(fields);
    },
  } as unknown as RequestContextService;
  const controller = new AuthController(cookie, credentials, sessions, requestContext);
  return { controller, contextUpdates };
}

class FakeReply {
  readonly setCookieCalls: Array<{ name: string; value: string }> = [];
  readonly clearCookieCalls: Array<{ name: string }> = [];

  setCookie(name: string, value: string): void {
    this.setCookieCalls.push({ name, value });
  }

  clearCookie(name: string): void {
    this.clearCookieCalls.push({ name });
  }
}

function fakeRequest(cookies: Record<string, string | undefined> = {}): { cookies: Record<string, string | undefined> } {
  return { cookies };
}

test('login authenticates and sets the session cookie', async () => {
  const user = createUser({ id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com' });
  const session = createAuthSession();
  const { controller, contextUpdates } = createController({
    authenticate: async () => user,
    createSession: async () => ({ session, token: 'raw-session-token' }),
  });
  const reply = new FakeReply();
  const response = await controller.login(
    { email: 'student@example.com', password: 'correct-password' },
    reply as never,
  );

  assert.equal(response.user.id, user.id);
  assert.equal(response.user.email, 'student@example.com');
  assert.equal(response.session.id, session.id);
  assert.equal(response.session.userId, '11111111-1111-4111-8111-111111111111');
  assert.equal(reply.setCookieCalls.length, 1);
  assert.equal(reply.setCookieCalls[0]?.name, 'manara_session');
  assert.equal(reply.setCookieCalls[0]?.value, 'raw-session-token');
  assert.deepEqual(contextUpdates, [{ authenticatedUserId: '11111111-1111-4111-8111-111111111111' }]);
});

test('login rejects with 401 when credentials are invalid', async () => {
  const { controller } = createController({
    authenticate: async () => {
      throw new InvalidCredentialsError('Invalid credentials');
    },
  });
  await assert.rejects(controller.login({ email: 'student@example.com', password: 'wrong' }, new FakeReply() as never), UnauthorizedException);
});

test('logout revokes the session and clears the cookie', async () => {
  const revoked: string[] = [];
  const { controller } = createController({
    revokeSession: async (token: string) => {
      revoked.push(token);
      return true;
    },
  });
  const reply = new FakeReply();
  const result = await controller.logout(fakeRequest({ manara_session: 'session-token' }) as never, reply as never);
  assert.equal(result, undefined);
  assert.deepEqual(revoked, ['session-token']);
  assert.deepEqual(reply.clearCookieCalls, [{ name: 'manara_session' }]);
});

test('logout without a session cookie only clears the cookie', async () => {
  const revoked: string[] = [];
  const { controller } = createController({
    revokeSession: async (token: string) => {
      revoked.push(token);
      return true;
    },
  });
  const reply = new FakeReply();
  await controller.logout(fakeRequest() as never, reply as never);
  assert.deepEqual(revoked, []);
  assert.deepEqual(reply.clearCookieCalls, [{ name: 'manara_session' }]);
});

test('refresh rotates the session and sets a new cookie', async () => {
  const { controller, contextUpdates } = createController({
    rotateSession: async () => ({ session: createAuthSession({ id: 'session-2' }), token: 'rotated-token' }),
  });
  const reply = new FakeReply();
  const response = await controller.refresh(fakeRequest({ manara_session: 'old-token' }) as never, reply as never);
  assert.equal(response.session.id, 'session-2');
  assert.deepEqual(reply.setCookieCalls, [{ name: 'manara_session', value: 'rotated-token' }]);
  assert.deepEqual(contextUpdates, [{ authenticatedUserId: '11111111-1111-4111-8111-111111111111' }]);
});

test('refresh rejects with 401 when the session is invalid or missing', async () => {
  const { controller } = createController({ rotateSession: async () => null });
  await assert.rejects(controller.refresh(fakeRequest() as never, new FakeReply() as never), UnauthorizedException);
  await assert.rejects(
    controller.refresh(fakeRequest({ manara_session: 'stale-token' }) as never, new FakeReply() as never),
    UnauthorizedException,
  );
});

test('session returns the current session for a valid token', async () => {
  const { controller, contextUpdates } = createController();
  const response = await controller.session(fakeRequest({ manara_session: 'session-token' }) as never);
  assert.equal(response.session.id, 'session-1');
  assert.deepEqual(contextUpdates, [{ authenticatedUserId: '11111111-1111-4111-8111-111111111111' }]);
});

test('session rejects with 401 when there is no active session', async () => {
  const { controller } = createController({ validateSession: async () => null });
  await assert.rejects(controller.session(fakeRequest() as never), UnauthorizedException);
  await assert.rejects(controller.session(fakeRequest({ manara_session: 'stale-token' }) as never), UnauthorizedException);
});

test('secure cookies use the __Host- prefix', async () => {
  const { controller } = createController({}, SECURE_COOKIE);
  const reply = new FakeReply();
  await controller.login({ email: 'student@example.com', password: 'correct-password' }, reply as never);
  assert.equal(reply.setCookieCalls[0]?.name, '__Host-manara_session');
  assert.equal(SECURE_COOKIE.options.secure, true);
});
