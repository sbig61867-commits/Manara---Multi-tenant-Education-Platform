import { createServer, type Server } from 'node:http';
import { loadConfig, loadDotenv, workerEnvSchema } from '@manara/config';
import { healthSchema, PACKAGE_VERSION } from '@manara/contracts';
import type { HealthStatus } from '@manara/contracts';
import { createLogger } from '@manara/logger';

function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const health: HealthStatus = healthSchema.parse({
        status: 'ok',
        service: 'worker',
        version: PACKAGE_VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(health));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

loadDotenv();
const config = loadConfig({ schema: workerEnvSchema, service: 'worker' });
const logger = createLogger({ service: 'worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

const server = createHealthServer();

server.listen(config.WORKER_HEALTH_PORT, config.WORKER_HOST, () => {
  logger.info(
    { event: 'worker_ready' },
    `Worker listening on ${config.WORKER_HOST}:${config.WORKER_HEALTH_PORT}`,
  );
});

function shutdown(signal: string): void {
  logger.info({ event: 'worker_shutdown', signal }, 'Shutting down worker');
  server.close((error) => {
    if (error) {
      logger.error({ event: 'worker_shutdown_error', error }, 'Error while closing server');
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
