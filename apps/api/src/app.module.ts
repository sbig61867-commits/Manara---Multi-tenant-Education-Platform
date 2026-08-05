import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnv } from '@manara/config';
import type { PostgresDatabase } from '@manara/database';
import { OutboxModule } from '@manara/outbox';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { AuthorizationHttpModule } from './authorizations/authorization.module.js';
import { DATABASE } from './database/database.constants.js';
import { DatabaseLifecycle } from './database/database.lifecycle.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { HealthController } from './health/health.controller.js';
import { HttpModule } from './http/http.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { TenantHttpModule } from './tenants/tenant.module.js';

export interface AppModuleOptions {
  database: PostgresDatabase | null;
  config: ApiEnv;
}

@Module({
  imports: [HttpModule],
  controllers: [HealthController],
  providers: [DatabaseLifecycle],
})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports:
        options.database === null
          ? []
          : [
              AuthModule.forRoot({ database: options.database, config: options.config }),
              TenantModule.forRoot(options.database),
              TenantHttpModule.forRoot({ database: options.database, config: options.config }),
              AuthorizationModule.forRoot(options.database),
              AuthorizationHttpModule.forRoot({ database: options.database, config: options.config }),
              EntitlementsModule.forRoot(options.database),
              AuditModule.forRoot(options.database),
              OutboxModule.forRoot(options.database),
            ],
      providers: [{ provide: DATABASE, useValue: options.database }],
    };
  }
}
