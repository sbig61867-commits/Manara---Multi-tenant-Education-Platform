import assert from 'node:assert/strict';
import test from 'node:test';
import { AlsAuditContextResolver } from '../../src/audit/adapters/als-audit-context.resolver.js';
import { MissingTenantContextError } from '../../src/audit/domain/errors.js';
import { requireAuditTenantContext } from '../../src/audit/ports/audit-context.js';
import { FakeAuditContextResolver } from './audit-helpers.js';

test('requireAuditTenantContext returns the tenant id when present', () => {
  const resolver = new FakeAuditContextResolver('tenant-1', 'req-1');
  assert.equal(requireAuditTenantContext(resolver), 'tenant-1');
});

test('requireAuditTenantContext fails closed when the tenant id is missing', () => {
  const resolver = new FakeAuditContextResolver(null);
  assert.throws(() => requireAuditTenantContext(resolver), MissingTenantContextError);
});

test('requireAuditTenantContext fails closed when the tenant id is empty', () => {
  const resolver = new FakeAuditContextResolver('');
  assert.throws(() => requireAuditTenantContext(resolver), MissingTenantContextError);
});

test('ALS resolver returns no context outside a runWithAuditContext scope', () => {
  const resolver = new AlsAuditContextResolver();
  assert.deepEqual(resolver.resolveAuditContext(), { tenantId: null, requestId: null });
});

test('ALS resolver resolves tenant and request ids inside a scope', async () => {
  const resolver = new AlsAuditContextResolver();
  const context = await AlsAuditContextResolver.runWithAuditContext(
    { tenantId: 'tenant-1', requestId: 'req-1' },
    async () => resolver.resolveAuditContext(),
  );
  assert.deepEqual(context, { tenantId: 'tenant-1', requestId: 'req-1' });
});

test('ALS resolver supports partial contexts', async () => {
  const resolver = new AlsAuditContextResolver();
  const context = await AlsAuditContextResolver.runWithAuditContext(
    { requestId: 'req-2' },
    async () => resolver.resolveAuditContext(),
  );
  assert.deepEqual(context, { tenantId: null, requestId: 'req-2' });
});

test('ALS resolver restores the previous context after a nested scope exits', async () => {
  const resolver = new AlsAuditContextResolver();
  const outside = await AlsAuditContextResolver.runWithAuditContext(
    { tenantId: 'tenant-1', requestId: 'req-1' },
    async () => {
      const inside = resolver.resolveAuditContext();
      await AlsAuditContextResolver.runWithAuditContext(
        { tenantId: 'tenant-2', requestId: 'req-2' },
        async () => {},
      );
      const afterNested = resolver.resolveAuditContext();
      return { inside, afterNested };
    },
  );
  assert.deepEqual(outside.inside, { tenantId: 'tenant-1', requestId: 'req-1' });
  assert.deepEqual(outside.afterNested, { tenantId: 'tenant-1', requestId: 'req-1' });
  assert.deepEqual(resolver.resolveAuditContext(), { tenantId: null, requestId: null });
});

test('ALS resolver isolates concurrent audit contexts', async () => {
  const resolver = new AlsAuditContextResolver();
  const results = await Promise.all(
    ['tenant-a', 'tenant-b'].map((tenantId) =>
      AlsAuditContextResolver.runWithAuditContext(
        { tenantId, requestId: `req-${tenantId}` },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return resolver.resolveAuditContext();
        },
      ),
    ),
  );
  assert.deepEqual(results, [
    { tenantId: 'tenant-a', requestId: 'req-tenant-a' },
    { tenantId: 'tenant-b', requestId: 'req-tenant-b' },
  ]);
});
