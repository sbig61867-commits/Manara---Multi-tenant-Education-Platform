import assert from 'node:assert/strict';
import test from 'node:test';
import { DefaultAbacPolicy } from '../../src/authorization/application/default-abac.policy.js';
import { DefaultRbacPolicy } from '../../src/authorization/application/default-rbac.policy.js';
import type { AbacCondition } from '../../src/authorization/domain/types.js';
import type { AbacPolicy, RbacPolicy, RbacRequest } from '../../src/authorization/ports/policy.js';
import {
  createAssignment,
  createContext,
  createGrant,
  createResource,
  createRole,
  createSubject,
} from './authorization-helpers.js';

function buildRequest(overrides?: Partial<RbacRequest>): RbacRequest {
  return {
    subject: createSubject(),
    resource: createResource('assessment'),
    action: 'create',
    context: createContext('tenant-1'),
    roles: [createRole({ id: 'role-1' })],
    grants: [createGrant()],
    assignments: [createAssignment()],
    ...overrides,
  };
}

const rbacPolicy: RbacPolicy = new DefaultRbacPolicy();
const abacPolicy: AbacPolicy = new DefaultAbacPolicy();

test('RBAC resolves an exact permission key match for resource type and action', async () => {
  const resolution = await rbacPolicy.resolve(buildRequest());
  assert.ok(resolution);
  assert.equal(resolution?.permissionKey, 'assessment:create');
  assert.equal(resolution?.roleId, 'role-1');
  assert.equal(resolution?.roleName, 'Instructor');
});

test('RBAC returns null when no grant matches the requested action', async () => {
  const resolution = await rbacPolicy.resolve(buildRequest({ action: 'delete' }));
  assert.equal(resolution, null);
});

test('RBAC returns null when no grant matches the requested resource type', async () => {
  const resolution = await rbacPolicy.resolve(buildRequest({ resource: createResource('content') }));
  assert.equal(resolution, null);
});

test('RBAC ignores retired roles', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({ roles: [createRole({ id: 'role-1', status: 'retired' })] }),
  );
  assert.equal(resolution, null);
});

test('RBAC ignores assignments whose role is not loaded', async () => {
  const resolution = await rbacPolicy.resolve(buildRequest({ roles: [] }));
  assert.equal(resolution, null);
});

test('RBAC matches a tenant-scoped assignment for any resource in the tenant', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({ resource: createResource('assessment', { unitId: 'unit-9' }) }),
  );
  assert.equal(resolution?.permissionKey, 'assessment:create');
});

test('RBAC matches a unit-scoped assignment when the resource is in that unit', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'unit', unitId: 'unit-1' } })],
      resource: createResource('assessment', { unitId: 'unit-1' }),
    }),
  );
  assert.equal(resolution?.permissionKey, 'assessment:create');
});

test('RBAC denies a unit-scoped assignment for a resource outside the unit', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'unit', unitId: 'unit-1' } })],
      resource: createResource('assessment', { unitId: 'unit-2' }),
    }),
  );
  assert.equal(resolution, null);
});

test('RBAC matches a program-scoped assignment when the resource is in that program', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'program', programId: 'program-1' } })],
      resource: createResource('assessment', { programId: 'program-1' }),
    }),
  );
  assert.equal(resolution?.permissionKey, 'assessment:create');
});

test('RBAC denies a program-scoped assignment for a resource outside the program', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'program', programId: 'program-1' } })],
      resource: createResource('assessment', { programId: 'program-2' }),
    }),
  );
  assert.equal(resolution, null);
});

test('RBAC matches a group-scoped assignment when the resource is in that group', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'group', groupId: 'group-1' } })],
      resource: createResource('assessment', { groupId: 'group-1' }),
    }),
  );
  assert.equal(resolution?.permissionKey, 'assessment:create');
});

test('RBAC denies a group-scoped assignment for a resource outside the group', async () => {
  const resolution = await rbacPolicy.resolve(
    buildRequest({
      assignments: [createAssignment({ scope: { type: 'group', groupId: 'group-1' } })],
      resource: createResource('assessment', { groupId: 'group-2' }),
    }),
  );
  assert.equal(resolution, null);
});

test('ABAC equals matches equal context attribute values', async () => {
  const condition: AbacCondition = { source: 'context', key: 'feature', operator: 'equals', value: true };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1', { feature: true }), createResource('assessment'));
  assert.equal(satisfied, true);
});

test('ABAC equals rejects unequal context attribute values', async () => {
  const condition: AbacCondition = { source: 'context', key: 'feature', operator: 'equals', value: true };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1', { feature: false }), createResource('assessment'));
  assert.equal(satisfied, false);
});

test('ABAC not_equals matches a differing resource attribute', async () => {
  const condition: AbacCondition = { source: 'resource', key: 'status', operator: 'not_equals', value: 'archived' };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1'), createResource('assessment', { status: 'published' }));
  assert.equal(satisfied, true);
});

test('ABAC present matches an existing attribute', async () => {
  const condition: AbacCondition = { source: 'context', key: 'quota', operator: 'present' };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1', { quota: 10 }), createResource('assessment'));
  assert.equal(satisfied, true);
});

test('ABAC present rejects a missing attribute', async () => {
  const condition: AbacCondition = { source: 'context', key: 'quota', operator: 'present' };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1'), createResource('assessment'));
  assert.equal(satisfied, false);
});

test('ABAC absent matches a missing attribute', async () => {
  const condition: AbacCondition = { source: 'resource', key: 'ownerId', operator: 'absent' };
  const satisfied = await abacPolicy.evaluate(condition, createContext('tenant-1'), createResource('assessment'));
  assert.equal(satisfied, true);
});

test('ABAC evaluation is deterministic', async () => {
  const condition: AbacCondition = { source: 'context', key: 'status', operator: 'equals', value: 'active' };
  const context = createContext('tenant-1', { status: 'active' });
  const resource = createResource('assessment');
  const first = await abacPolicy.evaluate(condition, context, resource);
  const second = await abacPolicy.evaluate(condition, context, resource);
  assert.equal(first, second);
});

test('ABAC evaluation is side-effect free', async () => {
  const condition: AbacCondition = { source: 'context', key: 'status', operator: 'equals', value: 'active' };
  const context = createContext('tenant-1', { status: 'active' });
  const resource = createResource('assessment');
  const contextBefore = structuredClone(context);
  const resourceBefore = structuredClone(resource);
  await abacPolicy.evaluate(condition, context, resource);
  assert.deepEqual(context, contextBefore);
  assert.deepEqual(resource, resourceBefore);
});
