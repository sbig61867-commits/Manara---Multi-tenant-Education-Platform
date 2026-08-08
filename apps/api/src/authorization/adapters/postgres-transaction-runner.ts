import type { TransactionalExecutor } from '@manara/database';
import { applyTenantContext } from '../../tenant/adapters/postgres-transaction-runner.js';
import type { AuthorizationTransactionRunner } from '../ports/transaction-runner.js';
import { AlsAuthorizationContextResolver } from './als-authorization-context.resolver.js';

export class PostgresAuthorizationTransactionRunner implements AuthorizationTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  runInTransactionWithAdvisoryLock<T>(lockKey: number, work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      await applyTenantContext(transaction, new AlsAuthorizationContextResolver().resolveTenantId());
      await transaction.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
      return work();
    });
  }
}
