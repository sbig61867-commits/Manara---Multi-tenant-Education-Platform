import {
  ClientSuppliedTenantIdentityError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../domain/errors.js';
import type { AttributeValue } from '../domain/types.js';

export interface AuthorizationContextResolver {
  resolveTenantId(): string | null;
}

export function requireTenantContext(resolver: AuthorizationContextResolver): string {
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

export function assertNoClientTenantIdentity(
  attributes: Readonly<Record<string, AttributeValue>>,
): void {
  if (attributes['tenantId'] !== undefined || attributes['tenant_id'] !== undefined) {
    throw new ClientSuppliedTenantIdentityError(
      'Tenant identity must never be supplied by the caller',
    );
  }
}
