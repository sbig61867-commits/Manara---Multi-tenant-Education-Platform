export interface TenantTransactionRunner {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}
