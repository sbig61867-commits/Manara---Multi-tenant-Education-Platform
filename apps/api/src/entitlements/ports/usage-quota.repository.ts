import type { UsageQuota } from '../domain/types.js';

export interface UsageQuotaRepository {
  findByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageQuota | null>;
  findByTenantAndKeyForUpdate(tenantId: string, quotaKey: string): Promise<UsageQuota | null>;
  create(quota: UsageQuota): Promise<void>;
  createIfNotExists(quota: UsageQuota): Promise<boolean>;
  update(quota: UsageQuota): Promise<void>;
  listByTenant(tenantId: string): Promise<UsageQuota[]>;
}
