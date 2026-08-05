import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER, generateRequestId, isValidRequestId } from './request-id.js';
import { HttpRequestIdError } from './errors.js';

/**
 * Assigns a request id to every request and reflects it on the response.
 * Server-generated unless a strictly valid id is forwarded; malformed
 * forwarded ids fail closed with 400.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: FastifyRequest, reply: ServerResponse, next: (error?: unknown) => void): void {
    const forwarded = request.headers[REQUEST_ID_HEADER];
    const raw = typeof forwarded === 'string' && forwarded.length > 0 ? forwarded : null;
    if (raw !== null && !isValidRequestId(raw)) {
      throw new HttpRequestIdError('Request id header is invalid');
    }
    const requestId = raw ?? generateRequestId();
    (request as FastifyRequest & { requestId?: string }).requestId = requestId;
    reply.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
