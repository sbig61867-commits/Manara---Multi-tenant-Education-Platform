import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { RoleManagementService } from '../../src/authorization/application/role-management.service.js';
import type { RoleAssignmentService } from '../../src/authorization/application/role-assignment.service.js';
import type { AuthorizationDecisionService } from '../../src/authorization/application/authorization-decision.service.js';
import type { Permission, Role, RoleAssignment, RolePermissionGrant } from '../../src/authorization/domain/types.js';
import type { RequestContextService } from '../../src/http/request-context.js';
import { AuthorizationController, PermissionCatalogController } from '../../src/authorizations/authorization.controller.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';

function createRole(overrides?: Partial<Role>): Role {
  const now = new Date();
  return {
    id: ROLE_ID,
    tenantId: TENANT_ID,
    name: 'Course Manager',
    description: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createPermission(overrides?: Partial<Permission>): Permission {
  const now = new Date();
  return {
    id: randomUUID(),
    key: 'role:create',
    module: 'role',
    description: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createGrant(overrides?: Partial<RolePermissionGrant>): RolePermissionGrant {
  return {
    roleId: ROLE_ID,
    permissionId: randomUUID(),
    permissionKey: 'role:create',
    grantedAt: new Date(),
    ...overrides,
  };
}

function createAssignment(overrides?: Partial<RoleAssignment>): RoleAssignment {
  return {
    id: randomUUID(),
    tenantId: TENANT_ID,
    roleId: ROLE_ID,
    userId: USER_ID,
    scope: { type: 'tenant' },
    createdByUserId: USER_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

interface Stubs {
  roles?: {
    createRole?: RoleManagementService['createRole'];
    getRole?: RoleManagementService['getRole'];
    updateRole?: RoleManagementService['updateRole'];
    retireRole?: RoleManagementService['retireRole'];
    listRoles?: RoleManagementService['listRoles'];
    listRolePermissions?: RoleManagementService['listRolePermissions'];
    listRolePermissionKeys?: RoleManagementService['listRolePermissionKeys'];
    assignPermissionToRole?: RoleManagementService['assignPermissionToRole'];
    removePermissionFromRole?: RoleManagementService['removePermissionFromRole'];
    listPermissions?: RoleManagementService['listPermissions'];
  };
  assignments?: {
    listAssignments?: RoleAssignmentService['listAssignments'];
    assignRoleToUser?: RoleAssignmentService['assignRoleToUser'];
    revokeRoleFromUser?: RoleAssignmentService['revokeRoleFromUser'];
  };
  decisions?: {
    checkPermission?: AuthorizationDecisionService['checkPermission'];
  };
}

function createControllers(overrides: Stubs = {}): {
  authorization: AuthorizationController;
  catalog: PermissionCatalogController;
  decisionCalls: Array<{ subject: unknown; resource: unknown; action: string }>;
} {
  const decisionCalls: Array<{ subject: unknown; resource: unknown; action: string }> = [];
  const roles = {
    createRole: overrides.roles?.createRole ?? (async (command: { name: string; description: string | null }) => createRole({ name: command.name, description: command.description })),
    getRole: overrides.roles?.getRole ?? (async () => createRole()),
    updateRole: overrides.roles?.updateRole ?? (async () => createRole()),
    retireRole: overrides.roles?.retireRole ?? (async () => createRole({ status: 'retired' })),
    listRoles: overrides.roles?.listRoles ?? (async () => ({ items: [createRole()], nextCursor: null })),
    listRolePermissions: overrides.roles?.listRolePermissions ?? (async () => ({ items: [createGrant()], nextCursor: null })),
    listRolePermissionKeys: overrides.roles?.listRolePermissionKeys ?? (async () => ['role:create']),
    assignPermissionToRole: overrides.roles?.assignPermissionToRole ?? (async () => createGrant()),
    removePermissionFromRole: overrides.roles?.removePermissionFromRole ?? (async () => undefined),
    listPermissions: overrides.roles?.listPermissions ?? (async () => ({ items: [createPermission()], nextCursor: null })),
  } as unknown as RoleManagementService;
  const assignments = {
    listAssignments: overrides.assignments?.listAssignments ?? (async () => ({ items: [createAssignment()], nextCursor: null })),
    assignRoleToUser: overrides.assignments?.assignRoleToUser ?? (async (command: { userId: string; roleId: string; scope: RoleAssignment['scope']; createdByUserId: string }) => createAssignment({ userId: command.userId, roleId: command.roleId, scope: command.scope, createdByUserId: command.createdByUserId })),
    revokeRoleFromUser: overrides.assignments?.revokeRoleFromUser ?? (async () => undefined),
  } as unknown as RoleAssignmentService;
  const decisions = {
    checkPermission:
      overrides.decisions?.checkPermission ??
      (async (request: { subject: unknown; resource: unknown; action: string }) => {
        decisionCalls.push(request);
        return true;
      }),
  } as unknown as AuthorizationDecisionService;
  const requestContext = {
    get: () => ({ authenticatedUserId: USER_ID }),
  } as unknown as RequestContextService;
  return {
    authorization: new AuthorizationController(roles, assignments, decisions, requestContext),
    catalog: new PermissionCatalogController(roles, requestContext),
    decisionCalls,
  };
}

test('listRoles returns the roles page', async () => {
  const { authorization } = createControllers();
  const response = await authorization.listRoles({ tenantId: TENANT_ID }, { limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.name, 'Course Manager');
  assert.equal(response.nextCursor, null);
  assert.ok('tenantId' in response.items[0]!);
});

test('createRole returns the role view', async () => {
  const { authorization } = createControllers();
  const response = await authorization.createRole({ tenantId: TENANT_ID }, { name: 'Instructor', description: 'Teaches' });
  assert.equal(response.role.name, 'Instructor');
  assert.ok('id' in response.role);
});

test('getRole forwards the role id', async () => {
  let requestedId: string | undefined;
  const { authorization } = createControllers({
    roles: {
      getRole: async (roleId) => {
        requestedId = roleId;
        return createRole();
      },
    },
  });
  const response = await authorization.getRole({ tenantId: TENANT_ID, roleId: ROLE_ID });
  assert.equal(requestedId, ROLE_ID);
  assert.equal(response.role.status, 'active');
});

test('updateRole forwards name and description', async () => {
  let received: { roleId: string; name?: string; description?: string | null } | undefined;
  const { authorization } = createControllers({
    roles: {
      updateRole: async (command) => {
        received = command;
        return createRole({ name: command.name ?? 'Course Manager', description: command.description ?? null });
      },
    },
  });
  const response = await authorization.updateRole({ tenantId: TENANT_ID, roleId: ROLE_ID }, { name: 'New Name' });
  assert.deepEqual(received, { roleId: ROLE_ID, name: 'New Name', description: undefined });
  assert.equal(response.role.name, 'New Name');
});

test('retireRole returns the retired role', async () => {
  const { authorization } = createControllers();
  const response = await authorization.retireRole({ tenantId: TENANT_ID, roleId: ROLE_ID });
  assert.equal(response.role.status, 'retired');
});

test('listRolePermissions returns the grants page', async () => {
  const { authorization } = createControllers();
  const response = await authorization.listRolePermissions({ tenantId: TENANT_ID, roleId: ROLE_ID }, { limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.permissionKey, 'role:create');
});

test('grantPermissionToRole requires the caller to hold the granted permission', async () => {
  let granted: { roleId: string; permissionKey: string } | undefined;
  const { authorization, decisionCalls } = createControllers({
    roles: {
      assignPermissionToRole: async (command) => {
        granted = command;
        return createGrant({ permissionKey: command.permissionKey });
      },
    },
  });
  const response = await authorization.grantPermissionToRole({ tenantId: TENANT_ID, roleId: ROLE_ID }, { permissionKey: 'role:create' });
  assert.deepEqual(granted, { roleId: ROLE_ID, permissionKey: 'role:create' });
  assert.equal(response.grant.permissionKey, 'role:create');
  assert.deepEqual(decisionCalls[0], {
    subject: { userId: USER_ID },
    resource: { type: 'role', attributes: {} },
    action: 'create',
  });
});

test('grantPermissionToRole denies 403 when the caller does not hold the permission', async () => {
  const { authorization } = createControllers({
    decisions: {
      checkPermission: async () => false,
    },
  });
  await assert.rejects(
    authorization.grantPermissionToRole({ tenantId: TENANT_ID, roleId: ROLE_ID }, { permissionKey: 'role:create' }),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('revokePermissionFromRole forwards role id and permission key', async () => {
  let revoked: { roleId: string; permissionKey: string } | undefined;
  const { authorization } = createControllers({
    roles: {
      removePermissionFromRole: async (command) => {
        revoked = command;
      },
    },
  });
  await authorization.revokePermissionFromRole({ tenantId: TENANT_ID, roleId: ROLE_ID, permissionKey: 'role:create' });
  assert.deepEqual(revoked, { roleId: ROLE_ID, permissionKey: 'role:create' });
});

test('listRoleAssignments returns the assignments page', async () => {
  const { authorization } = createControllers();
  const response = await authorization.listRoleAssignments({ tenantId: TENANT_ID }, { limit: 20, cursor: null });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.userId, USER_ID);
  assert.deepEqual(response.items[0]?.scope, { type: 'tenant' });
});

test('assignRoleToUser requires the caller to hold every permission the role grants', async () => {
  let assigned: { userId: string; roleId: string; scope: RoleAssignment['scope']; createdByUserId: string } | undefined;
  const { authorization, decisionCalls } = createControllers({
    assignments: {
      assignRoleToUser: async (command) => {
        assigned = command;
        return createAssignment({ userId: command.userId, roleId: command.roleId, scope: command.scope });
      },
    },
  });
  const response = await authorization.assignRoleToUser(
    { tenantId: TENANT_ID },
    { userId: USER_ID, roleId: ROLE_ID, scope: { type: 'tenant' } },
  );
  assert.deepEqual(assigned, { userId: USER_ID, roleId: ROLE_ID, scope: { type: 'tenant' }, createdByUserId: USER_ID });
  assert.equal(response.assignment.scope.type, 'tenant');
  assert.deepEqual(decisionCalls[0], {
    subject: { userId: USER_ID },
    resource: { type: 'role', attributes: {} },
    action: 'create',
  });
});

test('assignRoleToUser denies 403 when the caller does not hold a granted permission', async () => {
  const { authorization } = createControllers({
    roles: {
      listRolePermissionKeys: async () => ['role:create', 'role:retire'],
    },
    decisions: {
      checkPermission: async (request) => request.action !== 'retire',
    },
  });
  await assert.rejects(
    authorization.assignRoleToUser({ tenantId: TENANT_ID }, { userId: USER_ID, roleId: ROLE_ID, scope: { type: 'tenant' } }),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test('revokeRoleAssignment forwards the assignment id', async () => {
  const assignmentId = randomUUID();
  let revoked: string | undefined;
  const { authorization } = createControllers({
    assignments: {
      revokeRoleFromUser: async (command) => {
        revoked = command.assignmentId;
      },
    },
  });
  await authorization.revokeRoleAssignment({ tenantId: TENANT_ID, assignmentId });
  assert.equal(revoked, assignmentId);
});

test('checkPermission returns the decision', async () => {
  const { authorization } = createControllers({
    decisions: {
      checkPermission: async () => true,
    },
  });
  const response = await authorization.checkPermission(
    { tenantId: TENANT_ID },
    { subject: { userId: USER_ID }, permissionKey: 'role:read', resourceType: 'role' },
  );
  assert.equal(response.allowed, true);
});

test('checkPermissions aggregates per-check decisions', async () => {
  const { authorization } = createControllers({
    decisions: {
      checkPermission: async (request) => request.action === 'read',
    },
  });
  const response = await authorization.checkPermissions(
    { tenantId: TENANT_ID },
    {
      subject: { userId: USER_ID },
      checks: [
        { permissionKey: 'role:read', resourceType: 'role' },
        { permissionKey: 'role:create', resourceType: 'role' },
      ],
    },
  );
  assert.equal(response.allowed, false);
  assert.deepEqual(response.results, [
    { permissionKey: 'role:read', allowed: true },
    { permissionKey: 'role:create', allowed: false },
  ]);
});

test('catalog listPermissions returns the permission page', async () => {
  const { catalog } = createControllers();
  const response = await catalog.listPermissions({ limit: 20, cursor: null, module: 'role' });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.key, 'role:create');
});
