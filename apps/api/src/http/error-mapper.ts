import { HttpStatus } from '@nestjs/common';
import type { ErrorDetail } from '@manara/contracts';
import { HTTP_INTERNAL_ERROR } from './error-codes.js';
import { HttpApiError, httpErrorFromStatus } from './errors.js';

export interface DomainErrorLike {
  code?: unknown;
  message?: unknown;
  details?: ErrorDetail[] | null;
}

export interface MappedHttpError {
  statusCode: number;
  code: string;
  message: string;
  details: ErrorDetail[] | null;
}

/**
 * Maps domain/application errors to HTTP responses.
 *
 * Domain errors carry a stable `code` property (e.g. `tenant.institution_not_found`,
 * `authorization.permission_denied`). Mapping rules, in order:
 *
 * 1. `HttpApiError` instances keep their own status, code, and details.
 * 2. Codes are matched against the documented prefix/suffix table below.
 * 3. Unknown errors map to 500 `http.internal_error` and never expose details.
 *
 * | Rule | HTTP |
 * |---|---|
 * | code ends with `.not_found` | 404 |
 * | code ends with `.already_exists`, `.already_active`, `.conflict`, `.invalid_transition`, `.rejected` | 409 |
 * | code starts with `auth.`, `session.`, `credential.` | 401 |
 * | code starts with `authorization.`, `permission.` | 403 |
 * | code starts with `quota.`, `rate.` | 429 |
 * | code starts with `unavailable.`, `provider.` (fail-closed) | 503 |
 * | anything else | 500 |
 */
export function mapDomainError(error: DomainErrorLike): MappedHttpError {
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : 'Request failed';
  const details = error.details ?? null;
  const statusCode = statusForCode(code);
  return {
    statusCode,
    code: code === '' ? HTTP_INTERNAL_ERROR : code,
    message: statusCode >= 500 ? 'Internal server error' : message,
    details,
  };
}

function statusForCode(code: string): number {
  if (code.endsWith('.not_found') || code.endsWith('_not_found')) {
    return HttpStatus.NOT_FOUND;
  }
  if (
    code.endsWith('.already_exists') ||
    code.endsWith('_already_exists') ||
    code.endsWith('.already_active') ||
    code.endsWith('_already_active') ||
    code.endsWith('.conflict') ||
    code.endsWith('_conflict') ||
    code.endsWith('.invalid_transition') ||
    code.endsWith('_invalid_transition') ||
    code.endsWith('_transition') ||
    code.endsWith('.rejected') ||
    code.endsWith('_rejected')
  ) {
    return HttpStatus.CONFLICT;
  }
  if (code.startsWith('auth.') || code.startsWith('session.') || code.startsWith('credential.')) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (code.startsWith('authorization.') || code.startsWith('permission.')) {
    return HttpStatus.FORBIDDEN;
  }
  if (code.startsWith('quota.') || code.startsWith('rate.')) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }
  if (code.startsWith('unavailable.') || code.startsWith('provider.')) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

export function isDomainError(value: unknown): value is DomainErrorLike {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return 'code' in value && typeof (value as { code?: unknown }).code === 'string';
}

/** Converts any unknown error into an `HttpApiError` via the documented rules. */
export function toHttpApiError(error: unknown): HttpApiError {
  if (error instanceof HttpApiError) {
    return error;
  }
  if (isDomainError(error)) {
    const mapped = mapDomainError(error);
    return new HttpApiError({
      code: mapped.code,
      statusCode: mapped.statusCode,
      message: mapped.message,
      details: mapped.details ?? undefined,
    });
  }
  return httpErrorFromStatus(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
}
