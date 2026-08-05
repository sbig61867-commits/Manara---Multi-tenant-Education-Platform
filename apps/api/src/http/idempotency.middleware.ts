import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { idempotencyKeySchema } from '@manara/contracts';
import { HttpIdempotencyKeyError } from './errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Validates the `Idempotency-Key` header when present (bounded length and
 * charset, per the shared contract) and stores it in the request context for
 * future write endpoints. The key is metadata only and is never treated as
 * authentication or authorization input.
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  use(request: FastifyRequest, _reply: ServerResponse, next: (error?: unknown) => void): void {
    const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = idempotencyKeySchema.safeParse(raw);
      if (!parsed.success) {
        throw new HttpIdempotencyKeyError('Idempotency-Key header is invalid');
      }
      (request as FastifyRequest & { idempotencyKey?: string }).idempotencyKey = parsed.data;
    }
    next();
  }
}
