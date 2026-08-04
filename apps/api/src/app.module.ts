import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { DATABASE } from './database/database.constants.js';
import { DatabaseLifecycle } from './database/database.lifecycle.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
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
          : [IdentityModule.forRoot(options.database), TenantModule.forRoot(options.database)],
      providers: [{ provide: DATABASE, useValue: options.database }],
    };
  }
}
