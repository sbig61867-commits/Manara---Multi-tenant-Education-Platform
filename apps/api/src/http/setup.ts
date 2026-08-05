import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { ServerResponse } from 'node:http';
import { HttpStatus } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildCorsConfig } from './cors.js';
import { applyDefaultSecurityHeaders, registerSecurityHeaders } from './security-headers.js';
import { buildErrorResponse } from './error-response.js';
import { generateRequestId } from './request-id.js';
import { HttpApiError, errorCodeForStatus } from './errors.js';
import { IdempotencyMiddleware } from './idempotency.middleware.js';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

const FST_ERR_CTP_INVALID_JSON = 'FST_ERR_CTP_INVALID_JSON';
const FST_ERR_CTP_BODY_TOO_LARGE = 'FST_ERR_CTP_BODY_TOO_LARGE';

function requestIdOf(request: FastifyRequest): string {
  const requestWithId = request as FastifyRequest & { requestId?: string };
  return requestWithId.requestId ?? generateRequestId();
}

/**
 * Registers the shared HTTP foundation on the Fastify instance: security
 * headers, CORS (fail-closed in production), cookie parsing, and consistent
 * error responses for failures that occur before NestJS routing (malformed
 * JSON, oversized bodies, unknown routes, middleware errors).
 */
export async function configureHttpFoundation(app: NestFastifyApplication, config: ApiEnv): Promise<void> {
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;

  const corsConfig = buildCorsConfig({ corsOrigins: config.API_CORS_ORIGINS, nodeEnv: config.NODE_ENV });
  if (corsConfig !== null) {
    await app.register(cors, corsConfig);
  }
  await registerSecurityHeaders(app, { trustProxy: config.API_TRUST_PROXY });
  await app.register(cookie);

  await app.init();

  const fastifyWithMiddie = instance as FastifyInstance & {
    use(path: string, fn: (request: unknown, response: unknown, next: (error?: unknown) => void) => void): unknown;
  };
  const healthMiddleware = (middleware: {
    use(request: FastifyRequest, response: ServerResponse, next: (error?: unknown) => void): void;
  }) => (request: unknown, response: unknown, next: (error?: unknown) => void): void => {
    middleware.use(request as FastifyRequest, response as ServerResponse, next);
  };
  for (const middleware of [new RequestIdMiddleware(), new IdempotencyMiddleware(), new RequestContextMiddleware()]) {
    fastifyWithMiddie.use('/health', healthMiddleware(middleware));
  }

  instance.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) {
      return;
    }
    applyDefaultSecurityHeaders(reply.raw);
    const requestId = requestIdOf(request);
    if (error instanceof HttpApiError) {
      reply.status(error.statusCode).send(buildErrorResponse({ code: error.code, message: error.message, requestId, details: error.details }));
      return;
    }
    if (error.code === FST_ERR_CTP_INVALID_JSON) {
      reply.status(HttpStatus.BAD_REQUEST).send(buildErrorResponse({ code: 'http.invalid_json', message: 'Request body is not valid JSON', requestId }));
      return;
    }
    if (error.code === FST_ERR_CTP_BODY_TOO_LARGE) {
      reply.status(HttpStatus.PAYLOAD_TOO_LARGE).send(buildErrorResponse({ code: 'http.payload_too_large', message: 'Request body exceeds the allowed size', requestId }));
      return;
    }
    const statusCode = error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    request.log.error({ event: 'fastify_error', requestId, errorCode: error.code, message: error.message }, 'Fastify error');
    const code = errorCodeForStatus(statusCode);
    const message = statusCode >= HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal server error' : error.message || 'Request failed';
    reply.status(statusCode).send(buildErrorResponse({ code, message, requestId }));
  });
}
