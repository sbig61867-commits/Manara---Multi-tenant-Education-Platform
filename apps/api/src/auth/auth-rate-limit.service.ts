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

@Injectable()
export class AuthRateLimitService {
  constructor(
    @Inject(AUTH_LOGIN_IP_LIMITER) private readonly loginIp: AuthRateLimiterPort,
    @Inject(AUTH_LOGIN_EMAIL_IP_LIMITER) private readonly loginEmailIp: AuthRateLimiterPort,
    @Inject(AUTH_REFRESH_IP_LIMITER) private readonly refreshIp: AuthRateLimiterPort,
    @Inject(AUTH_ENDPOINT_IP_LIMITER) private readonly endpointIp: AuthRateLimiterPort,
  ) {}

  private static loginIpKey(ip: string | null): string {
    return `login_ip\u0000${normalizeClientIp(ip)}`;
  }

  private static emailIpKey(email: string, ip: string | null): string {
    return `login_email_ip\u0000${normalizeEmail(email)}\u0000${normalizeClientIp(ip)}`;
  }

  private static refreshIpKey(ip: string | null): string {
    return `refresh_ip\u0000${normalizeClientIp(ip)}`;
  }

  private static endpointIpKey(ip: string | null): string {
    return `endpoint_ip\u0000${normalizeClientIp(ip)}`;
  }

  private static throwBlocked(policy: string, decision: RateLimitDecision, key: string | null): never {
    throw new HttpRateLimitedError({
      policy,
      retryAfterSeconds: decision.retryAfterSeconds,
      identifierHash: key === null ? null : boundedIdentifierHash(key),
    });
  }

  async guardLogin(ip: string | null, email: string): Promise<void> {
    const ipKey = AuthRateLimitService.loginIpKey(ip);
    const emailIpKey = AuthRateLimitService.emailIpKey(email, ip);
    const ipDecision = await this.loginIp.check(ipKey);
    if (!ipDecision.allowed) AuthRateLimitService.throwBlocked('login_ip', ipDecision, null);
    const emailIpDecision = await this.loginEmailIp.check(emailIpKey);
    if (!emailIpDecision.allowed) AuthRateLimitService.throwBlocked('login_email_ip', emailIpDecision, emailIpKey);
  }

  async recordLoginFailure(ip: string | null, email: string): Promise<void> {
    await this.loginIp.consume(AuthRateLimitService.loginIpKey(ip));
    await this.loginEmailIp.consume(AuthRateLimitService.emailIpKey(email, ip));
  }

  async resetLoginFailures(ip: string | null, email: string): Promise<void> {
    await this.loginEmailIp.reset(AuthRateLimitService.emailIpKey(email, ip));
  }

  async guardRefresh(ip: string | null): Promise<void> {
    const decision = await this.refreshIp.check(AuthRateLimitService.refreshIpKey(ip));
    if (!decision.allowed) AuthRateLimitService.throwBlocked('refresh_ip', decision, null);
  }

  async recordRefreshFailure(ip: string | null): Promise<void> {
    await this.refreshIp.consume(AuthRateLimitService.refreshIpKey(ip));
  }

  async guardEndpoint(ip: string | null): Promise<void> {
    const key = AuthRateLimitService.endpointIpKey(ip);
    const decision = await this.endpointIp.consume(key);
    if (!decision.allowed) AuthRateLimitService.throwBlocked('endpoint_ip', decision, null);
  }
}
