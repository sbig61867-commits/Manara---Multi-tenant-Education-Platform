import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleManagementService } from '../../src/authorization/application/role-management.service.js';
import {
  MissingTenantContextError,
  PermissionAlreadyGrantedError,
  PermissionNotGrantedError,
  PermissionNotFoundError,
  RoleNameAlreadyExistsError,
  RoleNotFoundError,
  TenantContextMismatchError,
} from '../../src/authorization/domain/errors.js';
import {
  createPermission,
  createRole,
  FakeAuthorizationContextResolver,
  FakePermissionRepository,
  FakeRoleRepository,
  RecordingAuthorizationEventPublisher,
} from './authorization-helpers.js';

const TENANT = 'tenant-1';

function createService(tenantId: string | null = TENANT): {
  service: RoleManagementService;
  roles: FakeRoleRepository;
  permissions: FakePermissionRepository;
  events: RecordingAuthorizationEventPublisher;
} {
  const roles = new FakeRoleRepository();
  const permissions = new FakePermissionRepository();
  const events = new RecordingAuthorizationEventPublisher();
  const service = new RoleManagementService(
    roles,
    permissions,
    events,
    new FakeAuthorizationContextResolver(tenantId),
  );
  return { service, roles, permissions, events };
}

test('creates a tenant-scoped role within the current context', async () => {
  const { service, roles } = createService();
  const role = await service.createRole({ name: 'Instructor' });
  assert.equal(role.tenantId, TENANT);
  assert.equal(role.status, 'active');
  assert.equal(role.description, null);
  assert.ok(await roles.findById(role.id));
});

test('creates a role with an optional description', async () => {
  const { service } = createService();
  const role = await service.createRole({ name: 'Instructor', description: 'Can teach' });
  assert.equal(role.description, 'Can teach');
});

test('publishes authorization.role.changed on creation', async () => {
  const { service, events } = createService();
  const role = await service.createRole({ name: 'Instructor' });
  const created = events.eventsOfType('authorization.role.changed');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.roleId, role.id);
  assert.equal(created[0]?.tenantId, TENANT);
  assert.equal(created[0]?.change, 'created');
});

test('rejects a duplicate role name within the same tenant', async () => {
  const { service } = createService();
  await service.createRole({ name: 'Instructor' });
  await assert.rejects(
    () => service.createRole({ name: 'Instructor' }),
    (error: unknown) => error instanceof RoleNameAlreadyExistsError,
  );
});

test('allows the same role name in a different tenant', async () => {
  const { service } = createService(TENANT);
  await service.createRole({ name: 'Instructor' });
  const other = new RoleManagementService(
    new FakeRoleRepository(),
    new FakePermissionRepository(),
    new RecordingAuthorizationEventPublisher(),
    new FakeAuthorizationContextResolver('tenant-2'),
  );
  const role = await other.createRole({ name: 'Instructor' });
  assert.equal(role.tenantId, 'tenant-2');
});

test('fails closed when creating a role without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.createRole({ name: 'Instructor' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('assigns an active permission to a tenant role', async () => {
  const { service, roles, permissions, events } = createService();
  const role = createRole();
  const permission = createPermission({ key: 'assessment:create' });
  await roles.create(role);
  await permissions.permissions.set('assessment:create', permission);
  const grant = await service.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' });
  assert.equal(grant.roleId, role.id);
  assert.equal(grant.permissionKey, 'assessment:create');
  const granted = events.eventsOfType('authorization.permission_grant.changed');
  assert.equal(granted.length, 1);
  assert.equal(granted[0]?.change, 'granted');
});

test('rejects assigning a permission to a missing role', async () => {
  const { service } = createService();
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: 'missing', permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof RoleNotFoundError,
  );
});

test('rejects assigning a permission to a role of another tenant', async () => {
  const { service, roles } = createService();
  const foreignRole = createRole({ tenantId: 'tenant-2' });
  await roles.create(foreignRole);
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: foreignRole.id, permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('rejects assigning an unknown permission', async () => {
  const { service, roles } = createService();
  const role = createRole();
  await roles.create(role);
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: role.id, permissionKey: 'unknown:key' }),
    (error: unknown) => error instanceof PermissionNotFoundError,
  );
});

test('rejects assigning a permission that is not active', async () => {
  const { service, roles, permissions } = createService();
  const role = createRole();
  await roles.create(role);
  await permissions.permissions.set('assessment:create', createPermission({ key: 'assessment:create', status: 'retired' }));
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof PermissionNotFoundError,
  );
});

test('rejects a duplicate permission grant on the same role', async () => {
  const { service, roles, permissions } = createService();
  const role = createRole();
  await roles.create(role);
  await permissions.permissions.set('assessment:create', createPermission({ key: 'assessment:create' }));
  await service.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' });
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof PermissionAlreadyGrantedError,
  );
});

test('removes a permission from a role and publishes the revocation event', async () => {
  const { service, roles, permissions, events } = createService();
  const role = createRole();
  await roles.create(role);
  await permissions.permissions.set('assessment:create', createPermission({ key: 'assessment:create' }));
  await service.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' });
  await service.removePermissionFromRole({ roleId: role.id, permissionKey: 'assessment:create' });
  assert.equal((await roles.listGrantsByRoleIds([role.id])).length, 0);
  const revoked = events.eventsOfType('authorization.permission_grant.changed');
  assert.equal(revoked.length, 2);
  assert.equal(revoked[1]?.change, 'revoked');
});

test('rejects removing a permission that was never granted', async () => {
  const { service, roles, permissions } = createService();
  const role = createRole();
  await roles.create(role);
  await permissions.permissions.set('assessment:create', createPermission({ key: 'assessment:create' }));
  await assert.rejects(
    () => service.removePermissionFromRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof PermissionNotGrantedError,
  );
});

test('rejects removing an unknown permission', async () => {
  const { service, roles } = createService();
  const role = createRole();
  await roles.create(role);
  await assert.rejects(
    () => service.removePermissionFromRole({ roleId: role.id, permissionKey: 'unknown:key' }),
    (error: unknown) => error instanceof PermissionNotFoundError,
  );
});

test('rejects removing a permission from a role of another tenant', async () => {
  const { service, roles } = createService();
  const foreignRole = createRole({ tenantId: 'tenant-2' });
  await roles.create(foreignRole);
  await assert.rejects(
    () => service.removePermissionFromRole({ roleId: foreignRole.id, permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof TenantContextMismatchError,
  );
});

test('fails closed when assigning a permission without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.assignPermissionToRole({ roleId: 'role-1', permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('fails closed when removing a permission without tenant context', async () => {
  const { service } = createService(null);
  await assert.rejects(
    () => service.removePermissionFromRole({ roleId: 'role-1', permissionKey: 'assessment:create' }),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});
