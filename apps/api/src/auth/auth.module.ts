import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { buildSessionCookieOptions, resolveCookieSecure } from '../http/cookie-options.js';
import { SESSION_ABSOLUTE_TTL_MS } from '../identity/application/session.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { PostgresAuthRateLimiter } from './postgres-auth-rate-limiter.js';
import { AUTH_ENDPOINT_IP_LIMITER, AUTH_LOGIN_EMAIL_IP_LIMITER, AUTH_LOGIN_IP_LIMITER, AUTH_REFRESH_IP_LIMITER, SESSION_COOKIE } from './auth.tokens.js';

export interface AuthModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

function buildLimiter(database: PostgresDatabase, limit: number, windowMs: number, policyKey: string): PostgresAuthRateLimiter {
  return new PostgresAuthRateLimiter(database, { limit, windowMs }, policyKey);
}

/** Authentication HTTP layer with cluster-wide PostgreSQL-backed abuse protection. */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    if (options.database === null) return { module: AuthModule };
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
        { provide: AUTH_LOGIN_IP_LIMITER, useFactory: (db: PostgresDatabase) => buildLimiter(db, options.config.AUTH_LOGIN_IP_MAX_FAILURES, options.config.AUTH_LOGIN_IP_WINDOW_MS, 'login_ip'), inject: ['DATABASE'] },
        { provide: AUTH_LOGIN_EMAIL_IP_LIMITER, useFactory: (db: PostgresDatabase) => buildLimiter(db, options.config.AUTH_LOGIN_EMAIL_IP_MAX_FAILURES, options.config.AUTH_LOGIN_EMAIL_IP_WINDOW_MS, 'login_email_ip'), inject: ['DATABASE'] },
        { provide: AUTH_REFRESH_IP_LIMITER, useFactory: (db: PostgresDatabase) => buildLimiter(db, options.config.AUTH_REFRESH_IP_MAX_REQUESTS, options.config.AUTH_REFRESH_IP_WINDOW_MS, 'refresh_ip'), inject: ['DATABASE'] },
        { provide: AUTH_ENDPOINT_IP_LIMITER, useFactory: (db: PostgresDatabase) => buildLimiter(db, options.config.AUTH_ENDPOINT_IP_MAX_REQUESTS, options.config.AUTH_ENDPOINT_IP_WINDOW_MS, 'endpoint_ip'), inject: ['DATABASE'] },
        AuthRateLimitService,
      ],
    };
  }
}
