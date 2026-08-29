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

export interface ApiApplicationOptions {
  verifyPermissionCatalog?: boolean;
}

/**
 * Creates and fully initializes the NestJS (Fastify) API application for the
 * given environment configuration. The optional startup-verification switch
 * is intended for isolated HTTP-foundation tests; production bootstrap keeps
 * permission-catalog verification enabled by default.
 */
export async function createApiApplication(
  config: ApiEnv,
  options: ApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
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

    app.setGlobalPrefix(API_VERSION, { exclude: ['health'] });
    app.enableShutdownHooks();

    await configureHttpFoundation(app, config);

    if (resolveDocsEnabled(config.API_ENABLE_DOCS, config.NODE_ENV)) {
      setupSwagger(app);
    }

    if (options.verifyPermissionCatalog !== false) {
      await verifyPermissionCatalogAtStartup(
        config.NODE_ENV,
        database === null ? null : () => app!.get(PermissionCatalogService).verifyCatalog(),
      );
    }

    return app;
  } catch (error) {
    await app?.close().catch(() => undefined);
    await database?.close().catch(() => undefined);
    throw error;
  }
}
