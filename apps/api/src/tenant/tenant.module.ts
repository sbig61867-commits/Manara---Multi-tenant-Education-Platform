import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';

@Module({})
export class TenantModule {
  static forRoot(_database: PostgresDatabase | null): DynamicModule {
    return { module: TenantModule };
  }
}
