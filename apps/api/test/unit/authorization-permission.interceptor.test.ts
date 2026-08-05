import assert from 'node:assert/strict';
import test from 'node:test';
import { lastValueFrom, of } from 'rxjs';
import { ForbiddenException } from '@nestjs/common';
import type { AuthorizationDecisionService } from '../../src/authorization/application/authorization-decision.service.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import { AuthorizationPermissionInterceptor } from '../../src/authorizations/authorization-permission.interceptor.js';
import { REQUIRED_PERMISSION_METADATA } from '../../src/authorizations/require-permission.decorator.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function createDecisions(overrides: { checkPermission?: AuthorizationDecisionService['checkPermission'] } = {}): AuthorizationDecisionService {
  return {
    checkPermission: overrides.checkPermission ?? (async () => true),
  } as unknown as AuthorizationDecisionService;
}

function createInterceptor(overrides: { authenticatedUserId?: string | null } = {}): {
  interceptor: AuthorizationPermissionInterceptor;
  calls: Array<{ subject: unknown; resource: unknown; action: string }>;
} {
  const calls: Array<{ subject: unknown; resource: unknown; action: string }> = [];
  const decisions = createDecisions({
    checkPermission: async (request: { subject: unknown; resource: unknown; action: string }) => {
      calls.push(request);
      return true;
    },
  });
  const requestContext = {
    get: () => ({
      authenticatedUserId: 'authenticatedUserId' in overrides ? overrides.authenticatedUserId : USER_ID,
    }),
  } as unknown as RequestContextService;
  const reflector = {
    get: (key: string) => (key === REQUIRED_PERMISSION_METADATA ? 'role:create' : undefined),
  };
  const interceptor = new AuthorizationPermissionInterceptor(
    decisions,
    requestContext,
    reflector as never,
  );
  return { interceptor, calls };
}

function createContext(): never {
  return {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as never;
}

test('passes through when no permission is required', async () => {
  const reflector = { get: () => undefined };
  const passThrough = new AuthorizationPermissionInterceptor(
    createDecisions(),
    { get: () => null } as unknown as RequestContextService,
    reflector as never,
  );
  const observable = await passThrough.intercept(createContext(), { handle: () => of('ok').pipe() });
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
});

test('calls the decision service with the split permission and passes through when allowed', async () => {
  const { interceptor, calls } = createInterceptor();
  const observable = await interceptor.intercept(createContext(), { handle: () => of('ok').pipe() });
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    subject: { userId: USER_ID },
    resource: { type: 'role', attributes: {} },
    action: 'create',
  });
});

test('denies 403 when the decision service rejects', async () => {
  const decisions = createDecisions({ checkPermission: async () => false });
  const interceptor = new AuthorizationPermissionInterceptor(
    decisions,
    { get: () => ({ authenticatedUserId: USER_ID }) } as unknown as RequestContextService,
    { get: () => 'role:create' } as never,
  );
  await assert.rejects(
    interceptor.intercept(createContext(), { handle: () => of('ok').pipe() }),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('denies 403 when the request context has no authenticated user', async () => {
  const { interceptor } = createInterceptor({ authenticatedUserId: null });
  await assert.rejects(
    interceptor.intercept(createContext(), { handle: () => of('ok').pipe() }),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
