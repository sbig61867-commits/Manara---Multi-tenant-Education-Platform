import type { TransactionalExecutor } from '@manara/database';
import type { UsageMeter } from '../domain/types.js';
import type { UsageMeterRepository } from '../ports/usage-meter.repository.js';

interface UsageMeterRow {
  id: string;
  tenant_id: string;
  quota_key: string;
  amount: string | number;
  kind: string;
  operation_id: string | null;
  recorded_at: Date;
}

const USAGE_METER_COLUMNS = 'id, tenant_id, quota_key, amount, kind, operation_id, recorded_at';

function mapMeter(row: UsageMeterRow | undefined): UsageMeter | null {
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quotaKey: row.quota_key,
    amount: typeof row.amount === 'number' ? row.amount : Number(row.amount),
    kind: row.kind as UsageMeter['kind'],
    operationId: row.operation_id,
    recordedAt: row.recorded_at,
  };
}

export class PostgresUsageMeterRepository implements UsageMeterRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async record(meter: UsageMeter): Promise<void> {
    await this.database.query(
      `INSERT INTO usage_meters (${USAGE_METER_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        meter.id,
        meter.tenantId,
        meter.quotaKey,
        meter.amount,
        meter.kind,
        meter.operationId,
        meter.recordedAt,
      ],
    );
  }

  async findById(id: string): Promise<UsageMeter | null> {
    const result = await this.database.query<UsageMeterRow>(
      `SELECT ${USAGE_METER_COLUMNS} FROM usage_meters WHERE id = $1`,
      [id],
    );
    return mapMeter(result.rows[0]);
  }

  async update(meter: UsageMeter): Promise<void> {
    await this.database.query(
      `UPDATE usage_meters SET kind = $3, operation_id = $4 WHERE id = $1 AND tenant_id = $2`,
      [meter.id, meter.tenantId, meter.kind, meter.operationId],
    );
  }

  async listByTenantAndKey(tenantId: string, quotaKey: string): Promise<UsageMeter[]> {
    const result = await this.database.query<UsageMeterRow>(
      `SELECT ${USAGE_METER_COLUMNS} FROM usage_meters
       WHERE tenant_id = $1 AND quota_key = $2 ORDER BY recorded_at`,
      [tenantId, quotaKey],
    );
    return result.rows.map((row) => mapMeter(row) as UsageMeter);
  }

  async listByTenant(tenantId: string): Promise<UsageMeter[]> {
    const result = await this.database.query<UsageMeterRow>(
      `SELECT ${USAGE_METER_COLUMNS} FROM usage_meters
       WHERE tenant_id = $1 ORDER BY recorded_at, id`,
      [tenantId],
    );
    return result.rows.map((row) => mapMeter(row) as UsageMeter);
  }
}
