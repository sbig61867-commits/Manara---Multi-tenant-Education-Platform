import { Inject, Injectable } from '@nestjs/common';
import type {
  AbacCondition,
  AttributeValue,
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationDenyReason,
  AuthorizationResource,
  AuthorizationSubject,
} from '../domain/types.js';
import type { AuthorizationContextResolver } from '../ports/authorization-context.js';
import { assertNoClientTenantIdentity, assertSameTenant, requireTenantContext } from '../ports/authorization-context.js';
import type { AbacPolicy, RbacPolicy } from '../ports/policy.js';
import type { RoleAssignmentRepository } from '../ports/role-assignment.repository.js';
import type { RoleRepository } from '../ports/role.repository.js';
import {
  ABAC_POLICY,
  AUTHORIZATION_CONTEXT_RESOLVER,
  RBAC_POLICY,
  ROLE_ASSIGNMENT_REPOSITORY,
  ROLE_REPOSITORY,
} from '../authorization.tokens.js';

export interface EvaluateCommand {
  subject: AuthorizationSubject;
  resource: AuthorizationResource;
  action: string;
  attributes?: Readonly<Record<string, AttributeValue>>;
  abacCondition?: AbacCondition | null;
}

export type PermissionCheckCommand = EvaluateCommand;

export interface PermissionsCheckCommand extends Omit<EvaluateCommand, 'action'> {
  actions: readonly string[];
}

@Injectable()
export class AuthorizationDecisionService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: RoleAssignmentRepository,
    @Inject(RBAC_POLICY) private readonly rbacPolicy: RbacPolicy,
    @Inject(ABAC_POLICY) private readonly abacPolicy: AbacPolicy,
    @Inject(AUTHORIZATION_CONTEXT_RESOLVER)
    private readonly contextResolver: AuthorizationContextResolver,
  ) {}

  async evaluate(command: EvaluateCommand): Promise<AuthorizationDecision> {
    const tenantId = requireTenantContext(this.contextResolver);
    const attributes = command.attributes ?? {};
    assertNoClientTenantIdentity(attributes);
    const context: AuthorizationContext = { tenantId, attributes };
    const assignments = await this.assignments.listByUserAndTenant(command.subject.userId, tenantId);
    if (assignments.length === 0) {
      return this.deny('denied_no_permission');
    }
    const roleIds = [...new Set(assignments.map((assignment) => assignment.roleId))];
    const roles = await this.roles.listByIds(roleIds);
    for (const role of roles) {
      assertSameTenant(role.tenantId, tenantId);
    }
    const grants = await this.roles.listGrantsByRoleIds(roleIds);
    const resolution = await this.rbacPolicy.resolve({
      subject: command.subject,
      resource: command.resource,
      action: command.action,
      context,
      roles,
      grants,
      assignments,
    });
    if (resolution === null) {
      return this.deny('denied_no_permission');
    }
    if (command.abacCondition !== null && command.abacCondition !== undefined) {
      const satisfied = await this.abacPolicy.evaluate(command.abacCondition, context, command.resource);
      if (!satisfied) {
        return this.deny('denied_abac_condition_failed');
      }
    }
    return {
      allowed: true,
      reason: 'allowed',
      matchedPermissionKey: resolution.permissionKey,
      matchedRoleId: resolution.roleId,
      scope: resolution.scope,
    };
  }

  async checkPermission(command: PermissionCheckCommand): Promise<boolean> {
    return (await this.evaluate(command)).allowed;
  }

  async checkPermissions(command: PermissionsCheckCommand): Promise<boolean> {
    const decisions = await Promise.all(
      command.actions.map((action) =>
        this.evaluate({ ...command, action, subject: command.subject, resource: command.resource }),
      ),
    );
    return decisions.every((decision) => decision.allowed);
  }

  private deny(reason: AuthorizationDenyReason): AuthorizationDecision {
    return { allowed: false, reason, matchedPermissionKey: null, matchedRoleId: null, scope: null };
  }
}
