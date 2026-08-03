import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { DatabaseLogger } from './logging.js';
import { nullDatabaseLogger } from './logging.js';
import { currentTransaction, runWithTransaction } from './transaction.js';
import type { Transaction } from './transaction.js';

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number | null;
}

export interface SqlExecutor {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface TransactionalExecutor extends SqlExecutor {
  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export interface DatabaseOptions {
  connectionString: string;
  logger?: DatabaseLogger;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

function mapResult<T>(result: pg.QueryResult<Record<string, unknown>>): QueryResult<T> {
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

export class PostgresDatabase implements TransactionalExecutor {
  private readonly pool: pg.Pool;
  private readonly logger: DatabaseLogger;
  private closed = false;

  constructor(options: DatabaseOptions) {
    const url = new URL(options.connectionString);
    this.logger = options.logger ?? nullDatabaseLogger();
    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.max,
      idleTimeoutMillis: options.idleTimeoutMillis,
      connectionTimeoutMillis: options.connectionTimeoutMillis,
    });
    this.pool.on('connect', () => {
      this.logger.info({
        event: 'pool.connect',
        host: url.hostname,
        port: url.port === '' ? 5432 : Number(url.port),
        database: url.pathname.replace(/^\/+/, ''),
      });
    });
    this.pool.on('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({
        event: 'pool.error',
        code: (err as { code?: string }).code,
        message: err.message,
      });
    });
  }

  async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    const transaction = currentTransaction();
    if (transaction) {
      return transaction.query<T>(sql, params);
    }
    return mapResult<T>(await this.pool.query(sql, params as never[]));
  }

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const transaction: Transaction = {
        id: randomUUID(),
        query: async <R = unknown>(sql: string, params?: readonly unknown[]) =>
          mapResult<R>(await client.query(sql, params as never[])),
      };
      let result: T;
      try {
        result = await runWithTransaction(transaction, () => work(transaction));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      try {
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      return result;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
    this.logger.info({ event: 'pool.closed' });
  }
}
