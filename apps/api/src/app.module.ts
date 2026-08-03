import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { DATABASE } from './database/database.constants.js';
import { DatabaseLifecycle } from './database/database.lifecycle.js';
import { HealthController } from './health/health.controller.js';

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
      providers: [{ provide: DATABASE, useValue: options.database }],
    };
  }
}
