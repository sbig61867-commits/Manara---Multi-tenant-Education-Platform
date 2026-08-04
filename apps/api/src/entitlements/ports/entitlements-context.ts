import { MissingTenantContextError, TenantContextMismatchError } from '../domain/errors.js';

export interface EntitlementsContextResolver {
  resolveTenantId(): string | null;
}

export function requireTenantContext(resolver: EntitlementsContextResolver): string {
  const tenantId = resolver.resolveTenantId();
  if (tenantId === null || tenantId === '') {
    throw new MissingTenantContextError('Tenant context is missing; the operation fails closed');
  }
  return tenantId;
}

export function assertSameTenant(actualTenantId: string, expectedTenantId: string): void {
  if (actualTenantId !== expectedTenantId) {
    throw new TenantContextMismatchError('Cross-tenant operation is denied by default');
  }
}
