export interface EntitlementsTransactionRunner {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}
