import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntitlementsContextResolver } from '../ports/entitlements-context.js';

const entitlementsContextStore = new AsyncLocalStorage<string>();

export class AlsEntitlementsContextResolver implements EntitlementsContextResolver {
  resolveTenantId(): string | null {
    const tenantId = entitlementsContextStore.getStore();
    return tenantId === undefined || tenantId === '' ? null : tenantId;
  }

  static runWithTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return entitlementsContextStore.run(tenantId, work);
  }
}
