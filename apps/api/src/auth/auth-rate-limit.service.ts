import { Inject, Injectable } from '@nestjs/common';
import { HttpRateLimitedError } from '../http/errors.js';
import { normalizeEmail } from '../identity/domain/email.js';
import {
  AUTH_ENDPOINT_IP_LIMITER,
  AUTH_LOGIN_EMAIL_IP_LIMITER,
  AUTH_LOGIN_IP_LIMITER,
  AUTH_REFRESH_IP_LIMITER,
} from './auth.tokens.js';
import { boundedIdentifierHash, normalizeClientIp } from './in-memory-auth-rate-limiter.js';
import type { AuthRateLimiterPort, RateLimitDecision } from './rate-limit.types.js';

/**
 * Composes the per-endpoint authentication rate-limit policies behind the
 * replaceable `AuthRateLimiterPort`.
 *
 * Login uses two independent limiters: one per normalized client IP and one
 * per normalized email + client IP. Checks are non-consuming; failed
 * credentials consume both, and a successful login resets only the email+IP
 * counter (the broader IP limiter is never reset by success). Blocked
 * responses carry no account-existence information.
 */
@Injectable()
export class AuthRateLimitService {
  constructor(
    @Inject(AUTH_LOGIN_IP_LIMITER) private readonly loginIp: AuthRateLimiterPort,
    @Inject(AUTH_LOGIN_EMAIL_IP_LIMITER) private readonly loginEmailIp: AuthRateLimiterPort,
    @Inject(AUTH_REFRESH_IP_LIMITER) private readonly refreshIp: AuthRateLimiterPort,
    @Inject(AUTH_ENDPOINT_IP_LIMITER) private readonly endpointIp: AuthRateLimiterPort,
  ) {}

  private static emailIpKey(email: string, ip: string | null): string {
    return `${normalizeEmail(email)}\u0000${normalizeClientIp(ip)}`;
  }

  private static throwBlocked(policy: string, decision: RateLimitDecision, key: string | null): never {
    throw new HttpRateLimitedError({
      policy,
      retryAfterSeconds: decision.retryAfterSeconds,
      identifierHash: key === null ? null : boundedIdentifierHash(key),
    });
  }

  guardLogin(ip: string | null, email: string): void {
    const normalizedIp = normalizeClientIp(ip);
    const ipDecision = this.loginIp.check(normalizedIp);
    if (!ipDecision.allowed) {
      AuthRateLimitService.throwBlocked('login_ip', ipDecision, null);
    }
    const emailIpDecision = this.loginEmailIp.check(AuthRateLimitService.emailIpKey(email, ip));
    if (!emailIpDecision.allowed) {
      AuthRateLimitService.throwBlocked('login_email_ip', emailIpDecision, AuthRateLimitService.emailIpKey(email, ip));
    }
  }

  recordLoginFailure(ip: string | null, email: string): void {
    this.loginIp.consume(normalizeClientIp(ip));
    this.loginEmailIp.consume(AuthRateLimitService.emailIpKey(email, ip));
  }

  resetLoginFailures(ip: string | null, email: string): void {
    this.loginEmailIp.reset(AuthRateLimitService.emailIpKey(email, ip));
  }

  guardRefresh(ip: string | null): void {
    const decision = this.refreshIp.check(normalizeClientIp(ip));
    if (!decision.allowed) {
      AuthRateLimitService.throwBlocked('refresh_ip', decision, null);
    }
  }

  recordRefreshFailure(ip: string | null): void {
    this.refreshIp.consume(normalizeClientIp(ip));
  }

  guardEndpoint(ip: string | null): void {
    const decision = this.endpointIp.consume(normalizeClientIp(ip));
    if (!decision.allowed) {
      AuthRateLimitService.throwBlocked('endpoint_ip', decision, null);
    }
  }
}
