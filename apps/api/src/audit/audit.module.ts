import { Module } from '@nestjs/common';
import { AlsAuditContextResolver } from './adapters/als-audit-context.resolver.js';
import { AuditService } from './application/audit.service.js';
import { AUDIT_CONTEXT_RESOLVER } from './audit.tokens.js';

@Module({
  providers: [
    AuditService,
    { provide: AUDIT_CONTEXT_RESOLVER, useClass: AlsAuditContextResolver },
  ],
  exports: [AuditService],
})
export class AuditModule {}
