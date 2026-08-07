import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PermissionCatalogStartupError,
  verifyPermissionCatalogAtStartup,
} from '../../src/authorization/application/permission-catalog-startup-verifier.js';
import { PLATFORM_PERMISSION_CATALOG } from '../../src/authorization/platform-permission-catalog.js';

const complete = {
  required: 34,
  present: 34,
  missingKeys: [],
  valid: true,
} as const;

test('production startup accepts a complete permission catalog', async () => {
  await verifyPermissionCatalogAtStartup('production', async () => complete);
});

test('staging startup also verifies the permission catalog', async () => {
  let called = false;
  await verifyPermissionCatalogAtStartup('staging', async () => {
    called = true;
    return complete;
  });
  assert.equal(called, true);
});

test('production startup fails safely with sorted missing permission keys', async () => {
  await assert.rejects(
    verifyPermissionCatalogAtStartup('production', async () => ({
      required: 34,
      present: 32,
      missingKeys: ['quota:read', 'audit:list'],
      valid: false,
    })),
    (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.name, 'authorization.permission_catalog_incomplete');
      assert.equal(error.code, 'authorization.permission_catalog_incomplete');
      assert.equal(error.required, 34);
      assert.equal(error.present, 32);
      assert.deepEqual(error.missingKeys, ['audit:list', 'quota:read']);
      return true;
    },
  );
});

test('production startup fails closed when the database is not configured', async () => {
  await assert.rejects(
    verifyPermissionCatalogAtStartup('production', null),
    (error: unknown) => {
      assert.ok(error instanceof PermissionCatalogStartupError);
      assert.equal(error.required, 34);
      assert.equal(error.present, 0);
      assert.deepEqual(error.missingKeys, PLATFORM_PERMISSION_CATALOG.map(({ key }) => key).sort());
      return true;
    },
  );
});

test('development and test lightweight startup skip catalog verification', async () => {
  let calls = 0;
  const verify = async () => {
    calls += 1;
    return complete;
  };
  await verifyPermissionCatalogAtStartup('development', verify);
  await verifyPermissionCatalogAtStartup('test', verify);
  await verifyPermissionCatalogAtStartup('development', null);
  await verifyPermissionCatalogAtStartup('test', null);
  assert.equal(calls, 0);
});

test('database verification errors propagate without being rewritten', async () => {
  const failure = new Error('database unavailable');
  await assert.rejects(
    verifyPermissionCatalogAtStartup('production', async () => Promise.reject(failure)),
    (error: unknown) => error === failure,
  );
});
