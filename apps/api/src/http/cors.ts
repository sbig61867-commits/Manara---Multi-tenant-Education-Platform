import type { FastifyCorsOptions } from '@fastify/cors';

export interface CorsConfigurationInput {
  readonly corsOrigins: string;
  readonly nodeEnv: string;
}

function normalizeOrigin(raw: string, requireHttps: boolean): string {
  if (raw.includes('*')) {
    throw new Error('API_CORS_ORIGINS must contain exact origins without wildcards');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API_CORS_ORIGINS contains a malformed origin');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API_CORS_ORIGINS supports only HTTP(S) origins');
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error('API_CORS_ORIGINS must use HTTPS in staging and production');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('API_CORS_ORIGINS must not contain credentials');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('API_CORS_ORIGINS entries must be origins without paths, queries, or fragments');
  }
  return url.origin;
}

/**
 * Builds CORS options from validated environment configuration. Fails closed:
 * in production an empty origin allow-list is a boot-time error (the API will
 * not start), never a permissive default.
 */
export function buildCorsConfig(input: CorsConfigurationInput): FastifyCorsOptions | null {
  const rawOrigins = input.corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const protectedEnvironment = input.nodeEnv === 'staging' || input.nodeEnv === 'production';

  if (rawOrigins.length === 0) {
    if (protectedEnvironment) {
      throw new Error('API_CORS_ORIGINS must be configured in staging and production');
    }
    return null;
  }

  const origins = [...new Set(rawOrigins.map((origin) => normalizeOrigin(origin, protectedEnvironment)))];

  return {
    origin: origins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 600,
  };
}
