import { Module } from '@nestjs/common';
import { AlsEntitlementsContextResolver } from './adapters/als-entitlements-context.resolver.js';
import { EntitlementEvaluationService } from './application/entitlement-evaluation.service.js';
import { FeatureCatalogService } from './application/feature-catalog.service.js';
import { PlanCatalogService } from './application/plan-catalog.service.js';
import { TenantEntitlementService } from './application/tenant-entitlement.service.js';
import { NoopEntitlementEventPublisher } from './domain/events.js';
import {
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_EVENT_PUBLISHER,
} from './entitlements.tokens.js';

@Module({
  providers: [
    PlanCatalogService,
    FeatureCatalogService,
    TenantEntitlementService,
    EntitlementEvaluationService,
    { provide: ENTITLEMENTS_CONTEXT_RESOLVER, useClass: AlsEntitlementsContextResolver },
    { provide: ENTITLEMENTS_EVENT_PUBLISHER, useClass: NoopEntitlementEventPublisher },
  ],
  exports: [
    PlanCatalogService,
    FeatureCatalogService,
    TenantEntitlementService,
    EntitlementEvaluationService,
  ],
})
export class EntitlementsModule {}
