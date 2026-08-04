import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditContext } from '../domain/types.js';
import type { AuditContextResolver } from '../ports/audit-context.js';

const auditContextStore = new AsyncLocalStorage<AuditContext>();

export class AlsAuditContextResolver implements AuditContextResolver {
  resolveAuditContext(): AuditContext {
    const context = auditContextStore.getStore();
    if (context === undefined) {
      return { tenantId: null, requestId: null };
    }
    return { tenantId: context.tenantId ?? null, requestId: context.requestId ?? null };
  }

  static runWithAuditContext<T>(
    context: Partial<AuditContext>,
    work: () => Promise<T>,
  ): Promise<T> {
    return auditContextStore.run(
      { tenantId: context.tenantId ?? null, requestId: context.requestId ?? null },
      work,
    );
  }
}
