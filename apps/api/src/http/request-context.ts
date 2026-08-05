import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Per-request context propagated via AsyncLocalStorage.
 *
 * - `authenticatedUserId` and `trustedTenantId` are PLACEHOLDERS: they are
 *   always null for now and will be populated only by the future
 *   authentication/authorization guards from server-side session and
 *   membership resolution. They are never read from request bodies, query
 *   parameters, headers, or route params.
 * - `idempotencyKey` is validated, bounded metadata only; it is never treated
 *   as authentication or authorization input.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly clientIp: string | null;
  readonly userAgent: string | null;
  readonly authenticatedUserId: string | null;
  readonly trustedTenantId: string | null;
  readonly idempotencyKey: string | null;
}

export function createRequestContext(
  fields: Pick<RequestContext, 'requestId' | 'clientIp' | 'userAgent'> &
    Partial<Pick<RequestContext, 'authenticatedUserId' | 'trustedTenantId' | 'idempotencyKey'>>,
): RequestContext {
  return {
    authenticatedUserId: fields.authenticatedUserId ?? null,
    trustedTenantId: fields.trustedTenantId ?? null,
    idempotencyKey: fields.idempotencyKey ?? null,
    requestId: fields.requestId,
    clientIp: fields.clientIp,
    userAgent: fields.userAgent,
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

export function getRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

export function updateRequestContext(fields: Partial<Pick<RequestContext, 'authenticatedUserId' | 'trustedTenantId' | 'idempotencyKey'>>): void {
  const current = storage.getStore();
  if (current === undefined) {
    return;
  }
  // The context object is created per request and shared (by reference) with
  // the whole request pipeline, so mutating it makes the update visible to
  // guards, interceptors, and handlers alike. enterWith would only reach the
  // async subtree where the update was called.
  Object.assign(current, fields);
}

@Injectable()
export class RequestContextService {
  get(): RequestContext | null {
    return getRequestContext();
  }

  run<T>(context: RequestContext, work: () => T): T {
    return runWithRequestContext(context, work);
  }

  update(fields: Partial<Pick<RequestContext, 'authenticatedUserId' | 'trustedTenantId' | 'idempotencyKey'>>): void {
    updateRequestContext(fields);
  }
}
