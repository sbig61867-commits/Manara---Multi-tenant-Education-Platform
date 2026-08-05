import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { AuthorizationDecisionService } from '../authorization/application/authorization-decision.service.js';
import { RequestContextService } from '../http/request-context.js';
import { splitPermissionKey } from './authorization.dto.js';
import { REQUIRED_PERMISSION_METADATA } from './require-permission.decorator.js';

/**
 * Enforces the management permission declared by `@RequirePermission(...)` on
 * authorization management routes. Runs inside the tenant context established
 * by `AuthorizationContextInterceptor` and reuses the shared
 * `AuthorizationDecisionService`, so it can never be bypassed by the request
 * shape and requires no duplicated business logic.
 */
@Injectable()
export class AuthorizationPermissionInterceptor implements NestInterceptor {
  constructor(
    @Inject(AuthorizationDecisionService) private readonly decisions: AuthorizationDecisionService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const permissionKey = this.reflector.get<string>(REQUIRED_PERMISSION_METADATA, context.getHandler());
    if (permissionKey === undefined) {
      return next.handle();
    }
    const current = this.requestContext.get();
    const userId = current?.authenticatedUserId ?? null;
    if (userId === null) {
      throw new ForbiddenException('Access to this tenant is denied');
    }
    const split = splitPermissionKey(permissionKey);
    if (split === null) {
      throw new ForbiddenException('Access to this tenant is denied');
    }
    const allowed = await this.decisions.checkPermission({
      subject: { userId },
      resource: { type: split.type, attributes: {} },
      action: split.action,
    });
    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions to manage authorization');
    }
    return next.handle();
  }
}
