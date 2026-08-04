import type { TransactionalExecutor } from '@manara/database';
import type { TenantTransactionRunner } from '../ports/transaction-runner.js';

export class PostgresTenantTransactionRunner implements TenantTransactionRunner {
  constructor(private readonly database: TransactionalExecutor) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.withTransaction(async () => work());
  }
}
