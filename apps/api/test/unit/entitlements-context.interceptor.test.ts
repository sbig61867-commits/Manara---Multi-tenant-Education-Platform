import assert from 'node:assert/strict';
import test from 'node:test';
import { lastValueFrom, type Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { ForbiddenException } from '@nestjs/common';
import { AlsAuthorizationContextResolver } from '../../src/authorization/adapters/als-authorization-context.resolver.js';
import { AlsEntitlementsContextResolver } from '../../src/entitlements/adapters/als-entitlements-context.resolver.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import type { MembershipRepository } from '../../src/tenant/ports/membership.repository.js';
import { EntitlementsContextInterceptor } from '../../src/entitlements-http/entitlements-context.interceptor.js';
import { createMembership } from './tenant-helpers.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT_ID = '33333333-3333-4333-8333-333333333333';

function createRequest(overrides: { params?: Record<string, unknown> } = {}): FastifyRequest {
  return { params: overrides.params ?? {} } as unknown as FastifyRequest;
}

function createMembershipRepository(
  active: Array<{ id: string; institutionId: string; createdAt?: Date }>,
): MembershipRepository {
  return {
    listActiveByUser: async () => active.map((membership) => createMembership(membership)),
  } as unknown as MembershipRepository;
}

function createInterceptor(
  repository: MembershipRepository,
  overrides: { authenticatedUserId?: string | null } = {},
): { interceptor: EntitlementsContextInterceptor; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];
  const requestContext = {
    get: () => ({ authenticatedUserId: overrides.authenticatedUserId ?? USER_ID }),
    update: (fields: Record<string, unknown>) => {
      updates.push(fields);
    },
  } as unknown as RequestContextService;
  return { interceptor: new EntitlementsContextInterceptor(repository, requestContext), updates };
}

function handlerProbing(captured: Array<string | null>): { handle: () => Observable<string> } {
  return {
    handle: () => ({
      subscribe: (observer: {
        next: (value: string) => void;
        complete: () => void;
        error: (err: unknown) => void;
      }) => {
        captured.push(new AlsEntitlementsContextResolver().resolveTenantId());
        captured.push(new AlsAuthorizationContextResolver().resolveTenantId());
        observer.next('ok');
        observer.complete();
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

test('uses the :tenantId route param as the context in both ALS stores and publishes trustedTenantId', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor, updates } = createInterceptor(memberships);
  const captured: Array<string | null> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest({ params: { tenantId: TENANT_ID } }) }) } as never,
    handlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [TENANT_ID, TENANT_ID]);
  assert.deepEqual(updates, [{ trustedTenantId: TENANT_ID }]);
});

test('falls back to the most recent active membership for tenant-less routes', async () => {
  const now = Date.now();
  const memberships = createMembershipRepository([
    { id: 'membership-new', institutionId: TENANT_ID, createdAt: new Date(now) },
    { id: 'membership-old', institutionId: OTHER_TENANT_ID, createdAt: new Date(now - 10_000) },
  ]);
  const { interceptor } = createInterceptor(memberships);
  const captured: Array<string | null> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
    handlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [TENANT_ID, TENANT_ID]);
});

test('denies 403 when there is no route param and the user has no active membership', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createInterceptor(memberships);
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
      handlerProbing([]),
    ),
    ForbiddenException,
  );
});

test('denies 403 when there is no authenticated user and no route param', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createInterceptor(memberships, { authenticatedUserId: null });
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
      handlerProbing([]),
    ),
    ForbiddenException,
  );
});
