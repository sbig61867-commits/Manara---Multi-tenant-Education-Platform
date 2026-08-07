export interface AuthorizationTransactionRunner {
  runInTransactionWithAdvisoryLock<T>(lockKey: number, work: () => Promise<T>): Promise<T>;
}
