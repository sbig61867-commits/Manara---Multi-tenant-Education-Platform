import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { AlsTenantContextResolver } from './adapters/als-tenant-context.resolver.js';
import { PostgresInstitutionRepository } from './adapters/postgres-institution.repository.js';
import { PostgresInstitutionSettingsRepository } from './adapters/postgres-institution-settings.repository.js';
import { PostgresInvitationRepository } from './adapters/postgres-invitation.repository.js';
import { PostgresMembershipRepository } from './adapters/postgres-membership.repository.js';
import { PostgresTenantTransactionRunner } from './adapters/postgres-transaction-runner.js';
import { InstitutionService } from './application/institution.service.js';
import { InvitationService } from './application/invitation.service.js';
import { MembershipService } from './application/membership.service.js';
import { NoopTenantEventPublisher } from './domain/events.js';
import { Sha256TokenHasher } from './token-hasher.js';
import {
  INSTITUTION_REPOSITORY,
  INSTITUTION_SETTINGS_REPOSITORY,
  INVITATION_REPOSITORY,
  INVITATION_TOKEN_HASHER,
  MEMBERSHIP_REPOSITORY,
  TENANT_CONTEXT_RESOLVER,
  TENANT_EVENT_PUBLISHER,
  TENANT_TRANSACTION_RUNNER,
} from './tenant.tokens.js';

@Module({
  providers: [
    InstitutionService,
    MembershipService,
    InvitationService,
    { provide: INVITATION_TOKEN_HASHER, useClass: Sha256TokenHasher },
    { provide: TENANT_EVENT_PUBLISHER, useClass: NoopTenantEventPublisher },
  ],
  exports: [
    InstitutionService,
    MembershipService,
    InvitationService,
    INSTITUTION_REPOSITORY,
    MEMBERSHIP_REPOSITORY,
    INVITATION_REPOSITORY,
    INVITATION_TOKEN_HASHER,
  ],
})
export class TenantModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: TenantModule };
    }
    return {
      module: TenantModule,
      providers: [
        { provide: INSTITUTION_REPOSITORY, useValue: new PostgresInstitutionRepository(database) },
        { provide: INSTITUTION_SETTINGS_REPOSITORY, useValue: new PostgresInstitutionSettingsRepository(database) },
        { provide: MEMBERSHIP_REPOSITORY, useValue: new PostgresMembershipRepository(database) },
        { provide: INVITATION_REPOSITORY, useValue: new PostgresInvitationRepository(database) },
        { provide: TENANT_TRANSACTION_RUNNER, useValue: new PostgresTenantTransactionRunner(database) },
        { provide: TENANT_CONTEXT_RESOLVER, useClass: AlsTenantContextResolver },
      ],
    };
  }
}
