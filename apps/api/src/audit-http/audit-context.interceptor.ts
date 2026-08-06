import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable, lastValueFrom } from 'rxjs';
import { AlsAuditContextResolver } from '../audit/adapters/als-audit-context.resolver.js';
import { AlsAuthorizationContextResolver } from '../authorization/adapters/als-authorization-context.resolver.js';
import { RequestContextService } from '../http/request-context.js';
import { MEMBERSHIP_REPOSITORY } from '../tenant/tenant.tokens.js';
import type { MembershipRepository } from '../tenant/ports/membership.repository.js';

function routeTenantId(request: FastifyRequest): string | null {
  const params = request.params !== null && typeof request.params === 'object' ? (request.params as Record<string, unknown>) : {};
  const tenantId = params['tenantId'];
  return typeof tenantId === 'string' && tenantId !== '' ? tenantId : null;
}

async function mostRecentActiveMembershipTenant(
  memberships: MembershipRepository,
  userId: string | null,
): Promise<string | null> {
  if (userId === null) {
    return null;
  }
  const active = await memberships.listActiveByUser(userId);
  const mostRecent = active[0];
  return mostRecent === undefined ? null : mostRecent.institutionId;
}

/**
 * Establishes the server-side tenant context for the tenant audit routes in
 * both the audit and the authorization AsyncLocalStorage stores, so the
 * shared permission interceptor and the audit application services see the
 * same trusted tenant.
 *
 * - Tenant-scoped routes: the context is the `:tenantId` route parameter,
 *   already verified by `TenantAccessGuard` against the authenticated user's
 *   active membership.
 * - Tenant-less routes (none today): the most recent tenant where the
 *   authenticated user holds an active membership.
 *
 * The tenant id is never taken from the request body, query, or headers.
 */
@Injectable()
export class TenantAuditContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenantId = routeTenantId(request) ?? (await mostRecentActiveMembershipTenant(this.memberships, this.requestContext.get()?.authenticatedUserId ?? null));
    if (tenantId === null) {
      throw new ForbiddenException('Access to this tenant is denied');
    }
    this.requestContext.update({ trustedTenantId: tenantId });
    const requestId = this.requestContext.get()?.requestId ?? null;
    return new Observable<unknown>((subscriber) => {
      AlsAuditContextResolver.runWithAuditContext({ tenantId, requestId }, async () => {
        AlsAuthorizationContextResolver.runWithTenant(tenantId, async () => {
          try {
            const result = await lastValueFrom(next.handle());
            subscriber.next(result);
            subscriber.complete();
          } catch (error) {
            subscriber.error(error);
          }
        });
      });
    });
  }
}

/**
 * Establishes the context for the platform audit routes. The authenticated
 * user must hold an active membership (in any tenant) so the shared
 * permission interceptor can evaluate the `audit:platform` authority through
 * the tenant-scoped RBAC; that evaluation tenant is scoped ONLY in the
 * authorization store.
 *
 * Deliberately, this interceptor:
 * - never sets `trustedTenantId` (platform routes trust no tenant),
 * - never runs the handler in an audit tenant scope (platform queries are
 *   structurally platform-scoped and must fail closed if any code path tries
 *   to resolve a tenant context).
 */
@Injectable()
export class PlatformAuditContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const tenantId = await mostRecentActiveMembershipTenant(this.memberships, this.requestContext.get()?.authenticatedUserId ?? null);
    if (tenantId === null) {
      throw new ForbiddenException('Platform access is denied');
    }
    return new Observable<unknown>((subscriber) => {
      AlsAuthorizationContextResolver.runWithTenant(tenantId, async () => {
        try {
          const result = await lastValueFrom(next.handle());
          subscriber.next(result);
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      });
    });
  }
}
