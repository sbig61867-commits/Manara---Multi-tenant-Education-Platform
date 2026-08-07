import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionCatalogService } from '../../src/authorization/application/permission-catalog.service.js';
import type { AuthorizationTransactionRunner } from '../../src/authorization/ports/transaction-runner.js';
import {
  AUDIT_PERMISSIONS,
  AUTHORIZATION_PERMISSIONS,
  ENTITLEMENTS_PERMISSIONS,
  PLATFORM_PERMISSION_CATALOG,
  TENANT_MANAGEMENT_PERMISSIONS,
  definePlatformPermissionCatalog,
} from '../../src/authorization/platform-permission-catalog.js';
import { MANAGEMENT_PERMISSIONS as AUTHORIZATION_HTTP_PERMISSIONS } from '../../src/authorizations/authorization.dto.js';
import { AUDIT_PERMISSIONS as AUDIT_HTTP_PERMISSIONS } from '../../src/audit-http/audit.dto.js';
import { MANAGEMENT_PERMISSIONS as ENTITLEMENTS_HTTP_PERMISSIONS } from '../../src/entitlements-http/entitlements.dto.js';
import { MANAGEMENT_PERMISSIONS as TENANT_HTTP_PERMISSIONS } from '../../src/tenants/tenant.dto.js';
import { FakePermissionRepository, createPermission } from './authorization-helpers.js';

const transactions: AuthorizationTransactionRunner = {
  runInTransactionWithAdvisoryLock: async (_lockKey, work) => work(),
};

test('platform permission catalog contains exactly 34 unique keys', () => {
  assert.equal(PLATFORM_PERMISSION_CATALOG.length, 34);
  assert.equal(new Set(PLATFORM_PERMISSION_CATALOG.map((descriptor) => descriptor.key)).size, 34);
});

test('HTTP permission groups preserve their existing public values', () => {
  assert.deepEqual(AUTHORIZATION_HTTP_PERMISSIONS, AUTHORIZATION_PERMISSIONS);
  assert.deepEqual(TENANT_HTTP_PERMISSIONS, TENANT_MANAGEMENT_PERMISSIONS);
  assert.deepEqual(ENTITLEMENTS_HTTP_PERMISSIONS, ENTITLEMENTS_PERMISSIONS);
  assert.deepEqual(AUDIT_HTTP_PERMISSIONS, AUDIT_PERMISSIONS);
  assert.equal(AUTHORIZATION_HTTP_PERMISSIONS.roleCreate, 'role:create');
  assert.equal(TENANT_HTTP_PERMISSIONS.institutionTransition, 'institution:transition');
  assert.equal(ENTITLEMENTS_HTTP_PERMISSIONS.planVersionList, 'plan:versions');
  assert.equal(AUDIT_HTTP_PERMISSIONS.auditPlatform, 'audit:platform');
});

test('duplicate platform permission keys fail catalog validation', () => {
  assert.throws(
    () =>
      definePlatformPermissionCatalog([
        { key: 'duplicate:key', module: 'duplicate', description: 'First.' },
        { key: 'duplicate:key', module: 'duplicate', description: 'Second.' },
      ]),
    /Duplicate platform permission key/,
  );
});

test('catalog verification reports every missing required key', async () => {
  const permissions = new FakePermissionRepository();
  permissions.permissions.set(
    PLATFORM_PERMISSION_CATALOG[0]!.key,
    createPermission({ key: PLATFORM_PERMISSION_CATALOG[0]!.key }),
  );
  const result = await new PermissionCatalogService(permissions, transactions).verifyCatalog();
  assert.equal(result.valid, false);
  assert.equal(result.required, 34);
  assert.equal(result.present, 1);
  assert.equal(result.missingKeys.length, 33);
});

test('permission catalog service exposes no principal or grant operations', () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(PermissionCatalogService.prototype).sort(),
    ['constructor', 'seedCatalog', 'verifyCatalog'],
  );
});
