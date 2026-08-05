import { ZodError } from 'zod';
import type { ServerResponse } from 'node:http';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { generateRequestId, REQUEST_ID_HEADER } from './request-id.js';
import { buildErrorResponse } from './error-response.js';
import { applyDefaultSecurityHeaders } from './security-headers.js';
import { HTTP_VALIDATION_FAILED } from './error-codes.js';
import { HttpApiError, HttpValidationError, fromHttpException } from './errors.js';
import { isDomainError, mapDomainError } from './error-mapper.js';
import { getRequestContext } from './request-context.js';

/**
 * Global exception filter producing the single documented error shape for
 * every failure class: validation (400), domain errors (mapped codes),
 * `HttpException`s (status-derived codes), and unknown errors (500, generic
 * message — never a stack trace or driver detail).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply | ServerResponse>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = getRequestContext()?.requestId ?? generateRequestId();

    let statusCode: number;
    let code: string;
    let message: string;
    let details: { path: string; code: string; message: string }[] | null;

    if (exception instanceof ZodError) {
      statusCode = HttpStatus.BAD_REQUEST;
      code = HTTP_VALIDATION_FAILED;
      message = 'Validation failed';
      details = exception.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        code: issue.code,
        message: issue.message,
      }));
    } else if (exception instanceof HttpValidationError) {
      statusCode = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpApiError) {
      statusCode = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      const mapped = fromHttpException(exception);
      statusCode = mapped.statusCode;
      code = mapped.code;
      message = mapped.message;
      details = null;
    } else if (isDomainError(exception)) {
      const mapped = mapDomainError(exception);
      statusCode = mapped.statusCode;
      code = mapped.code;
      message = mapped.message;
      details = mapped.details;
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'http.internal_error';
      message = 'Internal server error';
      details = null;
    }

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      request.log.error(
        {
          event: 'http_request_error',
          requestId,
          errorCode: code,
          error: exception instanceof Error ? { message: exception.message, stack: exception.stack } : undefined,
        },
        'Unhandled error',
      );
    }

    const payload = buildErrorResponse({ code, message, requestId, details });
    if (typeof (response as FastifyReply).status === 'function') {
      const reply = response as FastifyReply;
      if (reply.sent) {
        return;
      }
      reply.status(statusCode).send(payload);
      return;
    }
    const raw = response as ServerResponse;
    if (raw.headersSent) {
      return;
    }
    applyDefaultSecurityHeaders(raw);
    raw.statusCode = statusCode;
    raw.setHeader('content-type', 'application/json; charset=utf-8');
    raw.setHeader(REQUEST_ID_HEADER, requestId);
    raw.end(JSON.stringify(payload));
  }
}
