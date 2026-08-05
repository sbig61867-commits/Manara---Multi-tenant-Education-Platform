import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_VERSION, PACKAGE_VERSION } from '@manara/contracts';

/**
 * Generates and serves the OpenAPI document (and Swagger UI) at `/docs`.
 * Enabled only outside production (or when `API_ENABLE_DOCS=true`); the
 * document is generated from controller decorators only and contains no
 * secrets or internal-only schemas.
 */
export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Manara API')
    .setDescription('Manara — multi-tenant education platform API')
    .setVersion(PACKAGE_VERSION)
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Manara API docs',
  });
}

export const SWAGGER_PATH = 'docs';

export function isSwaggerRoute(path: string): boolean {
  return path === SWAGGER_PATH || path.startsWith(`${SWAGGER_PATH}/`);
}

export { API_VERSION };
