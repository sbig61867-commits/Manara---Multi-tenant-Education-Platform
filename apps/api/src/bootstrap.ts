import { API_VERSION } from '@manara/contracts';
import type { ApiEnv } from '@manara/config';
import { fromPinoLogger, PostgresDatabase, resolveDatabaseConfig } from '@manara/database';
import { createLogger } from '@manara/logger';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { PermissionCatalogService } from './authorization/application/permission-catalog.service.js';
import { verifyPermissionCatalogAtStartup } from './authorization/application/permission-catalog-startup-verifier.js';
import { resolveDocsEnabled } from './http/cookie-options.js';
import { setupSwagger } from './http/swagger.js';
import { configureHttpFoundation } from './http/setup.js';

/**
 * Creates and fully initializes the NestJS (Fastify) API application for the
 * given environment configuration. Mirrors the production bootstrap path in
 * `main.ts` (module graph, adapter, global prefix, HTTP foundation, Swagger)
 * but does not listen on a port, so it can be driven by tests via `inject()`.
 */
export async function createApiApplication(config: ApiEnv): Promise<NestFastifyApplication> {
  const logger = createLogger({ service: 'api', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const databaseConfig = resolveDatabaseConfig();
  const database = databaseConfig
    ? new PostgresDatabase({
        connectionString: databaseConfig.connectionString,
        max: config.API_DATABASE_POOL_MAX,
        connectionTimeoutMillis: databaseConfig.connectionTimeoutMillis,
        idleTimeoutMillis: databaseConfig.idleTimeoutMillis,
        logger: fromPinoLogger(logger),
      })
    : null;

  let app: NestFastifyApplication | null = null;
  try {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.forRoot({ database, config }),
      new FastifyAdapter({
        loggerInstance: logger,
        bodyLimit: config.API_BODY_LIMIT_BYTES,
        onProtoPoisoning: 'error',
        onConstructorPoisoning: 'error',
        trustProxy: config.API_TRUST_PROXY,
        allowErrorHandlerOverride: true,
      }),
      { logger: false },
    );

    await verifyPermissionCatalogAtStartup(
      config.NODE_ENV,
      database === null ? null : () => app!.get(PermissionCatalogService).verifyCatalog(),
    );

    app.setGlobalPrefix(API_VERSION, { exclude: ['health'] });
    app.enableShutdownHooks();

    await configureHttpFoundation(app, config);

    if (resolveDocsEnabled(config.API_ENABLE_DOCS, config.NODE_ENV)) {
      setupSwagger(app);
    }

    return app;
  } catch (error) {
    await app?.close().catch(() => undefined);
    await database?.close().catch(() => undefined);
    throw error;
  }
}
