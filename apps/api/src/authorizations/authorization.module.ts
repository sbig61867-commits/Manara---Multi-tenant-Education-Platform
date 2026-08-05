import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { SESSION_COOKIE } from '../auth/auth.tokens.js';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TenantAccessGuard } from '../tenants/tenant-access.guard.js';
import { AuthorizationContextInterceptor } from './authorization-context.interceptor.js';
import { AuthorizationPermissionInterceptor } from './authorization-permission.interceptor.js';
import { AuthorizationController, PermissionCatalogController } from './authorization.controller.js';

export interface AuthorizationHttpModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

/**
 * HTTP layer for authorization management. Owns the session cookie
 * configuration (derived from the API environment) and wires the shared
 * authentication/tenant/authorization infrastructure; all business logic
 * stays in `AuthorizationModule`.
 */
@Module({})
export class AuthorizationHttpModule {
  static forRoot(options: AuthorizationHttpModuleOptions): DynamicModule {
    if (options.database === null) {
      return { module: AuthorizationHttpModule };
    }
    const sessionCookie = buildSessionCookieOptions({
      name: options.config.API_COOKIE_NAME,
      secure: resolveCookieSecure(options.config.API_COOKIE_SECURE, options.config.NODE_ENV),
      maxAgeSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    });
    return {
      module: AuthorizationHttpModule,
      imports: [
        IdentityModule.forRoot(options.database),
        TenantModule.forRoot(options.database),
        AuthorizationModule.forRoot(options.database),
      ],
      controllers: [AuthorizationController, PermissionCatalogController],
      providers: [
        { provide: SESSION_COOKIE, useValue: sessionCookie },
        TenantAccessGuard,
        AuthorizationContextInterceptor,
        AuthorizationPermissionInterceptor,
      ],
    };
  }
}
