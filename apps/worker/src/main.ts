import 'reflect-metadata';
import type { Server } from 'node:http';
import { hostname } from 'node:os';
import { loadConfig, loadDotenv, workerEnvSchema } from '@manara/config';
import { fromPinoLogger, PostgresDatabase, resolveDatabaseConfig } from '@manara/database';
import { createLogger } from '@manara/logger';
import {
  NoopOutboxEventPublisher,
  OutboxService,
  PostgresDeadLetterRepository,
  PostgresOutboxRepository,
} from '@manara/outbox';
import type { OutboxClock } from '@manara/outbox';
import { buildOutboxDispatcherRegistry } from './outbox-event-catalog.js';
import { createHealthServer } from './health-server.js';
import { WorkerMetrics } from './metrics.js';
import { OutboxDispatcherRuntime } from './outbox-dispatcher-runtime.js';
import type { Logger } from '@manara/logger';

class SystemOutboxClock implements OutboxClock {
  now(): Date {
    return new Date();
  }
}

const clock = new SystemOutboxClock();
let config: ReturnType<typeof loadConfig<typeof workerEnvSchema>> | undefined;
let logger: Logger | undefined;
let database: PostgresDatabase | undefined;
let runtime: OutboxDispatcherRuntime | undefined;
let server: Server | undefined;
let shuttingDown = false;

async function bootstrap(): Promise<void> {
  loadDotenv();
  config = loadConfig({ schema: workerEnvSchema, service: 'worker' });
  logger = createLogger({ service: 'worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });
  const activeLogger = logger;
  const activeConfig = config;

  const databaseConfig = resolveDatabaseConfig();
  if (databaseConfig === null) {
    activeLogger.fatal(
      { event: 'worker_config_error' },
      'DATABASE_URL is required to run the outbox dispatcher; refusing to start',
    );
    process.exit(1);
  }

  database = new PostgresDatabase({
    connectionString: databaseConfig.connectionString,
    logger: fromPinoLogger(activeLogger),
  });

  const repository = new PostgresOutboxRepository(database);
  const deadLetters = new PostgresDeadLetterRepository(database);
  const service = new OutboxService(repository, deadLetters, new NoopOutboxEventPublisher(), clock);

  const metrics = new WorkerMetrics();
  const workerId = `${hostname()}:${process.pid}`;

  let registry;
  try {
    registry = buildOutboxDispatcherRegistry({ logger: activeLogger, metrics, clock });
  } catch (error) {
    activeLogger.fatal(
      { event: 'worker_dispatcher_configuration_error', error },
      'Outbox dispatcher coverage is invalid; refusing to start',
    );
    process.exit(1);
  }

  runtime = new OutboxDispatcherRuntime(
    {
      pollIntervalMs: activeConfig.WORKER_POLL_INTERVAL_MS,
      batchSize: activeConfig.WORKER_BATCH_SIZE,
      claimLeaseMs: activeConfig.WORKER_CLAIM_LEASE_MS,
      staleClaimReleaseIntervalMs: activeConfig.WORKER_STALE_CLAIM_RELEASE_INTERVAL_MS,
      shutdownTimeoutMs: activeConfig.WORKER_SHUTDOWN_TIMEOUT_MS,
      claimScope: activeConfig.WORKER_CLAIM_SCOPE,
      claimTenantId: activeConfig.WORKER_CLAIM_TENANT_ID ?? null,
      workerId,
    },
    { repository, service, clock, registry, metrics, logger: activeLogger },
  );

  server = createHealthServer({
    database,
    getReadiness: () => {
      const state = runtime?.getState();
      return {
        loopInitialized: state?.loopInitialized ?? false,
        shutdownStarted: state?.shutdownStarted ?? false,
      };
    },
  });

  await runtime.start();
  server.listen(activeConfig.WORKER_HEALTH_PORT, activeConfig.WORKER_HOST, () => {
    activeLogger.info(
      { event: 'worker_ready', workerId },
      `Worker listening on ${activeConfig.WORKER_HOST}:${activeConfig.WORKER_HEALTH_PORT}`,
    );
  });
}

function shutdown(signal: string): void {
  if (shuttingDown || logger === undefined || config === undefined) {
    return;
  }
  shuttingDown = true;
  const activeLogger = logger;
  const shutdownTimeoutMs = config.WORKER_SHUTDOWN_TIMEOUT_MS;
  activeLogger.info({ event: 'worker_shutdown', signal }, 'Shutting down worker');
  const forceTimer = setTimeout(
    () => {
      activeLogger.error({ event: 'worker_shutdown_timeout' }, 'Shutdown timed out; forcing exit');
      process.exit(1);
    },
    shutdownTimeoutMs + 5_000,
  );
  forceTimer.unref();
  server?.close((error) => {
    void (async () => {
      try {
        if (runtime) {
          await runtime.stop();
        }
        if (database) {
          await database.close();
        }
        if (error) {
          activeLogger.error({ event: 'worker_shutdown_error', error }, 'Error while closing server');
          process.exit(1);
        }
        activeLogger.info({ event: 'worker_shutdown_complete' }, 'Worker stopped cleanly');
        process.exit(0);
      } catch (shutdownError) {
        activeLogger.error({ event: 'worker_shutdown_error', error: shutdownError }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void bootstrap();
