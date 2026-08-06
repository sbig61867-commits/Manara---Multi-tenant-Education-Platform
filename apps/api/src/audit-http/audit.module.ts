import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { SESSION_COOKIE } from '../auth/auth.tokens.js';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { TenantAccessGuard } from '../tenants/tenant-access.guard.js';
import { AuthorizationPermissionInterceptor } from '../authorizations/authorization-permission.interceptor.js';
import { PlatformAuditContextInterceptor, TenantAuditContextInterceptor } from './audit-context.interceptor.js';
import { PlatformAuditController, TenantAuditController } from './audit.controller.js';

export interface AuditHttpModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

/**
 * HTTP layer for audit history queries. Owns the session cookie configuration
 * (derived from the API environment) and wires the shared
 * authentication/tenant/authorization infrastructure; all business logic and
 * tenant/platform scoping rules stay in `AuditModule`. Read-only: no audit
 * mutation endpoints are exposed.
 */
@Module({})
export class AuditHttpModule {
  static forRoot(options: AuditHttpModuleOptions): DynamicModule {
    if (options.database === null) {
      return { module: AuditHttpModule };
    }
    const sessionCookie = buildSessionCookieOptions({
      name: options.config.API_COOKIE_NAME,
      secure: resolveCookieSecure(options.config.API_COOKIE_SECURE, options.config.NODE_ENV),
      maxAgeSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    });
    return {
      module: AuditHttpModule,
      imports: [
        IdentityModule.forRoot(options.database),
        TenantModule.forRoot(options.database),
        AuthorizationModule.forRoot(options.database),
        AuditModule.forRoot(options.database),
      ],
      controllers: [TenantAuditController, PlatformAuditController],
      providers: [
        { provide: SESSION_COOKIE, useValue: sessionCookie },
        TenantAccessGuard,
        TenantAuditContextInterceptor,
        PlatformAuditContextInterceptor,
        AuthorizationPermissionInterceptor,
      ],
    };
  }
}
