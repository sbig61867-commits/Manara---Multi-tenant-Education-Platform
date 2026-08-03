import { AsyncLocalStorage } from 'node:async_hooks';
import type { SqlExecutor } from './pool.js';

export interface Transaction extends SqlExecutor {
  readonly id: string;
}

const transactionStore = new AsyncLocalStorage<Transaction>();

export function currentTransaction(): Transaction | undefined {
  return transactionStore.getStore();
}

export function runWithTransaction<T>(transaction: Transaction, work: () => Promise<T>): Promise<T> {
  if (transactionStore.getStore()) {
    throw new Error('Nested transactions are not supported');
  }
  return transactionStore.run(transaction, work);
}
