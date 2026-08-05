import type { FastifyCorsOptions } from '@fastify/cors';

export interface CorsConfigurationInput {
  readonly corsOrigins: string;
  readonly nodeEnv: string;
}

/**
 * Builds CORS options from validated environment configuration. Fails closed:
 * in production an empty origin allow-list is a boot-time error (the API will
 * not start), never a permissive default.
 */
export function buildCorsConfig(input: CorsConfigurationInput): FastifyCorsOptions | null {
  const origins = input.corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    if (input.nodeEnv === 'production') {
      throw new Error('API_CORS_ORIGINS must be configured in production; refusing to start with CORS open');
    }
    return null;
  }

  return {
    origin: origins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 600,
  };
}
