import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable, lastValueFrom } from 'rxjs';
import { RequestContextService } from '../http/request-context.js';
import { AlsTenantContextResolver } from '../tenant/adapters/als-tenant-context.resolver.js';
import type { InvitationRepository } from '../tenant/ports/invitation.repository.js';
import { INVITATION_REPOSITORY, INVITATION_TOKEN_HASHER } from '../tenant/tenant.tokens.js';
import type { TokenHasher } from '../tenant/token-hasher.js';

/**
 * Establishes the server-side tenant context (AsyncLocalStorage) for the
 * duration of a tenant route handler.
 *
 * - Tenant-scoped routes: the context is the `:tenantId` route parameter,
 *   already verified by `TenantAccessGuard` against the authenticated user's
 *   active membership.
 * - Invitation acceptance (`POST /v1/invitations/accept`): the context is
 *   resolved from the invitation itself (the raw token is hashed and looked
 *   up); an unknown token runs in an opaque sentinel context so the domain's
 *   generic rejection path applies. The sentinel is never written to the
 *   request context and is never logged.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(INVITATION_TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private async resolveTenantContext(
    request: FastifyRequest,
  ): Promise<{ tenantId: string; trusted: boolean } | null> {
    const params = request.params !== null && typeof request.params === 'object' ? (request.params as Record<string, unknown>) : {};
    const tenantId = params['tenantId'];
    if (typeof tenantId === 'string' && tenantId !== '') {
      return { tenantId, trusted: true };
    }
    const body = request.body !== null && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const rawToken = typeof body['rawToken'] === 'string' ? body['rawToken'] : '';
    if (rawToken === '') {
      return null;
    }
    const tokenHash = await this.tokenHasher.hash(rawToken);
    const invitation = await this.invitations.findByTokenHash(tokenHash);
    if (invitation !== null) {
      return { tenantId: invitation.institutionId, trusted: true };
    }
    return { tenantId: tokenHash, trusted: false };
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const resolved = await this.resolveTenantContext(request);
    if (resolved === null) {
      return next.handle();
    }
    if (resolved.trusted) {
      this.requestContext.update({ trustedTenantId: resolved.tenantId });
    }
    return new Observable<unknown>((subscriber) => {
      AlsTenantContextResolver.runWithTenant(resolved.tenantId, async () => {
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
