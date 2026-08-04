import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { AlsEntitlementsContextResolver } from './adapters/als-entitlements-context.resolver.js';
import { PostgresFeatureDefinitionRepository } from './adapters/postgres-feature-definition.repository.js';
import { PostgresPlanRepository } from './adapters/postgres-plan.repository.js';
import { PostgresTenantEntitlementRepository } from './adapters/postgres-tenant-entitlement.repository.js';
import { PostgresEntitlementsTransactionRunner } from './adapters/postgres-transaction-runner.js';
import { PostgresUsageMeterRepository } from './adapters/postgres-usage-meter.repository.js';
import { PostgresUsageQuotaRepository } from './adapters/postgres-usage-quota.repository.js';
import { EntitlementEvaluationService } from './application/entitlement-evaluation.service.js';
import { FeatureCatalogService } from './application/feature-catalog.service.js';
import { PlanCatalogService } from './application/plan-catalog.service.js';
import { TenantEntitlementService } from './application/tenant-entitlement.service.js';
import { NoopEntitlementEventPublisher } from './domain/events.js';
import {
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_EVENT_PUBLISHER,
  ENTITLEMENTS_TRANSACTION_RUNNER,
  FEATURE_DEFINITION_REPOSITORY,
  PLAN_REPOSITORY,
  TENANT_ENTITLEMENT_REPOSITORY,
  USAGE_METER_REPOSITORY,
  USAGE_QUOTA_REPOSITORY,
} from './entitlements.tokens.js';

@Module({
  providers: [
    PlanCatalogService,
    FeatureCatalogService,
    TenantEntitlementService,
    EntitlementEvaluationService,
    { provide: ENTITLEMENTS_EVENT_PUBLISHER, useClass: NoopEntitlementEventPublisher },
  ],
  exports: [
    PlanCatalogService,
    FeatureCatalogService,
    TenantEntitlementService,
    EntitlementEvaluationService,
  ],
})
export class EntitlementsModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: EntitlementsModule };
    }
    return {
      module: EntitlementsModule,
      providers: [
        { provide: PLAN_REPOSITORY, useValue: new PostgresPlanRepository(database) },
        {
          provide: FEATURE_DEFINITION_REPOSITORY,
          useValue: new PostgresFeatureDefinitionRepository(database),
        },
        {
          provide: TENANT_ENTITLEMENT_REPOSITORY,
          useValue: new PostgresTenantEntitlementRepository(database),
        },
        {
          provide: USAGE_QUOTA_REPOSITORY,
          useValue: new PostgresUsageQuotaRepository(database),
        },
        {
          provide: USAGE_METER_REPOSITORY,
          useValue: new PostgresUsageMeterRepository(database),
        },
        {
          provide: ENTITLEMENTS_TRANSACTION_RUNNER,
          useValue: new PostgresEntitlementsTransactionRunner(database),
        },
        { provide: ENTITLEMENTS_CONTEXT_RESOLVER, useClass: AlsEntitlementsContextResolver },
      ],
    };
  }
}
