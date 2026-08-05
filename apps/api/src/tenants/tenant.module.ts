import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { SESSION_COOKIE } from '../auth/auth.tokens.js';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { TenantAccessGuard } from './tenant-access.guard.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';
import { InvitationController, TenantController } from './tenant.controller.js';

export interface TenantHttpModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

/**
 * HTTP layer for tenant/institution management. Owns the session cookie
 * configuration (derived from the API environment) and wires the tenant
 * application services; all business logic stays in `TenantModule`.
 */
@Module({})
export class TenantHttpModule {
  static forRoot(options: TenantHttpModuleOptions): DynamicModule {
    if (options.database === null) {
      return { module: TenantHttpModule };
    }
    const sessionCookie = buildSessionCookieOptions({
      name: options.config.API_COOKIE_NAME,
      secure: resolveCookieSecure(options.config.API_COOKIE_SECURE, options.config.NODE_ENV),
      maxAgeSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    });
    return {
      module: TenantHttpModule,
      imports: [IdentityModule.forRoot(options.database), TenantModule.forRoot(options.database)],
      controllers: [TenantController, InvitationController],
      providers: [
        { provide: SESSION_COOKIE, useValue: sessionCookie },
        TenantAccessGuard,
        TenantContextInterceptor,
      ],
    };
  }
}
