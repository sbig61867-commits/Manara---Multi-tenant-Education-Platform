import assert from 'node:assert/strict';
import test from 'node:test';
import { lastValueFrom, type Observable } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { ForbiddenException } from '@nestjs/common';
import { AlsAuditContextResolver } from '../../src/audit/adapters/als-audit-context.resolver.js';
import { AlsAuthorizationContextResolver } from '../../src/authorization/adapters/als-authorization-context.resolver.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import type { MembershipRepository } from '../../src/tenant/ports/membership.repository.js';
import {
  PlatformAuditContextInterceptor,
  TenantAuditContextInterceptor,
} from '../../src/audit-http/audit-context.interceptor.js';
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

function createTenantInterceptor(
  repository: MembershipRepository,
  overrides: { authenticatedUserId?: string | null; requestId?: string | null } = {},
): { interceptor: TenantAuditContextInterceptor; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];
  const requestContext = {
    get: () => ({ authenticatedUserId: overrides.authenticatedUserId ?? USER_ID, requestId: overrides.requestId ?? 'req-1' }),
    update: (fields: Record<string, unknown>) => {
      updates.push(fields);
    },
  } as unknown as RequestContextService;
  return { interceptor: new TenantAuditContextInterceptor(repository, requestContext), updates };
}

function createPlatformInterceptor(
  repository: MembershipRepository,
  overrides: { authenticatedUserId?: string | null } = {},
): { interceptor: PlatformAuditContextInterceptor; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];
  const requestContext = {
    get: () => ({ authenticatedUserId: overrides.authenticatedUserId ?? USER_ID }),
    update: (fields: Record<string, unknown>) => {
      updates.push(fields);
    },
  } as unknown as RequestContextService;
  return { interceptor: new PlatformAuditContextInterceptor(repository, requestContext), updates };
}

function tenantHandlerProbing(
  captured: Array<{ auditTenant: string | null; authorizationTenant: string | null }>,
): { handle: () => Observable<string> } {
  return {
    handle: () => ({
      subscribe: (observer: {
        next: (value: string) => void;
        complete: () => void;
        error: (err: unknown) => void;
      }) => {
        captured.push({
          auditTenant: new AlsAuditContextResolver().resolveAuditContext().tenantId,
          authorizationTenant: new AlsAuthorizationContextResolver().resolveTenantId(),
        });
        observer.next('ok');
        observer.complete();
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

function platformHandlerProbing(
  captured: Array<{ auditTenant: string | null; authorizationTenant: string | null }>,
): { handle: () => Observable<string> } {
  return {
    handle: () => ({
      subscribe: (observer: {
        next: (value: string) => void;
        complete: () => void;
        error: (err: unknown) => void;
      }) => {
        captured.push({
          auditTenant: new AlsAuditContextResolver().resolveAuditContext().tenantId,
          authorizationTenant: new AlsAuthorizationContextResolver().resolveTenantId(),
        });
        observer.next('ok');
        observer.complete();
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

test('tenant interceptor uses the :tenantId route param in both ALS stores and publishes trustedTenantId', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor, updates } = createTenantInterceptor(memberships);
  const captured: Array<{ auditTenant: string | null; authorizationTenant: string | null }> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest({ params: { tenantId: TENANT_ID } }) }) } as never,
    tenantHandlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [{ auditTenant: TENANT_ID, authorizationTenant: TENANT_ID }]);
  assert.deepEqual(updates, [{ trustedTenantId: TENANT_ID }]);
});

test('tenant interceptor falls back to the most recent active membership for tenant-less routes', async () => {
  const now = Date.now();
  const memberships = createMembershipRepository([
    { id: 'membership-new', institutionId: TENANT_ID, createdAt: new Date(now) },
    { id: 'membership-old', institutionId: OTHER_TENANT_ID, createdAt: new Date(now - 10_000) },
  ]);
  const { interceptor } = createTenantInterceptor(memberships);
  const captured: Array<{ auditTenant: string | null; authorizationTenant: string | null }> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
    tenantHandlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [{ auditTenant: TENANT_ID, authorizationTenant: TENANT_ID }]);
});

test('tenant interceptor denies 403 when there is no route param and the user has no active membership', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createTenantInterceptor(memberships);
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
      tenantHandlerProbing([]),
    ),
    ForbiddenException,
  );
});

test('tenant interceptor denies 403 when there is no authenticated user and no route param', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createTenantInterceptor(memberships, { authenticatedUserId: null });
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest({ params: {} }) }) } as never,
      tenantHandlerProbing([]),
    ),
    ForbiddenException,
  );
});

test('platform interceptor scopes ONLY the authorization store and never sets trustedTenantId', async () => {
  const memberships = createMembershipRepository([
    { id: 'membership-new', institutionId: TENANT_ID, createdAt: new Date(Date.now()) },
  ]);
  const { interceptor, updates } = createPlatformInterceptor(memberships);
  const captured: Array<{ auditTenant: string | null; authorizationTenant: string | null }> = [];
  const observable = await interceptor.intercept(
    { switchToHttp: () => ({ getRequest: () => createRequest() }) } as never,
    platformHandlerProbing(captured),
  );
  const result = await lastValueFrom(observable);
  assert.equal(result, 'ok');
  assert.deepEqual(captured, [{ auditTenant: null, authorizationTenant: TENANT_ID }]);
  assert.deepEqual(updates, []);
});

test('platform interceptor denies 403 when the user has no active membership', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createPlatformInterceptor(memberships);
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest() }) } as never,
      platformHandlerProbing([]),
    ),
    ForbiddenException,
  );
});

test('platform interceptor denies 403 when there is no authenticated user', async () => {
  const memberships = createMembershipRepository([]);
  const { interceptor } = createPlatformInterceptor(memberships, { authenticatedUserId: null });
  await assert.rejects(
    interceptor.intercept(
      { switchToHttp: () => ({ getRequest: () => createRequest() }) } as never,
      platformHandlerProbing([]),
    ),
    ForbiddenException,
  );
});
