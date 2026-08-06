import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable, lastValueFrom } from 'rxjs';
import { AlsAuthorizationContextResolver } from '../authorization/adapters/als-authorization-context.resolver.js';
import { AlsEntitlementsContextResolver } from '../entitlements/adapters/als-entitlements-context.resolver.js';
import { RequestContextService } from '../http/request-context.js';
import { MEMBERSHIP_REPOSITORY } from '../tenant/tenant.tokens.js';
import type { MembershipRepository } from '../tenant/ports/membership.repository.js';

/**
 * Establishes the server-side tenant context (AsyncLocalStorage) for
 * entitlements routes, in both the authorization and the entitlements
 * stores, so the shared permission interceptor and the entitlements
 * application services see the same trusted tenant.
 *
 * - Tenant-scoped routes: the context is the `:tenantId` route parameter,
 *   already verified by `TenantAccessGuard` against the authenticated user's
 *   active membership.
 * - Tenant-less routes (the platform plan/feature catalogs): the context is
 *   the most recent tenant where the authenticated user holds an active
 *   membership; without one the request is denied (403). The tenant id is
 *   never taken from the request body, query, or headers.
 */
@Injectable()
export class EntitlementsContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private async resolveTenantId(request: FastifyRequest): Promise<string | null> {
    const params = request.params !== null && typeof request.params === 'object' ? (request.params as Record<string, unknown>) : {};
    const tenantId = params['tenantId'];
    if (typeof tenantId === 'string' && tenantId !== '') {
      return tenantId;
    }
    const current = this.requestContext.get();
    const userId = current?.authenticatedUserId ?? null;
    if (userId === null) {
      return null;
    }
    const memberships = await this.memberships.listActiveByUser(userId);
    const mostRecent = memberships[0];
    return mostRecent === undefined ? null : mostRecent.institutionId;
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenantId = await this.resolveTenantId(request);
    if (tenantId === null) {
      throw new ForbiddenException('Access to this tenant is denied');
    }
    this.requestContext.update({ trustedTenantId: tenantId });
    return new Observable<unknown>((subscriber) => {
      AlsEntitlementsContextResolver.runWithTenant(tenantId, async () => {
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
