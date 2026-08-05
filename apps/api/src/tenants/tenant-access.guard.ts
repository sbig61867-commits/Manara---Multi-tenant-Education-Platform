import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../auth/auth.tokens.js';
import type { SessionCookieOptions } from '../http/cookie-options.js';
import { RequestContextService } from '../http/request-context.js';
import { SessionService } from '../identity/application/session.service.js';
import { MEMBERSHIP_REPOSITORY } from '../tenant/tenant.tokens.js';
import type { MembershipRepository } from '../tenant/ports/membership.repository.js';

/**
 * Minimum trusted-user/tenant enforcement for the tenant HTTP routes.
 *
 * - Resolves the session cookie and validates it server-side (401 when the
 *   session is missing or invalid).
 * - For routes carrying a `:tenantId` route parameter, the requested tenant
 *   is only a target: the authenticated user must hold an active membership
 *   in that tenant (403 otherwise). The tenant id is never taken from the
 *   request body or query as trusted context.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    @Inject(SESSION_COOKIE) private readonly sessionCookie: SessionCookieOptions,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private sessionToken(request: FastifyRequest): string | null {
    const token = request.cookies[this.sessionCookie.name];
    return typeof token === 'string' && token !== '' ? token : null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.sessionToken(request);
    if (token === null) {
      throw new UnauthorizedException('Authentication required');
    }
    const session = await this.sessions.validateSession(token);
    if (session === null) {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    this.requestContext.update({ authenticatedUserId: session.userId });
    const tenantId = request.params !== null && typeof request.params === 'object' ? (request.params as Record<string, unknown>)['tenantId'] : undefined;
    if (typeof tenantId === 'string' && tenantId !== '') {
      const membership = await this.memberships.findByUserAndInstitution(session.userId, tenantId);
      if (membership === null || membership.status !== 'active') {
        throw new ForbiddenException('Access to this tenant is denied');
      }
    }
    return true;
  }
}
