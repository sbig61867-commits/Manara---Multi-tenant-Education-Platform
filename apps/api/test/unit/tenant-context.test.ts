import assert from 'node:assert/strict';
import test from 'node:test';
import { MissingTenantContextError, TenantContextMismatchError } from '../../src/tenant/domain/errors.js';
import { assertSameTenant, requireTenantContext } from '../../src/tenant/ports/tenant-context.js';
import { FakeTenantContextResolver } from './tenant-helpers.js';

test('requireTenantContext returns the resolved tenant id', () => {
  const tenantId = requireTenantContext(new FakeTenantContextResolver('institution-1'));
  assert.equal(tenantId, 'institution-1');
});

test('requireTenantContext fails closed when the resolver returns null', () => {
  assert.throws(
    () => requireTenantContext(new FakeTenantContextResolver(null)),
    (error: unknown) => error instanceof MissingTenantContextError && error.code === 'tenant.context_missing',
  );
});

test('requireTenantContext fails closed on an empty tenant id', () => {
  assert.throws(
    () => requireTenantContext(new FakeTenantContextResolver('')),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('assertSameTenant accepts a matching tenant', () => {
  assert.doesNotThrow(() => assertSameTenant('institution-1', 'institution-1'));
});

test('assertSameTenant rejects a mismatched tenant', () => {
  assert.throws(
    () => assertSameTenant('institution-1', 'institution-2'),
    (error: unknown) => error instanceof TenantContextMismatchError && error.code === 'tenant.context_mismatch',
  );
});
