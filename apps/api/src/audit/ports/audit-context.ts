import { MissingTenantContextError } from '../domain/errors.js';
import type { AuditContext } from '../domain/types.js';

export interface AuditContextResolver {
  resolveAuditContext(): AuditContext;
}

export function requireAuditTenantContext(resolver: AuditContextResolver): string {
  const context = resolver.resolveAuditContext();
  if (context.tenantId === null || context.tenantId === '') {
    throw new MissingTenantContextError('Audit tenant context is missing; the operation fails closed');
  }
  return context.tenantId;
}
