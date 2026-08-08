import type { SqlExecutor, TransactionalExecutor } from '@manara/database';
import type { TenantTransactionRunner } from '../ports/transaction-runner.js';
import { AlsTenantContextResolver } from './als-tenant-context.resolver.js';

const TENANT_CONTEXT_SQL = 'SELECT set_config($1, $2, true)';
const TENANT_CONTEXT_SETTING = 'app.tenant_id';

export class PostgresTenantTransactionRunner implements TenantTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      await applyTenantContext(transaction, new AlsTenantContextResolver().resolveTenantId());
      return work();
    });
  }
}

export async function applyTenantContext(transaction: SqlExecutor, tenantId: string | null): Promise<void> {
  if (tenantId === null || tenantId === '') {
    return;
  }
  await transaction.query(TENANT_CONTEXT_SQL, [TENANT_CONTEXT_SETTING, tenantId]);
}
