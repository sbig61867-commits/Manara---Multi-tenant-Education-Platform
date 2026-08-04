import type { TransactionalExecutor } from '@manara/database';
import type { EntitlementsTransactionRunner } from '../ports/transaction-runner.js';

export class PostgresEntitlementsTransactionRunner implements EntitlementsTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async () => work());
  }
}
