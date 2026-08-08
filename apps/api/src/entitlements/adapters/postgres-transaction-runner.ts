import type { TransactionalExecutor } from '@manara/database';
import { applyTenantContext } from '../../tenant/adapters/postgres-transaction-runner.js';
import type { EntitlementsTransactionRunner } from '../ports/transaction-runner.js';
import { AlsEntitlementsContextResolver } from './als-entitlements-context.resolver.js';

export class PostgresEntitlementsTransactionRunner implements EntitlementsTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      await applyTenantContext(transaction, new AlsEntitlementsContextResolver().resolveTenantId());
      return work();
    });
  }
}
