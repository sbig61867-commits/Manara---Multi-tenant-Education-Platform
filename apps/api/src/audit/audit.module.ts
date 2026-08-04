import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { AlsAuditContextResolver } from './adapters/als-audit-context.resolver.js';
import { PostgresAuditRepository } from './adapters/postgres-audit.repository.js';
import { AuditService } from './application/audit.service.js';
import { AUDIT_CONTEXT_RESOLVER, AUDIT_REPOSITORY } from './audit.tokens.js';

@Module({
  providers: [
    AuditService,
    { provide: AUDIT_CONTEXT_RESOLVER, useClass: AlsAuditContextResolver },
  ],
  exports: [AuditService],
})
export class AuditModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: AuditModule };
    }
    return {
      module: AuditModule,
      providers: [
        { provide: AUDIT_REPOSITORY, useValue: new PostgresAuditRepository(database) },
      ],
    };
  }
}
