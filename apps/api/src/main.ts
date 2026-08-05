import 'reflect-metadata';
import { apiEnvSchema, loadConfig, loadDotenv } from '@manara/config';
import { createApiApplication } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
  const app = await createApiApplication(config);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

void bootstrap();
