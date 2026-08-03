import type { SqlExecutor } from './pool.js';

export interface DatabaseReadiness {
  status: 'ready' | 'unavailable';
  latencyMs?: number;
  error?: string;
}

export interface ReadinessCheckOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function checkDatabaseReadiness(
  executor: SqlExecutor,
  options?: ReadinessCheckOptions,
): Promise<DatabaseReadiness> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = performance.now();
  try {
    await withTimeout(executor.query('SELECT 1'), timeoutMs);
    return { status: 'ready', latencyMs: roundMillis(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('database readiness check timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

function roundMillis(value: number): number {
  return Math.round(value * 100) / 100;
}
