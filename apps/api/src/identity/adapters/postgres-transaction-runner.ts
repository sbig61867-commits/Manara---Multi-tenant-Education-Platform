import type { TransactionalExecutor } from '@manara/database';
import type { TransactionRunner } from '../ports/transaction-runner.js';

export class PostgresTransactionRunner implements TransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async () => work());
  }
}
