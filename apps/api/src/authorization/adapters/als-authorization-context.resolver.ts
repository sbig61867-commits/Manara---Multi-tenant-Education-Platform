import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthorizationContextResolver } from '../ports/authorization-context.js';

const authorizationContextStore = new AsyncLocalStorage<string>();

export class AlsAuthorizationContextResolver implements AuthorizationContextResolver {
  resolveTenantId(): string | null {
    const tenantId = authorizationContextStore.getStore();
    return tenantId === undefined || tenantId === '' ? null : tenantId;
  }

  static runWithTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return authorizationContextStore.run(tenantId, work);
  }
}
