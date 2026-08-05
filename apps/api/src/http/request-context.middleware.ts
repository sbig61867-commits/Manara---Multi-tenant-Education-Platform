import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { createRequestContext, runWithRequestContext } from './request-context.js';

const MAX_USER_AGENT_LENGTH = 200;

/**
 * Establishes the per-request AsyncLocalStorage context. The authenticated
 * user and trusted tenant placeholders are always null here — they are
 * populated only by future guards from server-side resolution and never from
 * client-supplied data.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: FastifyRequest, _reply: ServerResponse, next: (error?: unknown) => void): void {
    const requestWithMeta = request as FastifyRequest & { requestId?: string; idempotencyKey?: string };
    const rawUserAgent = request.headers['user-agent'];
    const context = createRequestContext({
      requestId: requestWithMeta.requestId ?? crypto.randomUUID(),
      clientIp: request.ip ?? null,
      userAgent: typeof rawUserAgent === 'string' ? rawUserAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      idempotencyKey: requestWithMeta.idempotencyKey ?? null,
    });
    runWithRequestContext(context, () => {
      next();
    });
  }
}
