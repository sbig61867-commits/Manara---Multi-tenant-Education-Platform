import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { RequestLoggingInterceptor } from './logging.interceptor.js';
import { RequestContextService } from './request-context.js';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { RequestIdMiddleware } from './request-id.middleware.js';
import { IdempotencyMiddleware } from './idempotency.middleware.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/**
 * Global shared HTTP infrastructure. Middleware order matters:
 * request-id → idempotency → request context.
 */
@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useValue: new ZodValidationPipe(null, 'body') },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
  exports: [RequestContextService],
})
export class HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, IdempotencyMiddleware, RequestContextMiddleware)
      .forRoutes('*');
  }
}
