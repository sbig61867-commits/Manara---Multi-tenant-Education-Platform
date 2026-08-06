import type { TransactionalExecutor } from '@manara/database';
import type { UsageQuota } from '../domain/types.js';
import type { UsageQuotaRepository } from '../ports/usage-quota.repository.js';

interface UsageQuotaRow {
  id: string;
  tenant_id: string;
  quota_key: string;
  period: string;
  limit_value: string | number | null;
  consumed: string | number;
  reserved: string | number;
  period_start: Date;
  period_end: Date | null;
  updated_at: Date;
}

const USAGE_QUOTA_COLUMNS =
  'id, tenant_id, quota_key, period, limit_value, consumed, reserved, period_start, period_end, updated_at';

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function mapQuota(row: UsageQuotaRow | undefined): UsageQuota | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quotaKey: row.quota_key,
    period: row.period as UsageQuota['period'],
    limit: row.limit_value === null ? null : toNumber(row.limit_value),
    consumed: toNumber(row.consumed),
    reserved: toNumber(row.reserved),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    updatedAt: row.updated_at,
  };
}

export class PostgresUsageQuotaRepository implements UsageQuotaRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async findByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageQuota | null> {
    const result = await this.database.query<UsageQuotaRow>(
      `SELECT ${USAGE_QUOTA_COLUMNS} FROM usage_quotas WHERE tenant_id = $1 AND quota_key = $2`,
      [tenantId, quotaKey],
    );
    return mapQuota(result.rows[0]);
  }

  async findByTenantAndKeyForUpdate(tenantId: string, quotaKey: string): Promise<UsageQuota | null> {
    const result = await this.database.query<UsageQuotaRow>(
      `SELECT ${USAGE_QUOTA_COLUMNS} FROM usage_quotas WHERE tenant_id = $1 AND quota_key = $2 FOR UPDATE`,
      [tenantId, quotaKey],
    );
    return mapQuota(result.rows[0]);
  }

  async create(quota: UsageQuota): Promise<void> {
    await this.database.query(
      `INSERT INTO usage_quotas (${USAGE_QUOTA_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        quota.id,
        quota.tenantId,
        quota.quotaKey,
        quota.period,
        quota.limit,
        quota.consumed,
        quota.reserved,
        quota.periodStart,
        quota.periodEnd,
        quota.updatedAt,
      ],
    );
  }

  async createIfNotExists(quota: UsageQuota): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO usage_quotas (${USAGE_QUOTA_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, quota_key) DO NOTHING`,
      [
        quota.id,
        quota.tenantId,
        quota.quotaKey,
        quota.period,
        quota.limit,
        quota.consumed,
        quota.reserved,
        quota.periodStart,
        quota.periodEnd,
        quota.updatedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async update(quota: UsageQuota): Promise<void> {
    await this.database.query(
      `UPDATE usage_quotas
       SET limit_value = $4, consumed = $5, reserved = $6, period_start = $7, period_end = $8, updated_at = $9
       WHERE id = $1 AND tenant_id = $2 AND quota_key = $3`,
      [
        quota.id,
        quota.tenantId,
        quota.quotaKey,
        quota.limit,
        quota.consumed,
        quota.reserved,
        quota.periodStart,
        quota.periodEnd,
        quota.updatedAt,
      ],
    );
  }

  async listByTenant(tenantId: string): Promise<UsageQuota[]> {
    const result = await this.database.query<UsageQuotaRow>(
      `SELECT ${USAGE_QUOTA_COLUMNS} FROM usage_quotas WHERE tenant_id = $1 ORDER BY quota_key`,
      [tenantId],
    );
    return result.rows.map((row) => mapQuota(row) as UsageQuota);
  }
}
