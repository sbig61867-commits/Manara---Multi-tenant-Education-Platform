import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { MigrationRunner, type PostgresDatabase } from '@manara/database';
import { AlsAuthorizationContextResolver } from '../../src/authorization/adapters/als-authorization-context.resolver.js';
import { PostgresPermissionRepository } from '../../src/authorization/adapters/postgres-permission.repository.js';
import { PostgresRoleAssignmentRepository } from '../../src/authorization/adapters/postgres-role-assignment.repository.js';
import { PostgresRoleRepository } from '../../src/authorization/adapters/postgres-role.repository.js';
import { AuthorizationDecisionService } from '../../src/authorization/application/authorization-decision.service.js';
import { DefaultAbacPolicy } from '../../src/authorization/application/default-abac.policy.js';
import { DefaultRbacPolicy } from '../../src/authorization/application/default-rbac.policy.js';
import { RoleAssignmentService } from '../../src/authorization/application/role-assignment.service.js';
import { RoleManagementService } from '../../src/authorization/application/role-management.service.js';
import {
  RoleNameAlreadyExistsError,
  TenantContextMismatchError,
} from '../../src/authorization/domain/errors.js';
import { NoopAuthorizationEventPublisher } from '../../src/authorization/domain/events.js';
import type { AbacCondition } from '../../src/authorization/domain/types.js';
import { createTestDatabase, getTestDatabaseUrl, MIGRATIONS_DIR } from './helpers.js';

const skip = getTestDatabaseUrl() === null ? 'DATABASE_URL is not set; skipping integration tests' : false;

function isPgErrorCode(error: unknown, code: string): boolean {
  return (error as { code?: string }).code === code;
}

describe('authorization persistence (integration)', { skip }, () => {
  let database: PostgresDatabase | undefined;
  let tenantA = '';
  let tenantB = '';
  let userA = '';
  let userB = '';
  let userC = '';
  let permissionCreateId = '';
  let permissionDeleteId = '';

  before(async () => {
    database = createTestDatabase();
    const runner = new MigrationRunner(database, { migrationsDir: MIGRATIONS_DIR });
    await runner.runMigrations();
    await database.query('TRUNCATE TABLE roles, permissions, role_permissions, role_assignments CASCADE');
    tenantA = randomUUID();
    tenantB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    userC = randomUUID();
    permissionCreateId = randomUUID();
    permissionDeleteId = randomUUID();
    await database.query(
      'INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [userA, 'auth-user-a@test.local', userB, 'auth-user-b@test.local', userC, 'auth-user-c@test.local'],
    );
    await database.query(
      'INSERT INTO institutions (id, name, type, status, created_by_user_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        tenantA,
        'Authorization University A',
        'university',
        'active',
        userA,
        tenantB,
        'Authorization University B',
        'university',
        'active',
        userB,
      ],
    );
    await database.query(
      'INSERT INTO permissions (id, key, module, description, status) VALUES ($1, $2, $3, NULL, $4), ($5, $6, $7, NULL, $8)',
      [
        permissionCreateId,
        'assessment:create',
        'assessment',
        'active',
        permissionDeleteId,
        'assessment:delete',
        'assessment',
        'active',
      ],
    );
  });

  after(async () => {
    if (database) {
      try {
        await database.query('TRUNCATE TABLE roles, permissions, role_permissions, role_assignments CASCADE');
      } finally {
        await database.close();
      }
    }
  });

  function requireDb(): PostgresDatabase {
    if (database === undefined) {
      throw new Error('before hook did not create the database');
    }
    return database;
  }

  function createServices(db: PostgresDatabase): {
    roles: PostgresRoleRepository;
    permissions: PostgresPermissionRepository;
    assignments: PostgresRoleAssignmentRepository;
    context: AlsAuthorizationContextResolver;
    management: RoleManagementService;
    roleAssignment: RoleAssignmentService;
    decisions: AuthorizationDecisionService;
  } {
    const roles = new PostgresRoleRepository(db);
    const permissions = new PostgresPermissionRepository(db);
    const assignments = new PostgresRoleAssignmentRepository(db);
    const context = new AlsAuthorizationContextResolver();
    const events = new NoopAuthorizationEventPublisher();
    const management = new RoleManagementService(roles, permissions, events, context);
    const roleAssignment = new RoleAssignmentService(roles, assignments, events, context);
    const decisions = new AuthorizationDecisionService(
      roles,
      assignments,
      new DefaultRbacPolicy(),
      new DefaultAbacPolicy(),
      context,
    );
    return { roles, permissions, assignments, context, management, roleAssignment, decisions };
  }

  test('authorization migration creates the expected tables', async () => {
    const db = requireDb();
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('roles', 'permissions', 'role_permissions', 'role_assignments')`,
    );
    const names = result.rows.map((row) => row.table_name).sort();
    assert.deepEqual(names, ['permissions', 'role_assignments', 'role_permissions', 'roles']);
  });

  test('tenant-scoped indexes lead with tenant_id and uniqueness constraints exist', async () => {
    const db = requireDb();
    const rolesIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'roles'`,
    );
    const nameIndex = rolesIndexes.rows.find((row) => row.indexname === 'roles_tenant_id_name_key');
    assert.ok(nameIndex);
    assert.match(nameIndex.indexdef, /UNIQUE INDEX/);
    assert.match(nameIndex.indexdef, /USING btree \(tenant_id, name\)/);

    const assignmentIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'role_assignments'`,
    );
    const userIndex = assignmentIndexes.rows.find(
      (row) => row.indexname === 'role_assignments_tenant_id_user_id_idx',
    );
    assert.ok(userIndex);
    assert.match(userIndex.indexdef, /USING btree \(tenant_id, user_id\)/);
    const roleIndex = assignmentIndexes.rows.find(
      (row) => row.indexname === 'role_assignments_tenant_id_role_id_idx',
    );
    assert.ok(roleIndex);
    assert.match(roleIndex.indexdef, /USING btree \(tenant_id, role_id\)/);

    const grantIndexes = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'role_permissions'`,
    );
    const tenantGrantIndex = grantIndexes.rows.find(
      (row) => row.indexname === 'role_permissions_tenant_id_role_id_idx',
    );
    assert.ok(tenantGrantIndex);
    assert.match(tenantGrantIndex.indexdef, /USING btree \(tenant_id, role_id\)/);

    const permissionKey = await db.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND table_name = 'permissions' AND constraint_type = 'UNIQUE'`,
    );
    assert.ok(permissionKey.rows.some((row) => row.constraint_name === 'permissions_key_key'));
  });

  test('a role created through the service persists and is readable', async () => {
    const db = requireDb();
    const { roles, management } = createServices(db);
    const created = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.createRole({ name: 'Instructor', description: 'Can teach' }),
    );
    assert.equal(created.tenantId, tenantA);
    const read = await roles.findById(created.id);
    assert.ok(read);
    assert.equal(read?.name, 'Instructor');
    assert.equal(read?.description, 'Can teach');
    assert.equal(read?.status, 'active');
    const listed = await roles.listByTenant(tenantA);
    assert.ok(listed.some((role) => role.id === created.id));
  });

  test('tenant role names are unique per tenant', async () => {
    const db = requireDb();
    const { management } = createServices(db);
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'Administrator' }));
    await assert.rejects(
      () => AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'Administrator' })),
      (error: unknown) => error instanceof RoleNameAlreadyExistsError,
    );
  });

  test('the same role name is allowed in a different tenant', async () => {
    const db = requireDb();
    const { management } = createServices(db);
    const roleA = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'Teacher' }));
    const roleB = await AlsAuthorizationContextResolver.runWithTenant(tenantB, () => management.createRole({ name: 'Teacher' }));
    assert.equal(roleA.tenantId, tenantA);
    assert.equal(roleB.tenantId, tenantB);
  });

  test('duplicate tenant role names are rejected at the database level', async () => {
    const db = requireDb();
    const { roles } = createServices(db);
    const roleName = `UniqueName-${randomUUID()}`;
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roles.create({
        id: randomUUID(),
        tenantId: tenantA,
        name: roleName,
        description: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await assert.rejects(
      () =>
        roles.create({
          id: randomUUID(),
          tenantId: tenantA,
          name: roleName,
          description: null,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      (error: unknown) => isPgErrorCode(error, '23505'),
    );
  });

  test('role updates persist through the repository', async () => {
    const db = requireDb();
    const { roles } = createServices(db);
    const roleId = randomUUID();
    const roleName = `Updatable-${randomUUID()}`;
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roles.create({
        id: roleId,
        tenantId: tenantA,
        name: roleName,
        description: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await roles.update({
      id: roleId,
      tenantId: tenantA,
      name: roleName,
      description: 'Retired label',
      status: 'retired',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const read = await roles.findById(roleId);
    assert.equal(read?.status, 'retired');
    assert.equal(read?.description, 'Retired label');
  });

  test('permission catalog rows are readable by key', async () => {
    const db = requireDb();
    const { permissions } = createServices(db);
    const permission = await permissions.findByKey('assessment:create');
    assert.ok(permission);
    assert.equal(permission?.module, 'assessment');
    assert.equal(permission?.status, 'active');
    assert.equal(await permissions.findByKey('missing:key'), null);
  });

  test('role-permission grants persist and are listed per role', async () => {
    const db = requireDb();
    const { management, roles } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'Assessor' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    const grants = await roles.listGrantsByRoleIds([role.id]);
    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.permissionKey, 'assessment:create');
    assert.equal(grants[0]?.roleId, role.id);
  });

  test('duplicate role-permission grants are rejected at the database level', async () => {
    const db = requireDb();
    const { roles } = createServices(db);
    const roleId = randomUUID();
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roles.create({
        id: roleId,
        tenantId: tenantA,
        name: `Granted-${randomUUID()}`,
        description: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await roles.grantPermission({
      roleId,
      permissionId: permissionCreateId,
      permissionKey: 'assessment:create',
      grantedAt: new Date(),
    });
    await assert.rejects(
      () =>
        roles.grantPermission({
          roleId,
          permissionId: permissionCreateId,
          permissionKey: 'assessment:create',
          grantedAt: new Date(),
        }),
      (error: unknown) => isPgErrorCode(error, '23505'),
    );
  });

  test('permission revocation persists', async () => {
    const db = requireDb();
    const { management, roles } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'ExAssessor' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.removePermissionFromRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    const grants = await roles.listGrantsByRoleIds([role.id]);
    assert.equal(grants.length, 0);
  });

  test('role assignments persist and are listed by user and tenant', async () => {
    const db = requireDb();
    const { roleAssignment, assignments, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'EnrolmentAdmin' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userA,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const listed = await assignments.listByUserAndTenant(userA, tenantA);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.roleId, role.id);
    assert.equal(listed[0]?.tenantId, tenantA);
    const otherTenant = await assignments.listByUserAndTenant(userA, tenantB);
    assert.equal(otherTenant.length, 0);
  });

  test('assigning another tenant role is rejected', async () => {
    const db = requireDb();
    const { roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'InternalOnly' }));
    await assert.rejects(
      () =>
        AlsAuthorizationContextResolver.runWithTenant(tenantB, () =>
          roleAssignment.assignRoleToUser({
            userId: userC,
            roleId: role.id,
            scope: { type: 'tenant' },
          }),
        ),
      (error: unknown) => error instanceof TenantContextMismatchError,
    );
  });

  test('revoking an assignment persists', async () => {
    const db = requireDb();
    const { roleAssignment, assignments, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'TempRole' }));
    const assignment = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => roleAssignment.revokeRoleFromUser({ assignmentId: assignment.id }));
    const listed = await assignments.listByUserAndTenant(userC, tenantA);
    assert.equal(listed.length, 0);
  });

  test('unit-scoped assignments persist with their scope', async () => {
    const db = requireDb();
    const { roleAssignment, assignments, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'UnitCoordinator' }));
    const unitId = randomUUID();
    const assignment = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'unit', unitId },
      }),
    );
    const read = await assignments.findById(assignment.id);
    assert.equal(read?.scope.type, 'unit');
    assert.equal(read?.scope.type === 'unit' ? read.scope.unitId : null, unitId);
  });

  test('role assignment scope check rejects multiple scope columns', async () => {
    const db = requireDb();
    const { roles } = createServices(db);
    const roleId = randomUUID();
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roles.create({
        id: roleId,
        tenantId: tenantA,
        name: `Scoped-${randomUUID()}`,
        description: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO role_assignments (id, tenant_id, role_id, user_id, scope_type, scope_unit_id, scope_program_id)
           VALUES ($1, $2, $3, $4, 'unit', $5, $5)`,
          [randomUUID(), tenantA, roleId, userC, randomUUID()],
        ),
      (error: unknown) => isPgErrorCode(error, '23514'),
    );
  });

  test('role and grant reads work after a decision is evaluated', async () => {
    const db = requireDb();
    const { decisions, roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'AssessmentManager' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const decision = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.evaluate({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: {} },
        action: 'create',
      }),
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.matchedPermissionKey, 'assessment:create');
    assert.equal(decision.matchedRoleId, role.id);
    assert.equal(decision.scope?.type, 'tenant');
  });

  test('a user without any assignment is denied by default', async () => {
    const db = requireDb();
    const { decisions } = createServices(db);
    const decision = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.evaluate({
        subject: { userId: userA },
        resource: { type: 'assessment', attributes: {} },
        action: 'delete',
      }),
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'denied_no_permission');
  });

  test('an assigned role without the requested permission is denied', async () => {
    const db = requireDb();
    const { decisions, roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'ReadOnly' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const decision = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.evaluate({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: {} },
        action: 'delete',
      }),
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'denied_no_permission');
  });

  test('an unsatisfied abac condition denies the decision', async () => {
    const db = requireDb();
    const { decisions, roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'AdvancedOnly' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const condition: AbacCondition = {
      source: 'resource',
      key: 'level',
      operator: 'equals',
      value: 'advanced',
    };
    const decision = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.evaluate({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: { level: 'basic' } },
        action: 'create',
        abacCondition: condition,
      }),
    );
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'denied_abac_condition_failed');
  });

  test('a satisfied abac condition allows the decision', async () => {
    const db = requireDb();
    const { decisions, roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'AdvancedOnly2' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const condition: AbacCondition = {
      source: 'resource',
      key: 'level',
      operator: 'equals',
      value: 'advanced',
    };
    const decision = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.evaluate({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: { level: 'advanced' } },
        action: 'create',
        abacCondition: condition,
      }),
    );
    assert.equal(decision.allowed, true);
  });

  test('checkPermission and checkPermissions work against real adapters', async () => {
    const db = requireDb();
    const { decisions, roleAssignment, management } = createServices(db);
    const role = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () => management.createRole({ name: 'MultiPermission' }));
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:create' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      management.assignPermissionToRole({ roleId: role.id, permissionKey: 'assessment:delete' }),
    );
    await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      roleAssignment.assignRoleToUser({
        userId: userC,
        roleId: role.id,
        scope: { type: 'tenant' },
        createdByUserId: userB,
      }),
    );
    const single = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.checkPermission({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: {} },
        action: 'create',
      }),
    );
    assert.equal(single, true);
    const both = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.checkPermissions({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: {} },
        actions: ['create', 'delete'],
      }),
    );
    assert.equal(both, true);
    const missing = await AlsAuthorizationContextResolver.runWithTenant(tenantA, () =>
      decisions.checkPermissions({
        subject: { userId: userC },
        resource: { type: 'assessment', attributes: {} },
        actions: ['create', 'delete', 'grade'],
      }),
    );
    assert.equal(missing, false);
  });
});

