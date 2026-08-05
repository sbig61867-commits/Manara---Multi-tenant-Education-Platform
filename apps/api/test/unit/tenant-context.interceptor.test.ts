import assert from 'node:assert/strict';
import test from 'node:test';
import { lastValueFrom, type Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import type { RequestContextService } from '../../src/http/request-context.js';
import { AlsTenantContextResolver } from '../../src/tenant/adapters/als-tenant-context.resolver.js';
import type { Invitation } from '../../src/tenant/domain/types.js';
import type { InvitationRepository } from '../../src/tenant/ports/invitation.repository.js';
import type { TokenHasher } from '../../src/tenant/token-hasher.js';
import { TenantContextInterceptor } from '../../src/tenants/tenant-context.interceptor.js';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

function createInvitation(overrides?: Partial<Invitation>): Invitation {
  return {
    id: 'invitation-1',
    institutionId: TENANT_ID,
    tokenHash: 'hash',
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    acceptedByUserId: null,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function createRequest(overrides: { params?: Record<string, unknown>; body?: unknown } = {}): FastifyRequest {
  return {
    params: overrides.params ?? {},
    body: overrides.body ?? undefined,
  } as unknown as FastifyRequest;
}

interface InterceptorHarness {
  interceptor: TenantContextInterceptor;
  updates: Array<Record<string, unknown>>;
}

function createInterceptor(overrides: { invitation?: Invitation | null } = {}): InterceptorHarness {
  const invitations = {
    findByTokenHash: async () => overrides.invitation ?? null,
  } as unknown as InvitationRepository;
  const hasher: TokenHasher = {
    hash: async (token: string) => `hashed:${token}`,
  };
  const updates: Array<Record<string, unknown>> = [];
  const requestContext = {
    update: (fields: Record<string, unknown>) => {
      updates.push(fields);
    },
  } as unknown as RequestContextService;
  return {
    interceptor: new TenantContextInterceptor(invitations, hasher, requestContext),
    updates,
  };
}

function handlerProbing(captured: Array<string | null>): { handle: () => Observable<string> } {
  const resolver = new AlsTenantContextResolver();
  return {
    handle: () => ({
      subscribe: (observer: { next: (value: string) => void; complete: () => void; error: (err: unknown) => void }) => {
        captured.push(resolver.resolveTenantId());
        observer.next('ok');
        observer.complete();
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

test('wraps the handler in the tenant context from the route param', async () => {
  const { interceptor, updates } = createInterceptor();
  const captured: Array<string | null> = [];
  const request = createRequest({ params: { tenantId: TENANT_ID } });
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => request }) } as never,
    handlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [TENANT_ID]);
  assert.deepEqual(updates, [{ trustedTenantId: TENANT_ID }]);
});

test('resolves the tenant context from the invitation for the accept route', async () => {
  const { interceptor, updates } = createInterceptor({ invitation: createInvitation() });
  const captured: Array<string | null> = [];
  const request = createRequest({ body: { rawToken: 'one-time-raw-token' } });
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => request }) } as never,
    handlerProbing(captured),
  );
  await lastValueFrom(observable);
  assert.deepEqual(captured, [TENANT_ID]);
  assert.deepEqual(updates, [{ trustedTenantId: TENANT_ID }]);
});

test('unknown invitation tokens run in a sentinel context that is never recorded', async () => {
  const { interceptor, updates } = createInterceptor({ invitation: null });
  const captured: Array<string | null> = [];
  const request = createRequest({ body: { rawToken: 'unknown-token' } });
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => request }) } as never,
    handlerProbing(captured),
  );
  await lastValueFrom(observable);
  assert.equal(captured.length, 1);
  assert.notEqual(captured[0], null);
  assert.deepEqual(updates, []);
});

test('does not wrap when the interceptor is applied without a tenant target', async () => {
  const { interceptor } = createInterceptor();
  const captured: Array<string | null> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest() }) } as never,
    handlerProbing(captured),
  );
  await lastValueFrom(observable);
  assert.deepEqual(captured, [null]);
});

test('propagates handler errors through the observable', async () => {
  const { interceptor } = createInterceptor();
  const request = createRequest({ params: { tenantId: TENANT_ID } });
  const failing = {
    handle: () => ({
      subscribe: (observer: { error: (err: unknown) => void }) => {
        observer.error(new Error('boom'));
        return { unsubscribe: () => undefined };
      },
    }),
  };
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => request }) } as never,
    failing,
  );
  await assert.rejects(
    lastValueFrom(observable),
    (error: unknown) => error instanceof Error && error.message === 'boom',
  );
});
