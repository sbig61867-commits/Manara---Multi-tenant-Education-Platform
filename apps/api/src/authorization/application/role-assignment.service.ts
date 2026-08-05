import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { encodeCursor } from '../../tenant/pagination.js';
import {
  InvalidAssignmentScopeError,
  RoleAssignmentAlreadyExistsError,
  RoleAssignmentNotFoundError,
  RoleNotFoundError,
} from '../domain/errors.js';
import type { AuthorizationEventPublisher } from '../domain/events.js';
import type { Role, RoleAssignment, RoleAssignmentScope } from '../domain/types.js';
import type { AuthorizationContextResolver } from '../ports/authorization-context.js';
import { assertSameTenant, requireTenantContext } from '../ports/authorization-context.js';
import type { RoleAssignmentRepository } from '../ports/role-assignment.repository.js';
import type { RoleRepository } from '../ports/role.repository.js';
import {
  AUTHORIZATION_CONTEXT_RESOLVER,
  AUTHORIZATION_EVENT_PUBLISHER,
  ROLE_ASSIGNMENT_REPOSITORY,
  ROLE_REPOSITORY,
} from '../authorization.tokens.js';

export interface AssignRoleCommand {
  userId: string;
  roleId: string;
  scope: RoleAssignmentScope;
  createdByUserId?: string | null;
}

export interface RevokeRoleCommand {
  assignmentId: string;
}

export interface ListAssignmentsCommand {
  limit: number;
  cursor: string | null;
}

export interface AssignmentListResult {
  items: RoleAssignment[];
  nextCursor: string | null;
}

@Injectable()
export class RoleAssignmentService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(ROLE_ASSIGNMENT_REPOSITORY) private readonly assignments: RoleAssignmentRepository,
    @Inject(AUTHORIZATION_EVENT_PUBLISHER) private readonly events: AuthorizationEventPublisher,
    @Inject(AUTHORIZATION_CONTEXT_RESOLVER)
    private readonly contextResolver: AuthorizationContextResolver,
  ) {}

  async assignRoleToUser(command: AssignRoleCommand): Promise<RoleAssignment> {
    const tenantId = requireTenantContext(this.contextResolver);
    this.assertValidScope(command.scope);
    const role = await this.requireRole(command.roleId);
    assertSameTenant(role.tenantId, tenantId);
    const existing = await this.assignments.listByUserAndTenant(command.userId, tenantId);
    if (existing.some((assignment) => this.sameScope(assignment.scope, command.scope) && assignment.roleId === role.id)) {
      throw new RoleAssignmentAlreadyExistsError('This role is already assigned to the user in this scope');
    }
    const now = new Date();
    const assignment: RoleAssignment = {
      id: randomUUID(),
      tenantId,
      roleId: role.id,
      userId: command.userId,
      scope: command.scope,
      createdByUserId: command.createdByUserId ?? null,
      createdAt: now,
    };
    await this.assignments.create(assignment);
    await this.events.publish({
      type: 'authorization.user_role.changed',
      occurredAt: now,
      roleId: role.id,
      tenantId,
      userId: command.userId,
      change: 'assigned',
    });
    return assignment;
  }

  async revokeRoleFromUser(command: RevokeRoleCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    const assignment = await this.assignments.findById(command.assignmentId);
    if (assignment === null) {
      throw new RoleAssignmentNotFoundError('Role assignment not found');
    }
    assertSameTenant(assignment.tenantId, tenantId);
    await this.assignments.delete(assignment.id);
    await this.events.publish({
      type: 'authorization.user_role.changed',
      occurredAt: new Date(),
      roleId: assignment.roleId,
      tenantId,
      userId: assignment.userId,
      change: 'revoked',
    });
  }

  async listAssignments(command: ListAssignmentsCommand): Promise<AssignmentListResult> {
    const tenantId = requireTenantContext(this.contextResolver);
    const rows = await this.assignments.listByTenantPage(tenantId, { limit: command.limit + 1, cursor: command.cursor });
    const items = rows.slice(0, command.limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > command.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.roles.findById(roleId);
    if (role === null) {
      throw new RoleNotFoundError('Role not found');
    }
    return role;
  }

  private assertValidScope(scope: RoleAssignmentScope): void {
    if (scope.type === 'unit' && (scope.unitId === undefined || scope.unitId === '')) {
      throw new InvalidAssignmentScopeError('A unit-scoped assignment requires a unit id');
    }
    if (scope.type === 'program' && (scope.programId === undefined || scope.programId === '')) {
      throw new InvalidAssignmentScopeError('A program-scoped assignment requires a program id');
    }
    if (scope.type === 'group' && (scope.groupId === undefined || scope.groupId === '')) {
      throw new InvalidAssignmentScopeError('A group-scoped assignment requires a group id');
    }
  }

  private sameScope(a: RoleAssignmentScope, b: RoleAssignmentScope): boolean {
    if (a.type !== b.type) {
      return false;
    }
    switch (a.type) {
      case 'tenant':
        return true;
      case 'unit':
        return b.type === 'unit' && a.unitId === b.unitId;
      case 'program':
        return b.type === 'program' && a.programId === b.programId;
      case 'group':
        return b.type === 'group' && a.groupId === b.groupId;
    }
  }
}
