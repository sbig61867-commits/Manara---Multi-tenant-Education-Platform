import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from './auth.controller.js';
import { SESSION_COOKIE } from './auth.tokens.js';

export interface AuthModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

/**
 * HTTP layer for authentication. Owns the session cookie configuration
 * (derived from the API environment) and wires the identity application
 * services; all business logic stays in `IdentityModule`.
 */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    if (options.database === null) {
      return { module: AuthModule };
    }
    const sessionCookie = buildSessionCookieOptions({
      name: options.config.API_COOKIE_NAME,
      secure: resolveCookieSecure(options.config.API_COOKIE_SECURE, options.config.NODE_ENV),
      maxAgeSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    });
    return {
      module: AuthModule,
      imports: [IdentityModule.forRoot(options.database)],
      controllers: [AuthController],
      providers: [{ provide: SESSION_COOKIE, useValue: sessionCookie }],
    };
  }
}
