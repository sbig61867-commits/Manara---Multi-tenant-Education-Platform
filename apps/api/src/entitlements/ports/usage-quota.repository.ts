import type { UsageQuota } from '../domain/types.js';

export interface UsageQuotaRepository {
  findByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageQuota | null>;
  create(quota: UsageQuota): Promise<void>;
  update(quota: UsageQuota): Promise<void>;
  listByTenant(tenantId: string): Promise<UsageQuota[]>;
}
