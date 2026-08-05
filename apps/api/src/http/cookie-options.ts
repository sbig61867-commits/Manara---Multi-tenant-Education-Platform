import type { CookieSerializeOptions } from '@fastify/cookie';

export interface SessionCookieConfig {
  readonly name: string;
  readonly secure: boolean;
  readonly maxAgeSeconds?: number;
}

export interface SessionCookieOptions {
  readonly name: string;
  readonly options: CookieSerializeOptions;
}

/**
 * Secure cookie configuration for opaque browser sessions:
 * - `HttpOnly` always (never readable by scripts)
 * - `Secure` per environment (auto → true in production)
 * - `SameSite=Lax` by default
 * - `Path=/` and `__Host-` name prefix whenever Secure is on (the prefix
 *   requires Secure, Path=/, and no Domain — enforced here by construction)
 */
export function buildSessionCookieOptions(config: SessionCookieConfig): SessionCookieOptions {
  const { name, secure, maxAgeSeconds } = config;
  const options: CookieSerializeOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
  const cookieName = secure ? `__Host-${name}` : name;
  return { name: cookieName, options };
}

export function resolveCookieSecure(mode: 'auto' | 'true' | 'false', nodeEnv: string): boolean {
  return mode === 'true' || (mode === 'auto' && nodeEnv === 'production');
}

export function resolveDocsEnabled(mode: 'auto' | 'true' | 'false', nodeEnv: string): boolean {
  return mode === 'true' || (mode === 'auto' && nodeEnv !== 'production');
}
