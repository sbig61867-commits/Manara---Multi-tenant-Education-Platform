import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationDecisionService } from '../../src/authorization/application/authorization-decision.service.js';
import { DefaultAbacPolicy } from '../../src/authorization/application/default-abac.policy.js';
import { DefaultRbacPolicy } from '../../src/authorization/application/default-rbac.policy.js';
import {
  ClientSuppliedTenantIdentityError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/authorization/domain/errors.js';
import type { AbacCondition, AuthorizationResource } from '../../src/authorization/domain/types.js';
import {
  createAssignment,
  createGrant,
  createPermission,
  createResource,
  createRole,
  createSubject,
  FakeAuthorizationContextResolver,
  FakePermissionRepository,
  FakeRoleAssignmentRepository,
  FakeRoleRepository,
  RecordingAuthorizationEventPublisher,
} from './authorization-helpers.js';
import { RoleAssignmentService } from '../../src/authorization/application/role-assignment.service.js';
import { RoleManagementService } from '../../src/authorization/application/role-management.service.js';

const TENANT = 'tenant-1';

function createService(tenantId: string | null = TENANT): {
  service: AuthorizationDecisionService;
  roles: FakeRoleRepository;
  assignments: FakeRoleAssignmentRepository;
  permissions: FakePermissionRepository;
} {
  const roles = new FakeRoleRepository();
  const assignments = new FakeRoleAssignmentRepository();
  const permissions = new FakePermissionRepository();
  const service = new AuthorizationDecisionService(
    roles,
    assignments,
    new DefaultRbacPolicy(),
    new DefaultAbacPolicy(),
    new FakeAuthorizationContextResolver(tenantId),
  );
  return { service, roles, assignments, permissions };
}

async function grantPermission(
  roles: FakeRoleRepository,
  roleId: string,
  permissionKey: string,
  permissionId = permissionKey,
): Promise<void> {
  await roles.grantPermission(
    createGrant({ roleId, permissionId, permissionKey, grantedAt: new Date() }),
  );
}

function assessmentResource(
  attributes: Record<string, string | number | boolean | null> = {},
): AuthorizationResource {
  return createResource('assessment', attributes);
}

test('denies by default when the user has no role assignments', async () => {
  const { service } = createService();
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_no_permission');
  assert.equal(decision.matchedPermissionKey, null);
});

test('denies by default when no assigned role holds the permission', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:delete');
  await assignments.create(createAssignment({ roleId: role.id }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_no_permission');
});

test('allows when an assigned active role holds the permission', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'allowed');
  assert.equal(decision.matchedPermissionKey, 'assessment:create');
  assert.equal(decision.matchedRoleId, role.id);
});

test('denies when the only matching role is retired', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole({ status: 'retired' });
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(decision.allowed, false);
});

test('denies a unit-scoped role outside its unit', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id, scope: { type: 'unit', unitId: 'unit-1' } }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource({ unitId: 'unit-2' }),
    action: 'create',
  });
  assert.equal(decision.allowed, false);
});

test('allows a unit-scoped role within its unit', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id, scope: { type: 'unit', unitId: 'unit-1' } }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource({ unitId: 'unit-1' }),
    action: 'create',
  });
  assert.equal(decision.allowed, true);
});

test('checkPermission returns true when allowed', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const allowed = await service.checkPermission({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(allowed, true);
});

test('checkPermission returns false when denied', async () => {
  const { service } = createService();
  const allowed = await service.checkPermission({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(allowed, false);
});

test('checkPermissions requires every requested permission', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await grantPermission(roles, role.id, 'assessment:delete', 'permission-delete');
  await assignments.create(createAssignment({ roleId: role.id }));
  const all = await service.checkPermissions({
    subject: createSubject(),
    resource: assessmentResource(),
    actions: ['create', 'delete'],
  });
  assert.equal(all, true);
});

test('checkPermissions fails when one requested permission is missing', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const all = await service.checkPermissions({
    subject: createSubject(),
    resource: assessmentResource(),
    actions: ['create', 'delete'],
  });
  assert.equal(all, false);
});

test('allows when the ABAC condition is satisfied by context attributes', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const condition: AbacCondition = { source: 'context', key: 'feature', operator: 'equals', value: true };
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
    attributes: { feature: true },
    abacCondition: condition,
  });
  assert.equal(decision.allowed, true);
});

test('denies when the ABAC condition is not satisfied', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const condition: AbacCondition = { source: 'context', key: 'feature', operator: 'equals', value: true };
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
    attributes: { feature: false },
    abacCondition: condition,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'denied_abac_condition_failed');
});

test('denies when the ABAC condition is not satisfied on resource attributes', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id }));
  const condition: AbacCondition = { source: 'resource', key: 'status', operator: 'equals', value: 'published' };
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource({ status: 'draft' }),
    action: 'create',
    abacCondition: condition,
  });
  assert.equal(decision.allowed, false);
});

test('fails closed when tenant context is missing', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () =>
      service.evaluate({
        subject: createSubject(),
        resource: assessmentResource(),
        action: 'create',
      }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('rejects client-supplied tenant identity in attributes', async () => {
  const { service } = createService(TENANT);
  await assert.rejects(
    () =>
      service.evaluate({
        subject: createSubject(),
        resource: assessmentResource(),
        action: 'create',
        attributes: { tenantId: 'tenant-2' },
      }),
    (error: unknown) => error instanceof ClientSuppliedTenantIdentityError,
  );
});

test('resolves the tenant from context and never from attributes', async () => {
  const { service, roles, assignments } = createService(TENANT);
  const role = createRole({ tenantId: TENANT });
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: role.id, tenantId: TENANT }));
  const decision = await service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
    attributes: { feature: true },
  });
  assert.equal(decision.allowed, true);
});

test('rejects role data from another tenant during evaluation', async () => {
  const { service, roles, assignments } = createService(TENANT);
  const foreignRole = createRole({ tenantId: 'tenant-2' });
  await roles.create(foreignRole);
  await grantPermission(roles, foreignRole.id, 'assessment:create');
  await assignments.create(createAssignment({ roleId: foreignRole.id, tenantId: TENANT }));
  await assert.rejects(
    () =>
      service.evaluate({
        subject: createSubject(),
        resource: assessmentResource(),
        action: 'create',
      }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('revoking a role assignment takes effect immediately', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await grantPermission(roles, role.id, 'assessment:create');
  const assignment = createAssignment({ roleId: role.id });
  await assignments.create(assignment);
  assert.equal(
    await service.checkPermission({ subject: createSubject(), resource: assessmentResource(), action: 'create' }),
    true,
  );
  const events = new RecordingAuthorizationEventPublisher();
  const assignmentService = new RoleAssignmentService(
    roles,
    assignments,
    events,
    new FakeAuthorizationContextResolver(TENANT),
  );
  await assignmentService.revokeRoleFromUser({ assignmentId: assignment.id });
  assert.equal(
    await service.checkPermission({ subject: createSubject(), resource: assessmentResource(), action: 'create' }),
    false,
  );
});

test('removing a permission grant takes effect immediately', async () => {
  const { service, roles, assignments, permissions } = createService();
  const role = createRole();
  await roles.create(role);
  await permissions.permissions.set('assessment:create', createPermission({ key: 'assessment:create' }));
  await assignments.create(createAssignment({ roleId: role.id }));
  const events = new RecordingAuthorizationEventPublisher();
  const managementService = new RoleManagementService(
    roles,
    permissions,
    events,
    new FakeAuthorizationContextResolver(TENANT),
  );
  await managementService.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' });
  assert.equal(
    await service.checkPermission({ subject: createSubject(), resource: assessmentResource(), action: 'create' }),
    true,
  );
  await managementService.removePermissionFromRole({ roleId: role.id, permissionKey: 'assessment:create' });
  assert.equal(
    await service.checkPermission({ subject: createSubject(), resource: assessmentResource(), action: 'create' }),
    false,
  );
});

test('a role in one tenant never grants access in another tenant', async () => {
  const tenantA = createService(TENANT);
  const tenantB = createService('tenant-2');
  const role = createRole({ tenantId: TENANT });
  await tenantA.roles.create(role);
  await grantPermission(tenantA.roles, role.id, 'assessment:create');
  await tenantA.assignments.create(createAssignment({ roleId: role.id, tenantId: TENANT }));
  const decision = await tenantB.service.evaluate({
    subject: createSubject(),
    resource: assessmentResource(),
    action: 'create',
  });
  assert.equal(decision.allowed, false);
});
