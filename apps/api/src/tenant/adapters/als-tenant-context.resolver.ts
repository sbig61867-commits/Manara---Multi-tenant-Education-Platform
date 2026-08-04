import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContextResolver } from '../ports/tenant-context.js';

const tenantContextStore = new AsyncLocalStorage<string>();

export class AlsTenantContextResolver implements TenantContextResolver {
  resolveTenantId(): string | null {
    const tenantId = tenantContextStore.getStore();
    return tenantId === undefined || tenantId === '' ? null : tenantId;
  }

  static runWithTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextStore.run(tenantId, work);
  }
}
