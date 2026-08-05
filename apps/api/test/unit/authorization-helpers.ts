import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { decodeCursor } from '../../src/tenant/pagination.js';
import type { AuthorizationEvent, AuthorizationEventPublisher } from '../../src/authorization/domain/events.js';
import type {
  AuthorizationContext,
  AuthorizationResource,
  AuthorizationSubject,
  Permission,
  Role,
  RoleAssignment,
  RoleAssignmentScope,
  RolePermissionGrant,
} from '../../src/authorization/domain/types.js';
import type { AuthorizationContextResolver } from '../../src/authorization/ports/authorization-context.js';
import type { PermissionRepository } from '../../src/authorization/ports/permission.repository.js';
import type { RoleAssignmentRepository } from '../../src/authorization/ports/role-assignment.repository.js';
import type { RoleRepository } from '../../src/authorization/ports/role.repository.js';

export class FakeRoleRepository implements RoleRepository {
  readonly roles = new Map<string, Role>();
  readonly grants = new Map<string, RolePermissionGrant>();

  async create(role: Role): Promise<void> {
    this.roles.set(role.id, role);
  }

  async findById(id: string): Promise<Role | null> {
    return this.roles.get(id) ?? null;
  }

  async findByNameAndTenant(name: string, tenantId: string): Promise<Role | null> {
    for (const role of this.roles.values()) {
      if (role.name === name && role.tenantId === tenantId) {
        return role;
      }
    }
    return null;
  }

  async listByIds(ids: readonly string[]): Promise<Role[]> {
    return ids.map((id) => this.roles.get(id)).filter((role) => role !== undefined);
  }

  async listByTenant(tenantId: string): Promise<Role[]> {
    return [...this.roles.values()].filter((role) => role.tenantId === tenantId);
  }

  async listByTenantPage(tenantId: string, options: { limit: number; cursor: string | null }): Promise<Role[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.roles.values()]
      .filter((role) => role.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (role) =>
              role.createdAt.getTime() < cursor.createdAt.getTime() ||
              (role.createdAt.getTime() === cursor.createdAt.getTime() && role.id < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }

  async update(role: Role): Promise<void> {
    this.roles.set(role.id, role);
  }

  async grantPermission(grant: RolePermissionGrant): Promise<void> {
    this.grants.set(`${grant.roleId}:${grant.permissionId}`, grant);
  }

  async revokePermission(roleId: string, permissionId: string): Promise<void> {
    this.grants.delete(`${roleId}:${permissionId}`);
  }

  async listGrantsByRoleIds(roleIds: readonly string[]): Promise<RolePermissionGrant[]> {
    const wanted = new Set(roleIds);
    return [...this.grants.values()].filter((grant) => wanted.has(grant.roleId));
  }

  async listGrantsByRolePage(roleId: string, options: { limit: number; cursor: string | null }): Promise<RolePermissionGrant[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.grants.values()]
      .filter((grant) => grant.roleId === roleId)
      .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime() || (a.permissionId < b.permissionId ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (grant) =>
              grant.grantedAt.getTime() < cursor.createdAt.getTime() ||
              (grant.grantedAt.getTime() === cursor.createdAt.getTime() && grant.permissionId < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }
}

export class FakePermissionRepository implements PermissionRepository {
  readonly permissions = new Map<string, Permission>();

  async findByKey(key: string): Promise<Permission | null> {
    return this.permissions.get(key) ?? null;
  }

  async list(options: { limit: number; cursor: string | null; module?: string | null }): Promise<Permission[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.permissions.values()]
      .filter(
        (permission) =>
          options.module === undefined ||
          options.module === null ||
          options.module === '' ||
          permission.module === options.module,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (permission) =>
              permission.createdAt.getTime() < cursor.createdAt.getTime() ||
              (permission.createdAt.getTime() === cursor.createdAt.getTime() && permission.id < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }
}

export class FakeRoleAssignmentRepository implements RoleAssignmentRepository {
  readonly assignments = new Map<string, RoleAssignment>();

  async create(assignment: RoleAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }

  async findById(id: string): Promise<RoleAssignment | null> {
    return this.assignments.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.assignments.delete(id);
  }

  async listByUserAndTenant(userId: string, tenantId: string): Promise<RoleAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.userId === userId && assignment.tenantId === tenantId,
    );
  }

  async listByTenantPage(tenantId: string, options: { limit: number; cursor: string | null }): Promise<RoleAssignment[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.assignments.values()]
      .filter((assignment) => assignment.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (assignment) =>
              assignment.createdAt.getTime() < cursor.createdAt.getTime() ||
              (assignment.createdAt.getTime() === cursor.createdAt.getTime() && assignment.id < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }
}

export class RecordingAuthorizationEventPublisher implements AuthorizationEventPublisher {
  readonly published: AuthorizationEvent[] = [];

  publish(event: AuthorizationEvent): void {
    this.published.push(event);
  }

  eventsOfType(type: string): AuthorizationEvent[] {
    return this.published.filter((event) => event.type === type);
  }
}

export class FakeAuthorizationContextResolver implements AuthorizationContextResolver {
  private readonly tenantId: string | null;

  constructor(tenantId: string | null) {
    this.tenantId = tenantId;
  }

  resolveTenantId(): string | null {
    return this.tenantId;
  }
}

export function createRole(overrides?: Partial<Role>): Role {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    name: 'Instructor',
    description: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createPermission(overrides?: Partial<Permission>): Permission {
  const now = new Date();
  return {
    id: randomUUID(),
    key: 'assessment:create',
    module: 'assessment',
    description: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createGrant(overrides?: Partial<RolePermissionGrant>): RolePermissionGrant {
  return {
    roleId: 'role-1',
    permissionId: 'permission-1',
    permissionKey: 'assessment:create',
    grantedAt: new Date(),
    ...overrides,
  };
}

export function createAssignment(overrides?: Partial<RoleAssignment>): RoleAssignment {
  return {
    id: randomUUID(),
    tenantId: 'tenant-1',
    roleId: 'role-1',
    userId: 'user-1',
    scope: { type: 'tenant' },
    createdByUserId: 'user-admin',
    createdAt: new Date(),
    ...overrides,
  };
}

export function createSubject(overrides?: Partial<AuthorizationSubject>): AuthorizationSubject {
  return { userId: 'user-1', ...overrides };
}

export function createResource(
  type: string,
  attributes: Record<string, string | number | boolean | null> = {},
): AuthorizationResource {
  return { type, attributes };
}

export function createContext(
  tenantId: string,
  attributes: Record<string, string | number | boolean | null> = {},
): AuthorizationContext {
  return { tenantId, attributes };
}

export function sameScope(a: RoleAssignmentScope, b: RoleAssignmentScope): boolean {
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
