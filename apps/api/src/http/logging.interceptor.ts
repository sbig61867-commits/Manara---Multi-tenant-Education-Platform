import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { getRequestContext } from './request-context.js';

/**
 * Structured request/response logging. Logs metadata only: method, path,
 * status, duration, request id, client ip, and (truncated) user agent. Raw
 * bodies, cookies, and authorization headers are never logged; pino's
 * redaction config additionally censors them if they ever appear in bindings.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const startedAt = performance.now();
    const requestContext = getRequestContext();
    const requestId = requestContext?.requestId ?? null;

    reply.raw.once('finish', () => {
      const durationMs = performance.now() - startedAt;
      const statusCode = reply.statusCode;
      const fields = {
        event: 'http_request',
        requestId,
        method: request.method,
        path: request.url,
        statusCode,
        durationMs,
        clientIp: requestContext?.clientIp ?? null,
        userAgent: requestContext?.userAgent ?? null,
        userId: requestContext?.authenticatedUserId ?? null,
        tenantId: requestContext?.trustedTenantId ?? null,
      };
      if (statusCode >= 500) {
        request.log.error(fields, 'Request failed');
      } else if (statusCode >= 400) {
        request.log.warn(fields, 'Request rejected');
      } else {
        request.log.info(fields, 'Request completed');
      }
    });

    return next.handle();
  }
}
