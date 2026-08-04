import assert from 'node:assert/strict';
import test from 'node:test';
import { AlsEntitlementsContextResolver } from '../../src/entitlements/adapters/als-entitlements-context.resolver.js';
import {
  MissingTenantContextError,
  TenantContextMismatchError,
} from '../../src/entitlements/domain/errors.js';
import {
  assertSameTenant,
  requireTenantContext,
} from '../../src/entitlements/ports/entitlements-context.js';
import { FakeEntitlementsContextResolver } from './entitlements-helpers.js';

test('requireTenantContext returns the tenant id when present', () => {
  const resolver = new FakeEntitlementsContextResolver('tenant-1');
  assert.equal(requireTenantContext(resolver), 'tenant-1');
});

test('requireTenantContext fails closed when the tenant id is missing', () => {
  const resolver = new FakeEntitlementsContextResolver(null);
  assert.throws(() => requireTenantContext(resolver), MissingTenantContextError);
});

test('assertSameTenant passes when tenant ids match', () => {
  assertSameTenant('tenant-1', 'tenant-1');
});

test('assertSameTenant denies cross-tenant access by default', () => {
  assert.throws(() => assertSameTenant('tenant-1', 'tenant-2'), TenantContextMismatchError);
});

test('ALS resolver has no tenant context outside a runWithTenant scope', () => {
  const resolver = new AlsEntitlementsContextResolver();
  assert.equal(resolver.resolveTenantId(), null);
});

test('ALS resolver resolves the tenant inside a runWithTenant scope', async () => {
  const resolver = new AlsEntitlementsContextResolver();
  const tenantId = await AlsEntitlementsContextResolver.runWithTenant('tenant-1', async () => {
    return resolver.resolveTenantId();
  });
  assert.equal(tenantId, 'tenant-1');
});

test('ALS resolver restores the previous context after the scope exits', async () => {
  const resolver = new AlsEntitlementsContextResolver();
  const outside = await AlsEntitlementsContextResolver.runWithTenant('tenant-1', async () => {
    const inside = resolver.resolveTenantId();
    await AlsEntitlementsContextResolver.runWithTenant('tenant-2', async () => {});
    const afterNested = resolver.resolveTenantId();
    return { inside, afterNested };
  });
  assert.equal(outside.inside, 'tenant-1');
  assert.equal(outside.afterNested, 'tenant-1');
  assert.equal(resolver.resolveTenantId(), null);
});

test('ALS resolver isolates concurrent tenant scopes', async () => {
  const resolver = new AlsEntitlementsContextResolver();
  const results = await Promise.all(
    ['tenant-a', 'tenant-b'].map((tenantId) =>
      AlsEntitlementsContextResolver.runWithTenant(tenantId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return resolver.resolveTenantId();
      }),
    ),
  );
  assert.deepEqual(results, ['tenant-a', 'tenant-b']);
});
