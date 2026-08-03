import 'reflect-metadata';
import { apiEnvSchema, loadConfig, loadDotenv } from '@manara/config';
import { fromPinoLogger, PostgresDatabase, resolveDatabaseConfig } from '@manara/database';
import { createLogger } from '@manara/logger';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
  const logger = createLogger({ service: 'api', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const databaseConfig = resolveDatabaseConfig();
  const database = databaseConfig
    ? new PostgresDatabase({ connectionString: databaseConfig.connectionString, logger: fromPinoLogger(logger) })
    : null;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot({ database }),
    new FastifyAdapter({ loggerInstance: logger }),
    { logger: false },
  );

  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableShutdownHooks();

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

void bootstrap();
