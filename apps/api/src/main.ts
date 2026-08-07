import 'reflect-metadata';
import { apiEnvSchema, loadConfig, loadDotenv } from '@manara/config';
import { createApiApplication } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig({ schema: apiEnvSchema, service: 'api' });
  const app = await createApiApplication(config);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

void bootstrap().catch((error: unknown) => {
  if (error instanceof Error && error.name === 'authorization.permission_catalog_incomplete') {
    const catalogError = error as Error & {
      required: number;
      present: number;
      missingKeys: readonly string[];
    };
    process.stderr.write(
      `${JSON.stringify({
        code: error.name,
        required: catalogError.required,
        present: catalogError.present,
        missingKeys: catalogError.missingKeys,
      })}\n`,
    );
  } else {
    process.stderr.write('API startup failed.\n');
  }
  process.exitCode = 1;
});
