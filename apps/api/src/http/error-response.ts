import { errorResponseSchema } from '@manara/contracts';
import type { ErrorDetail, ErrorResponse } from '@manara/contracts';

export interface BuildErrorResponseOptions {
  code: string;
  message: string;
  requestId?: string | null;
  details?: ErrorDetail[] | null;
}

/**
 * Builds the single documented error response shape:
 * `{ error: { code, message, requestId?, details? } }`.
 */
export function buildErrorResponse(options: BuildErrorResponseOptions): ErrorResponse {
  const error: { code: string; message: string; requestId?: string; details?: ErrorDetail[]; } = {
    code: options.code,
    message: options.message,
  };
  if (options.requestId) error.requestId = options.requestId;
  if (options.details) error.details = options.details;
  return errorResponseSchema.parse({ error });
}
