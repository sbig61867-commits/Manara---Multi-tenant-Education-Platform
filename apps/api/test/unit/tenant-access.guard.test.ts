import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SessionCookieOptions } from '../../src/http/cookie-options.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import type { SessionService } from '../../src/identity/application/session.service.js';
import type { AuthSession } from '../../src/identity/domain/types.js';
import { TenantAccessGuard } from '../../src/tenants/tenant-access.guard.js';
import type { MembershipRepository } from '../../src/tenant/ports/membership.repository.js';
import { createMembership } from './tenant-helpers.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

const COOKIE: SessionCookieOptions = {
  name: 'manara_session',
  options: { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 86_400 },
};

function createSession(overrides?: Partial<AuthSession>): AuthSession {
  return {
    id: 'session-1',
    userId: USER_ID,
    tokenHash: 'token-hash',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    idleExpiresAt: new Date(Date.now() + 1_800_000),
    revokedAt: null,
    ...overrides,
  };
}

function createRequest(overrides: {
  cookies?: Record<string, string | undefined>;
  params?: Record<string, unknown>;
} = {}): FastifyRequest {
  return { cookies: overrides.cookies ?? {}, params: overrides.params ?? {} } as unknown as FastifyRequest;
}

function createContext(request: FastifyRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

interface GuardHarness {
  guard: TenantAccessGuard;
  updates: Array<Record<string, unknown>>;
}

function createGuard(overrides: {
  session?: AuthSession | null;
  membership?: { status: string } | null;
} = {}): GuardHarness {
  const sessions = {
    validateSession: async () => (overrides.session === undefined ? createSession() : overrides.session),
  } as unknown as SessionService;
  const memberships = {
    findByUserAndInstitution: async () =>
      overrides.membership === undefined
        ? createMembership({ id: 'membership-1', institutionId: TENANT_ID, userId: USER_ID })
        : overrides.membership,
  } as unknown as MembershipRepository;
  const updates: Array<Record<string, unknown>> = [];
  const requestContext = {
    update: (fields: Record<string, unknown>) => {
      updates.push(fields);
    },
  } as unknown as RequestContextService;
  return { guard: new TenantAccessGuard(COOKIE, sessions, memberships, requestContext), updates };
}

test('rejects with 401 when the session cookie is missing', async () => {
  const { guard } = createGuard();
  await assert.rejects(
    () => guard.canActivate(createContext(createRequest())),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test('rejects with 401 when the session cookie is empty', async () => {
  const { guard } = createGuard();
  await assert.rejects(
    () => guard.canActivate(createContext(createRequest({ cookies: { manara_session: '' } }))),
    UnauthorizedException,
  );
});

test('rejects with 401 when the session is invalid or expired', async () => {
  const { guard } = createGuard({ session: null });
  await assert.rejects(
    () => guard.canActivate(createContext(createRequest({ cookies: { manara_session: 'stale-token' } }))),
    UnauthorizedException,
  );
});

test('accepts a valid session without a tenant param and records the user', async () => {
  const { guard, updates } = createGuard();
  const allowed = await guard.canActivate(createContext(createRequest({ cookies: { manara_session: 'token' } })));
  assert.equal(allowed, true);
  assert.deepEqual(updates, [{ authenticatedUserId: USER_ID }]);
});

test('accepts a valid session with an active membership in the requested tenant', async () => {
  const { guard, updates } = createGuard({ membership: { status: 'active' } });
  const allowed = await guard.canActivate(
    createContext(createRequest({ cookies: { manara_session: 'token' }, params: { tenantId: TENANT_ID } })),
  );
  assert.equal(allowed, true);
  assert.deepEqual(updates, [{ authenticatedUserId: USER_ID }]);
});

test('rejects with 403 when there is no membership in the requested tenant', async () => {
  const { guard } = createGuard({ membership: null });
  await assert.rejects(
    () =>
      guard.canActivate(
        createContext(createRequest({ cookies: { manara_session: 'token' }, params: { tenantId: TENANT_ID } })),
      ),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('rejects with 403 when the membership in the requested tenant is not active', async () => {
  const { guard } = createGuard({ membership: { status: 'pending' } });
  await assert.rejects(
    () =>
      guard.canActivate(
        createContext(createRequest({ cookies: { manara_session: 'token' }, params: { tenantId: TENANT_ID } })),
      ),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
