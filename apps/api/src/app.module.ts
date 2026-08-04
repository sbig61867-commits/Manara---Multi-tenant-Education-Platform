import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { AuditModule } from './audit/audit.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { DATABASE } from './database/database.constants.js';
import { DatabaseLifecycle } from './database/database.lifecycle.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { TenantModule } from './tenant/tenant.module.js';

export interface AppModuleOptions {
  database: PostgresDatabase | null;
}

@Module({
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
              IdentityModule.forRoot(options.database),
              TenantModule.forRoot(options.database),
              AuthorizationModule.forRoot(options.database),
              EntitlementsModule.forRoot(options.database),
              AuditModule.forRoot(options.database),
              OutboxModule.forRoot(options.database),
            ],
      providers: [{ provide: DATABASE, useValue: options.database }],
    };
  }
}
