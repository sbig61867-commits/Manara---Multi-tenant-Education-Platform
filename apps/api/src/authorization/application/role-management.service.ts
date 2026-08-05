import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { encodeCursor } from '../../tenant/pagination.js';
import {
  PermissionAlreadyGrantedError,
  PermissionNotGrantedError,
  PermissionNotFoundError,
  RoleNameAlreadyExistsError,
  RoleNotFoundError,
} from '../domain/errors.js';
import type { AuthorizationEventPublisher } from '../domain/events.js';
import type { Permission, Role, RolePermissionGrant } from '../domain/types.js';
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

export interface UpdateRoleCommand {
  roleId: string;
  name?: string;
  description?: string | null;
}

export interface RolePermissionCommand {
  roleId: string;
  permissionKey: string;
}

export interface ListRolesCommand {
  limit: number;
  cursor: string | null;
}

export interface ListRolePermissionsCommand {
  roleId: string;
  limit: number;
  cursor: string | null;
}

export interface ListPermissionsCommand {
  limit: number;
  cursor: string | null;
  module?: string | null;
}

export interface RoleListResult {
  items: Role[];
  nextCursor: string | null;
}

export interface RolePermissionListResult {
  items: RolePermissionGrant[];
  nextCursor: string | null;
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

  async getRole(roleId: string): Promise<Role> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(roleId);
    assertSameTenant(role.tenantId, tenantId);
    return role;
  }

  async listRoles(command: ListRolesCommand): Promise<RoleListResult> {
    const tenantId = requireTenantContext(this.contextResolver);
    const rows = await this.roles.listByTenantPage(tenantId, { limit: command.limit + 1, cursor: command.cursor });
    const items = rows.slice(0, command.limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > command.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  async updateRole(command: UpdateRoleCommand): Promise<Role> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(command.roleId);
    assertSameTenant(role.tenantId, tenantId);
    if (command.name !== undefined && command.name !== role.name) {
      const existing = await this.roles.findByNameAndTenant(command.name, tenantId);
      if (existing !== null) {
        throw new RoleNameAlreadyExistsError(`A role named ${command.name} already exists in this tenant`);
      }
    }
    const now = new Date();
    const updated: Role = {
      ...role,
      name: command.name ?? role.name,
      description: command.description !== undefined ? command.description : role.description,
      updatedAt: now,
    };
    await this.roles.update(updated);
    await this.events.publish({
      type: 'authorization.role.changed',
      occurredAt: now,
      roleId: updated.id,
      tenantId,
      change: 'updated',
    });
    return updated;
  }

  async retireRole(roleId: string): Promise<Role> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(roleId);
    assertSameTenant(role.tenantId, tenantId);
    if (role.status === 'retired') {
      return role;
    }
    const now = new Date();
    const retired: Role = { ...role, status: 'retired', updatedAt: now };
    await this.roles.update(retired);
    await this.events.publish({
      type: 'authorization.role.changed',
      occurredAt: now,
      roleId: retired.id,
      tenantId,
      change: 'retired',
    });
    return retired;
  }

  async listRolePermissions(command: ListRolePermissionsCommand): Promise<RolePermissionListResult> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(command.roleId);
    assertSameTenant(role.tenantId, tenantId);
    const rows = await this.roles.listGrantsByRolePage(role.id, { limit: command.limit + 1, cursor: command.cursor });
    const items = rows.slice(0, command.limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > command.limit && last !== undefined ? encodeCursor(last.grantedAt, last.permissionId) : null;
    return { items, nextCursor };
  }

  /** Returns every permission key granted to the role (used for escalation checks). */
  async listRolePermissionKeys(roleId: string): Promise<string[]> {
    const tenantId = requireTenantContext(this.contextResolver);
    const role = await this.requireRole(roleId);
    assertSameTenant(role.tenantId, tenantId);
    const grants = await this.roles.listGrantsByRoleIds([role.id]);
    return grants.map((grant) => grant.permissionKey);
  }

  async listPermissions(command: ListPermissionsCommand): Promise<{ items: Permission[]; nextCursor: string | null }> {
    const rows = await this.permissions.list({ limit: command.limit + 1, cursor: command.cursor, module: command.module });
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
}
