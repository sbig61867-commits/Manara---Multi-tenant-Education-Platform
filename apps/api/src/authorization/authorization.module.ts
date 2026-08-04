import { Module } from '@nestjs/common';
import { AuthorizationDecisionService } from './application/authorization-decision.service.js';
import { DefaultAbacPolicy } from './application/default-abac.policy.js';
import { DefaultRbacPolicy } from './application/default-rbac.policy.js';
import { RoleAssignmentService } from './application/role-assignment.service.js';
import { RoleManagementService } from './application/role-management.service.js';
import { NoopAuthorizationEventPublisher } from './domain/events.js';
import {
  ABAC_POLICY,
  AUTHORIZATION_EVENT_PUBLISHER,
  RBAC_POLICY,
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
export class AuthorizationModule {}
