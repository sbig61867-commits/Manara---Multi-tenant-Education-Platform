import { createServer, type Server, type ServerResponse } from 'node:http';
import { checkDatabaseReadiness, type PostgresDatabase } from '@manara/database';
import { healthSchema, PACKAGE_VERSION, readinessSchema } from '@manara/contracts';
import type { HealthStatus, ReadinessStatus } from '@manara/contracts';

export interface WorkerReadiness {
  readonly loopInitialized: boolean;
  readonly shutdownStarted: boolean;
}

export interface HealthServerOptions {
  readonly database: PostgresDatabase;
  getReadiness(): WorkerReadiness;
}

/**
 * Health server: `/health` is liveness (200 while the process runs);
 * `/health/ready` is readiness (200 only when the database is reachable, the
 * polling loop is initialized, and shutdown has not started).
 */
export function createHealthServer(options: HealthServerOptions): Server {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const health: HealthStatus = healthSchema.parse({
        status: 'ok',
        service: 'worker',
        version: PACKAGE_VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      writeJson(res, 200, health);
      return;
    }
    if (req.method === 'GET' && req.url === '/health/ready') {
      const database = await checkDatabaseReadiness(options.database);
      const readiness = options.getReadiness();
      const ready = database.status === 'ready' && readiness.loopInitialized && !readiness.shutdownStarted;
      const body: ReadinessStatus = readinessSchema.parse({
        status: ready ? 'ready' : 'unavailable',
        service: 'worker',
        version: PACKAGE_VERSION,
        timestamp: new Date().toISOString(),
        database,
      });
      writeJson(res, ready ? 200 : 503, body);
      return;
    }
    writeJson(res, 404, { error: 'not_found' });
  });
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
