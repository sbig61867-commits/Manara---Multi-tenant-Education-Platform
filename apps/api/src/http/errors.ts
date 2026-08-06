import type { HttpException } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { ErrorDetail } from '@manara/contracts';
import type { HttpErrorCode } from './error-codes.js';
import { HTTP_INTERNAL_ERROR, HTTP_TOO_MANY_REQUESTS } from './error-codes.js';

/**
 * Base class for all API-layer errors. Carries a stable machine-readable
 * `code` and optional validation-style `details`.
 */
export class HttpApiError extends Error {
  readonly code: HttpErrorCode | string;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | null;

  constructor(options: { code: HttpErrorCode | string; statusCode: number; message: string; details?: ErrorDetail[] }) {
    super(options.message);
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? null;
  }
}

export class HttpValidationError extends HttpApiError {
  constructor(message: string, details: ErrorDetail[]) {
    super({ code: 'http.validation_failed', statusCode: HttpStatus.BAD_REQUEST, message, details });
  }
}

export class HttpRequestIdError extends HttpApiError {
  constructor(message: string) {
    super({ code: 'http.request_id_invalid', statusCode: HttpStatus.BAD_REQUEST, message });
  }
}

export class HttpIdempotencyKeyError extends HttpApiError {
  constructor(message: string) {
    super({ code: 'http.idempotency_key_invalid', statusCode: HttpStatus.BAD_REQUEST, message });
  }
}

export class HttpInvalidJsonError extends HttpApiError {
  constructor(message: string) {
    super({ code: 'http.invalid_json', statusCode: HttpStatus.BAD_REQUEST, message });
  }
}

export class HttpPayloadTooLargeError extends HttpApiError {
  constructor(message: string) {
    super({ code: 'http.payload_too_large', statusCode: HttpStatus.PAYLOAD_TOO_LARGE, message });
  }
}

export class HttpNotFoundError extends HttpApiError {
  constructor(message: string) {
    super({ code: 'http.not_found', statusCode: HttpStatus.NOT_FOUND, message });
  }
}

/**
 * Rate-limited authentication attempt. Uses the stable 429 envelope code and
 * carries only the bounded, non-reversible identifier hash plus the policy
 * label; never an email, password, token, or cookie value. The exception
 * filter converts `retryAfterSeconds` into the `Retry-After` header.
 */
export class HttpRateLimitedError extends HttpApiError {
  readonly retryAfterSeconds: number;
  readonly policy: string;
  readonly identifierHash: string | null;

  constructor(options: { retryAfterSeconds: number; policy: string; identifierHash?: string | null }) {
    super({ code: HTTP_TOO_MANY_REQUESTS, statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests' });
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.policy = options.policy;
    this.identifierHash = options.identifierHash ?? null;
  }
}

/** Throws a generic HTTP error for statuses without a dedicated class. */
export function httpErrorFromStatus(statusCode: number, message: string): HttpApiError {
  return new HttpApiError({ code: HTTP_INTERNAL_ERROR, statusCode, message });
}

/**
 * Converts a thrown `HttpException` into an `HttpApiError` with a stable code
 * derived from the status code. 5xx responses never leak exception details.
 */
export function fromHttpException(exception: HttpException): HttpApiError {
  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const message =
    typeof response === 'string' ? response : typeof response === 'object' && response !== null ? String((response as { message?: unknown }).message ?? '') : '';
  const safeMessage = statusCode >= 500 ? 'Internal server error' : message || 'Request failed';
  return new HttpApiError({ code: errorCodeForStatus(statusCode), statusCode, message: safeMessage });
}

export function errorCodeForStatus(statusCode: number): HttpErrorCode {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return HTTP_ERROR_CODES.badRequest;
    case HttpStatus.UNAUTHORIZED:
      return HTTP_ERROR_CODES.unauthorized;
    case HttpStatus.FORBIDDEN:
      return HTTP_ERROR_CODES.forbidden;
    case HttpStatus.NOT_FOUND:
      return HTTP_ERROR_CODES.notFound;
    case HttpStatus.METHOD_NOT_ALLOWED:
      return HTTP_ERROR_CODES.methodNotAllowed;
    case HttpStatus.CONFLICT:
      return HTTP_ERROR_CODES.conflict;
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return HTTP_ERROR_CODES.unsupportedMediaType;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return HTTP_ERROR_CODES.payloadTooLarge;
    case HttpStatus.TOO_MANY_REQUESTS:
      return HTTP_ERROR_CODES.tooManyRequests;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return HTTP_ERROR_CODES.unavailable;
    default:
      return HTTP_ERROR_CODES.internal;
  }
}

export const HTTP_ERROR_CODES = {
  badRequest: 'http.bad_request',
  invalidJson: 'http.invalid_json',
  unauthorized: 'http.unauthorized',
  forbidden: 'http.forbidden',
  notFound: 'http.not_found',
  methodNotAllowed: 'http.method_not_allowed',
  conflict: 'http.conflict',
  unsupportedMediaType: 'http.unsupported_media_type',
  payloadTooLarge: 'http.payload_too_large',
  tooManyRequests: 'http.too_many_requests',
  unavailable: 'http.unavailable',
  internal: 'http.internal_error',
} as const;
