import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleAssignmentService } from '../../src/authorization/application/role-assignment.service.js';
import {
  InvalidAssignmentScopeError,
  MissingTenantContextError,
  RoleAssignmentAlreadyExistsError,
  RoleAssignmentNotFoundError,
  RoleNotFoundError,
  TenantContextMismatchError,
} from '../../src/authorization/domain/errors.js';
import type { RoleAssignmentScope } from '../../src/authorization/domain/types.js';
import {
  createAssignment,
  createRole,
  FakeAuthorizationContextResolver,
  FakeRoleAssignmentRepository,
  FakeRoleRepository,
  RecordingAuthorizationEventPublisher,
  sameScope,
} from './authorization-helpers.js';

const TENANT = 'tenant-1';

function createService(tenantId: string | null = TENANT): {
  service: RoleAssignmentService;
  roles: FakeRoleRepository;
  assignments: FakeRoleAssignmentRepository;
  events: RecordingAuthorizationEventPublisher;
} {
  const roles = new FakeRoleRepository();
  const assignments = new FakeRoleAssignmentRepository();
  const events = new RecordingAuthorizationEventPublisher();
  const service = new RoleAssignmentService(
    roles,
    assignments,
    events,
    new FakeAuthorizationContextResolver(tenantId),
  );
  return { service, roles, assignments, events };
}

test('assigns a tenant-scoped role to a user', async () => {
  const { service, roles, assignments, events } = createService();
  const role = createRole();
  await roles.create(role);
  const assignment = await service.assignRoleToUser({
    userId: 'user-1',
    roleId: role.id,
    scope: { type: 'tenant' },
    createdByUserId: 'user-admin',
  });
  assert.equal(assignment.tenantId, TENANT);
  assert.equal(assignment.userId, 'user-1');
  assert.equal(assignment.roleId, role.id);
  assert.ok(assignments.findById(assignment.id));
  const assigned = events.eventsOfType('authorization.user_role.changed');
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0]?.change, 'assigned');
  assert.equal(assigned[0]?.userId, 'user-1');
});

test('assigns a unit-scoped role with an explicit unit id', async () => {
  const { service, roles } = createService();
  const role = createRole();
  await roles.create(role);
  const assignment = await service.assignRoleToUser({
    userId: 'user-1',
    roleId: role.id,
    scope: { type: 'unit', unitId: 'unit-1' },
  });
  assert.ok(sameScope(assignment.scope, { type: 'unit', unitId: 'unit-1' }));
});

test('assigns a program-scoped role with an explicit program id', async () => {
  const { service, roles } = createService();
  const role = createRole();
  await roles.create(role);
  const assignment = await service.assignRoleToUser({
    userId: 'user-1',
    roleId: role.id,
    scope: { type: 'program', programId: 'program-1' },
  });
  assert.ok(sameScope(assignment.scope, { type: 'program', programId: 'program-1' }));
});

test('rejects a scope without a reference id', async () => {
  const { service, roles } = createService();
  const role = createRole();
  await roles.create(role);
  const missingScope: RoleAssignmentScope = { type: 'unit', unitId: '' };
  await assert.rejects(
    () => service.assignRoleToUser({ userId: 'user-1', roleId: role.id, scope: missingScope }),
    (error: unknown) => error instanceof InvalidAssignmentScopeError,
  );
});

test('rejects assigning a role from another tenant', async () => {
  const { service, roles } = createService();
  const foreignRole = createRole({ tenantId: 'tenant-2' });
  await roles.create(foreignRole);
  await assert.rejects(
    () => service.assignRoleToUser({ userId: 'user-1', roleId: foreignRole.id, scope: { type: 'tenant' } }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('rejects assigning a missing role', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.assignRoleToUser({ userId: 'user-1', roleId: 'missing', scope: { type: 'tenant' } }),
    (error: unknown) => error instanceof RoleNotFoundError,
  );
});

test('rejects a duplicate assignment for the same user, role and scope', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await assignments.create(createAssignment({ roleId: role.id, scope: { type: 'tenant' } }));
  await assert.rejects(
    () => service.assignRoleToUser({ userId: 'user-1', roleId: role.id, scope: { type: 'tenant' } }),
    (error: unknown) => error instanceof RoleAssignmentAlreadyExistsError,
  );
});

test('allows the same role assigned to the same user in a different scope', async () => {
  const { service, roles, assignments } = createService();
  const role = createRole();
  await roles.create(role);
  await assignments.create(createAssignment({ roleId: role.id, scope: { type: 'tenant' } }));
  const assignment = await service.assignRoleToUser({
    userId: 'user-1',
    roleId: role.id,
    scope: { type: 'unit', unitId: 'unit-1' },
  });
  assert.ok(sameScope(assignment.scope, { type: 'unit', unitId: 'unit-1' }));
});

test('fails closed when assigning without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.assignRoleToUser({ userId: 'user-1', roleId: 'role-1', scope: { type: 'tenant' } }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('revokes a role assignment immediately', async () => {
  const { service, roles, assignments, events } = createService();
  const role = createRole();
  await roles.create(role);
  const assignment = createAssignment({ roleId: role.id });
  await assignments.create(assignment);
  await service.revokeRoleFromUser({ assignmentId: assignment.id });
  assert.equal(await assignments.findById(assignment.id), null);
  const revoked = events.eventsOfType('authorization.user_role.changed');
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0]?.change, 'revoked');
  assert.equal(revoked[0]?.roleId, role.id);
});

test('rejects revoking a missing assignment', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.revokeRoleFromUser({ assignmentId: 'missing' }),
    (error: unknown) => error instanceof RoleAssignmentNotFoundError,
  );
});

test('rejects revoking an assignment from another tenant', async () => {
  const { service, assignments } = createService();
  const assignment = createAssignment({ tenantId: 'tenant-2' });
  await assignments.create(assignment);
  await assert.rejects(
    () => service.revokeRoleFromUser({ assignmentId: assignment.id }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('fails closed when revoking without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.revokeRoleFromUser({ assignmentId: 'assignment-1' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});
