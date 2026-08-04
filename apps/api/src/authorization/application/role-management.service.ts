import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PermissionAlreadyGrantedError,
  PermissionNotGrantedError,
  PermissionNotFoundError,
  RoleNameAlreadyExistsError,
  RoleNotFoundError,
} from '../domain/errors.js';
import type { AuthorizationEventPublisher } from '../domain/events.js';
import type { Role, RolePermissionGrant } from '../domain/types.js';
import type { AuthorizationContextResolver } from '../ports/authorization-context.js';
import { assertSameTenant, requireTenantContext } from '../ports/authorization-context.js';
import type { PermissionRepository } from '../ports/permission.repository.js';
import type { RoleRepository } from '../ports/role.repository.js';
import {
  AUTHORIZATION_CONTEXT_RESOLVER,
  AUTHORIZATION_EVENT_PUBLISHER,
  PERMISSION_REPOSITORY,
  ROLE_REPOSITORY,
} from '../authorization.tokens.js';

export interface CreateRoleCommand {
  name: string;
  description?: string | null;
}

export interface RolePermissionCommand {
  roleId: string;
  permissionKey: string;
}

@Injectable()
export class RoleManagementService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository,
    @Inject(AUTHORIZATION_EVENT_PUBLISHER) private readonly events: AuthorizationEventPublisher,
    @Inject(AUTHORIZATION_CONTEXT_RESOLVER)
    private readonly contextResolver: AuthorizationContextResolver,
  ) {}

  async createRole(command: CreateRoleCommand): Promise<Role> {
    const tenantId = requireTenantContext(this.contextResolver);
    const existing = await this.roles.findByNameAndTenant(command.name, tenantId);
    if (existing !== null) {
      throw new RoleNameAlreadyExistsError(`A role named ${command.name} already exists in this tenant`);
    }
    const now = new Date();
    const role: Role = {
      id: randomUUID(),
      tenantId,
      name: command.name,
      description: command.description ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.roles.create(role);
    await this.events.publish({
      type: 'authorization.role.changed',
      occurredAt: now,
      roleId: role.id,
      tenantId,
      change: 'created',
    });
    return role;
  }

  async assignPermissionToRole(command: RolePermissionCommand): Promise<RolePermissionGrant> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(command.roleId);
    assertSameTenant(role.tenantId, tenantId);
    const permission = await this.permissions.findByKey(command.permissionKey);
    if (permission === null || permission.status !== 'active') {
      throw new PermissionNotFoundError('Permission not found or not active');
    }
    const existing = await this.roles.listGrantsByRoleIds([role.id]);
    if (existing.some((grant) => grant.permissionId === permission.id)) {
      throw new PermissionAlreadyGrantedError('Permission is already granted to this role');
    }
    const now = new Date();
    const grant: RolePermissionGrant = {
      roleId: role.id,
      permissionId: permission.id,
      permissionKey: permission.key,
      grantedAt: now,
    };
    await this.roles.grantPermission(grant);
    await this.events.publish({
      type: 'authorization.permission_grant.changed',
      occurredAt: now,
      roleId: role.id,
      tenantId,
      permissionKey: permission.key,
      change: 'granted',
    });
    return grant;
  }

  async removePermissionFromRole(command: RolePermissionCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(command.roleId);
    assertSameTenant(role.tenantId, tenantId);
    const permission = await this.permissions.findByKey(command.permissionKey);
    if (permission === null) {
      throw new PermissionNotFoundError('Permission not found');
    }
    const existing = await this.roles.listGrantsByRoleIds([role.id]);
    if (!existing.some((grant) => grant.permissionId === permission.id)) {
      throw new PermissionNotGrantedError('Permission is not granted to this role');
    }
    await this.roles.revokePermission(role.id, permission.id);
    await this.events.publish({
      type: 'authorization.permission_grant.changed',
      occurredAt: new Date(),
      roleId: role.id,
      tenantId,
      permissionKey: permission.key,
      change: 'revoked',
    });
  }

  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.roles.findById(roleId);
    if (role === null) {
      throw new RoleNotFoundError('Role not found');
    }
    return role;
  }
}
