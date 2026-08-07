import type { TransactionalExecutor } from '@manara/database';
import type { AuthorizationTransactionRunner } from '../ports/transaction-runner.js';

export class PostgresAuthorizationTransactionRunner implements AuthorizationTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  runInTransactionWithAdvisoryLock<T>(lockKey: number, work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
      return work();
    });
  }
}
