import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import {
  AUTH_ENDPOINT_IP_LIMITER,
  AUTH_LOGIN_EMAIL_IP_LIMITER,
  AUTH_LOGIN_IP_LIMITER,
  AUTH_REFRESH_IP_LIMITER,
  SESSION_COOKIE,
} from './auth.tokens.js';
import { InMemoryAuthRateLimiter } from './in-memory-auth-rate-limiter.js';

export interface AuthModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

function buildLimiter(config: ApiEnv, limit: number, windowMs: number): InMemoryAuthRateLimiter {
  return new InMemoryAuthRateLimiter({ limit, windowMs });
}

/**
 * HTTP layer for authentication. Owns the session cookie configuration
 * (derived from the API environment) and wires the identity application
 * services; all business logic stays in `IdentityModule`.
 *
 * Abuse protection uses in-memory per-instance limiters (no external
 * service). Counters are NOT shared across API instances: with more than one
 * instance, each has independent windows and the protection is per-instance,
 * not cluster-wide. A shared-store adapter behind `AuthRateLimiterPort`
 * (e.g. Redis) is required for cluster-wide protection.
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
      providers: [
        { provide: SESSION_COOKIE, useValue: sessionCookie },
        {
          provide: AUTH_LOGIN_IP_LIMITER,
          useValue: buildLimiter(options.config, options.config.AUTH_LOGIN_IP_MAX_FAILURES, options.config.AUTH_LOGIN_IP_WINDOW_MS),
        },
        {
          provide: AUTH_LOGIN_EMAIL_IP_LIMITER,
          useValue: buildLimiter(options.config, options.config.AUTH_LOGIN_EMAIL_IP_MAX_FAILURES, options.config.AUTH_LOGIN_EMAIL_IP_WINDOW_MS),
        },
        {
          provide: AUTH_REFRESH_IP_LIMITER,
          useValue: buildLimiter(options.config, options.config.AUTH_REFRESH_IP_MAX_REQUESTS, options.config.AUTH_REFRESH_IP_WINDOW_MS),
        },
        {
          provide: AUTH_ENDPOINT_IP_LIMITER,
          useValue: buildLimiter(options.config, options.config.AUTH_ENDPOINT_IP_MAX_REQUESTS, options.config.AUTH_ENDPOINT_IP_WINDOW_MS),
        },
        AuthRateLimitService,
      ],
    };
  }
}
