import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientSuppliedTenantIdentityError,
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/authorization/domain/errors.js';
import {
  assertNoClientTenantIdentity,
  assertSameTenant,
  requireTenantContext,
} from '../../src/authorization/ports/authorization-context.js';
import { FakeAuthorizationContextResolver } from './authorization-helpers.js';

test('requireTenantContext returns the resolved tenant id', () => {
  const tenantId = requireTenantContext(new FakeAuthorizationContextResolver('tenant-1'));
  assert.equal(tenantId, 'tenant-1');
});

test('requireTenantContext fails closed when the resolver returns null', () => {
  assert.throws(
    () => requireTenantContext(new FakeAuthorizationContextResolver(null)),
    (error: unknown) => error instanceof MissingTenantContextError && error.code === 'authorization.context_missing',
  );
});

test('requireTenantContext fails closed on an empty tenant id', () => {
  assert.throws(
    () => requireTenantContext(new FakeAuthorizationContextResolver('')),
    (error: unknown) => error instanceof MissingTenantContextError,
  );
});

test('assertSameTenant accepts a matching tenant', () => {
  assert.doesNotThrow(() => assertSameTenant('tenant-1', 'tenant-1'));
});

test('assertSameTenant rejects a mismatched tenant', () => {
  assert.throws(
    () => assertSameTenant('tenant-1', 'tenant-2'),
    (error: unknown) => error instanceof TenantContextMismatchError && error.code === 'authorization.context_mismatch',
  );
});

test('assertNoClientTenantIdentity rejects tenantId in attributes', () => {
  assert.throws(
    () => assertNoClientTenantIdentity({ tenantId: 'tenant-2' }),
    (error: unknown) => error instanceof ClientSuppliedTenantIdentityError,
  );
});

test('assertNoClientTenantIdentity rejects tenant_id in attributes', () => {
  assert.throws(
    () => assertNoClientTenantIdentity({ tenant_id: 'tenant-2' }),
    (error: unknown) => error instanceof ClientSuppliedTenantIdentityError,
  );
});

test('assertNoClientTenantIdentity accepts non-tenant attributes', () => {
  assert.doesNotThrow(() => assertNoClientTenantIdentity({ feature: true, status: 'active' }));
});
