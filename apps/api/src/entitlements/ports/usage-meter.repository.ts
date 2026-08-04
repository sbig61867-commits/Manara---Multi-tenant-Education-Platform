import type { UsageMeter } from '../domain/types.js';

export interface UsageMeterRepository {
  record(meter: UsageMeter): Promise<void>;
  findById(id: string): Promise<UsageMeter | null>;
  update(meter: UsageMeter): Promise<void>;
  listByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageMeter[]>;
}
