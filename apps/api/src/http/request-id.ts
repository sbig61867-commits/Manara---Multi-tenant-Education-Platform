import { randomUUID } from 'node:crypto';
import { requestIdSchema } from '@manara/contracts';
import type { RequestId } from '@manara/contracts';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Request ids are server-generated. A forwarded id is accepted only when it
 * satisfies the strict shared contract; anything else fails closed.
 */
export function generateRequestId(): RequestId {
  return randomUUID();
}

export function isValidRequestId(value: string): boolean {
  return requestIdSchema.safeParse(value).success;
}
