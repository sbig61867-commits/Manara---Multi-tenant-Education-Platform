import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { AlsAuthorizationContextResolver } from './adapters/als-authorization-context.resolver.js';
import { PostgresPermissionRepository } from './adapters/postgres-permission.repository.js';
import { PostgresRoleAssignmentRepository } from './adapters/postgres-role-assignment.repository.js';
import { PostgresRoleRepository } from './adapters/postgres-role.repository.js';
import { AuthorizationDecisionService } from './application/authorization-decision.service.js';
import { DefaultAbacPolicy } from './application/default-abac.policy.js';
import { DefaultRbacPolicy } from './application/default-rbac.policy.js';
import { RoleAssignmentService } from './application/role-assignment.service.js';
import { RoleManagementService } from './application/role-management.service.js';
import { NoopAuthorizationEventPublisher } from './domain/events.js';
import {
  ABAC_POLICY,
  AUTHORIZATION_CONTEXT_RESOLVER,
  AUTHORIZATION_EVENT_PUBLISHER,
  PERMISSION_REPOSITORY,
  RBAC_POLICY,
  ROLE_ASSIGNMENT_REPOSITORY,
  ROLE_REPOSITORY,
} from './authorization.tokens.js';

@Module({
  providers: [
    RoleManagementService,
    RoleAssignmentService,
    AuthorizationDecisionService,
    { provide: RBAC_POLICY, useClass: DefaultRbacPolicy },
    { provide: ABAC_POLICY, useClass: DefaultAbacPolicy },
    { provide: AUTHORIZATION_EVENT_PUBLISHER, useClass: NoopAuthorizationEventPublisher },
  ],
  exports: [RoleManagementService, RoleAssignmentService, AuthorizationDecisionService],
})
export class AuthorizationModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: AuthorizationModule };
    }
    return {
      module: AuthorizationModule,
      providers: [
        { provide: ROLE_REPOSITORY, useValue: new PostgresRoleRepository(database) },
        { provide: PERMISSION_REPOSITORY, useValue: new PostgresPermissionRepository(database) },
        {
          provide: ROLE_ASSIGNMENT_REPOSITORY,
          useValue: new PostgresRoleAssignmentRepository(database),
        },
        { provide: AUTHORIZATION_CONTEXT_RESOLVER, useClass: AlsAuthorizationContextResolver },
      ],
    };
  }
}
