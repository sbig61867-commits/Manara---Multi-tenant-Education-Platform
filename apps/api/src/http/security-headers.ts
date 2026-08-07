import helmet from '@fastify/helmet';
import type { ApiTrustProxy } from '@manara/config';
import type { ServerResponse } from 'node:http';

export interface HelmetConfig {
  readonly trustProxy: ApiTrustProxy;
}

/**
 * Registers security headers via @fastify/helmet with its defaults
 * (X-Content-Type-Options: nosniff, X-Frame-Options, Referrer-Policy,
 * Strict-Transport-Security, X-DNS-Prefetch-Control, etc.).
 */
export function registerSecurityHeaders<T>(app: { register(plugin: unknown, options?: Record<string, unknown>): Promise<T> }, _config: HelmetConfig): Promise<T> {
  return app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: false,
  });
}

/** Security headers guaranteed by the default helmet setup (used by tests). */
export const EXPECTED_SECURITY_HEADERS = [
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'strict-transport-security',
  'x-dns-prefetch-control',
] as const;

const DEFAULT_SECURITY_HEADER_VALUES: Record<(typeof EXPECTED_SECURITY_HEADERS)[number], string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-dns-prefetch-control': 'off',
};

/**
 * Applies the baseline security headers directly to a raw Node response.
 * Used for error responses that bypass the Fastify reply pipeline (Nest
 * middleware failures), where helmet's hooks do not run.
 */
export function applyDefaultSecurityHeaders(response: ServerResponse): void {
  for (const name of EXPECTED_SECURITY_HEADERS) {
    response.setHeader(name, DEFAULT_SECURITY_HEADER_VALUES[name]);
  }
}
