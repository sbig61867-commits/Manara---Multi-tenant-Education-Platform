import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller.js';
import type { AuthRateLimitService } from '../../src/auth/auth-rate-limit.service.js';
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

interface RateLimitCalls {
  guardLogin: Array<{ ip: string | null; email: string }>;
  recordLoginFailure: Array<{ ip: string | null; email: string }>;
  resetLoginFailures: Array<{ ip: string | null; email: string }>;
  guardRefresh: string[];
  recordRefreshFailure: string[];
  guardEndpoint: string[];
  blockLogin?: boolean;
  blockRefresh?: boolean;
  blockEndpoint?: boolean;
}

function createRateLimits(calls: RateLimitCalls): AuthRateLimitService {
  return {
    guardLogin: (ip: string | null, email: string) => {
      calls.guardLogin.push({ ip, email });
      if (calls.blockLogin) {
        throw new UnauthorizedException('Too many requests');
      }
    },
    recordLoginFailure: (ip: string | null, email: string) => {
      calls.recordLoginFailure.push({ ip, email });
    },
    resetLoginFailures: (ip: string | null, email: string) => {
      calls.resetLoginFailures.push({ ip, email });
    },
    guardRefresh: (ip: string | null) => {
      calls.guardRefresh.push(ip ?? 'null');
      if (calls.blockRefresh) {
        throw new UnauthorizedException('Too many requests');
      }
    },
    recordRefreshFailure: (ip: string | null) => {
      calls.recordRefreshFailure.push(ip ?? 'null');
    },
    guardEndpoint: (ip: string | null) => {
      calls.guardEndpoint.push(ip ?? 'null');
      if (calls.blockEndpoint) {
        throw new UnauthorizedException('Too many requests');
      }
    },
  } as unknown as AuthRateLimitService;
}

function createController(
  overrides: ServiceOverrides = {},
  cookie: SessionCookieOptions = INSECURE_COOKIE,
  rateLimits: AuthRateLimitService = createRateLimits({
    guardLogin: [],
    recordLoginFailure: [],
    resetLoginFailures: [],
    guardRefresh: [],
    recordRefreshFailure: [],
    guardEndpoint: [],
  }),
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
  const controller = new AuthController(cookie, credentials, sessions, requestContext, rateLimits);
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

function fakeRequest(cookies: Record<string, string | undefined> = {}): { cookies: Record<string, string | undefined>; ip: string } {
  return { cookies, ip: '127.0.0.1' };
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
    fakeRequest() as never,
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
  await assert.rejects(controller.login({ email: 'student@example.com', password: 'wrong' }, fakeRequest() as never, new FakeReply() as never), UnauthorizedException);
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
  await controller.login({ email: 'student@example.com', password: 'correct-password' }, fakeRequest() as never, reply as never);
  assert.equal(reply.setCookieCalls[0]?.name, '__Host-manara_session');
  assert.equal(SECURE_COOKIE.options.secure, true);
});

test('login guards before authenticating and resets only the email+IP bucket on success', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [] };
  const { controller } = createController({}, INSECURE_COOKIE, createRateLimits(calls));
  const reply = new FakeReply();
  await controller.login({ email: 'student@example.com', password: 'correct-password' }, fakeRequest() as never, reply as never);
  assert.deepEqual(calls.guardLogin, [{ ip: '127.0.0.1', email: 'student@example.com' }]);
  assert.deepEqual(calls.recordLoginFailure, []);
  assert.deepEqual(calls.resetLoginFailures, [{ ip: '127.0.0.1', email: 'student@example.com' }]);
});

test('invalid credentials consume both login limits and never expose account existence', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [] };
  const { controller } = createController(
    {
      authenticate: async () => {
        throw new InvalidCredentialsError('Invalid credentials');
      },
    },
    INSECURE_COOKIE,
    createRateLimits(calls),
  );
  await assert.rejects(controller.login({ email: 'student@example.com', password: 'wrong' }, fakeRequest() as never, new FakeReply() as never), UnauthorizedException);
  assert.deepEqual(calls.recordLoginFailure, [{ ip: '127.0.0.1', email: 'student@example.com' }]);
  assert.deepEqual(calls.resetLoginFailures, []);
});

test('a blocked login is rejected before authentication', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [], blockLogin: true };
  const { controller } = createController({}, INSECURE_COOKIE, createRateLimits(calls));
  await assert.rejects(
    controller.login({ email: 'student@example.com', password: 'correct-password' }, fakeRequest() as never, new FakeReply() as never),
    UnauthorizedException,
  );
  assert.deepEqual(calls.recordLoginFailure, [], 'blocked attempts must not consume further');
});

test('invalid refresh attempts consume the refresh limit', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [] };
  const { controller } = createController({ rotateSession: async () => null }, INSECURE_COOKIE, createRateLimits(calls));
  await assert.rejects(controller.refresh(fakeRequest() as never, new FakeReply() as never), UnauthorizedException);
  assert.deepEqual(calls.guardRefresh, ['127.0.0.1']);
  assert.deepEqual(calls.recordRefreshFailure, ['127.0.0.1']);
});

test('a valid refresh does not consume the refresh limit', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [] };
  const { controller } = createController({}, INSECURE_COOKIE, createRateLimits(calls));
  const reply = new FakeReply();
  await controller.refresh(fakeRequest({ manara_session: 'session-token' }) as never, reply as never);
  assert.deepEqual(calls.guardRefresh, ['127.0.0.1']);
  assert.deepEqual(calls.recordRefreshFailure, []);
});

test('session and logout consume the lighter endpoint limit on every request', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [] };
  const { controller } = createController({}, INSECURE_COOKIE, createRateLimits(calls));
  const reply = new FakeReply();
  const requestWithCookie = fakeRequest({ manara_session: 'session-token' });
  await controller.session(requestWithCookie as never);
  await controller.logout(requestWithCookie as never, reply as never);
  assert.deepEqual(calls.guardEndpoint, ['127.0.0.1', '127.0.0.1']);
});

test('a blocked session or logout request is rejected', async () => {
  const calls: RateLimitCalls = { guardLogin: [], recordLoginFailure: [], resetLoginFailures: [], guardRefresh: [], recordRefreshFailure: [], guardEndpoint: [], blockEndpoint: true };
  const { controller } = createController({}, INSECURE_COOKIE, createRateLimits(calls));
  await assert.rejects(controller.session(fakeRequest() as never), UnauthorizedException);
  await assert.rejects(controller.logout(fakeRequest() as never, new FakeReply() as never), UnauthorizedException);
});
