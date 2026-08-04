import { randomUUID } from 'node:crypto';
import type { TransactionalExecutor } from '@manara/database';
import type {
  OutboxClaimCriteria,
  OutboxFailure,
  OutboxMessage,
  OutboxPayload,
  OutboxScope,
  OutboxStatus,
} from '../domain/types.js';
import type { OutboxRepository } from '../ports/outbox.repository.js';

interface OutboxMessageRow {
  id: string;
  event_id: string;
  source: string;
  type: string;
  scope: string;
  tenant_id: string | null;
  status: string;
  attempt_count: number;
  payload: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  last_error: { code: string; message: string; retryable: boolean; occurred_at: string } | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const OUTBOX_COLUMNS =
  'id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at';

function serializeFailure(failure: OutboxFailure): string {
  return JSON.stringify({
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    occurred_at: failure.occurredAt.toISOString(),
  });
}

function mapMessage(row: OutboxMessageRow): OutboxMessage {
  return {
    id: row.id,
    eventId: row.event_id,
    source: row.source,
    type: row.type,
    scope: row.scope as OutboxScope,
    tenantId: row.tenant_id,
    payload: row.payload as OutboxPayload,
    status: row.status as OutboxStatus,
    attempts: row.attempt_count,
    lastError:
      row.last_error === null
        ? null
        : {
            code: row.last_error.code,
            message: row.last_error.message,
            retryable: row.last_error.retryable,
            occurredAt: new Date(row.last_error.occurred_at),
          },
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresOutboxRepository implements OutboxRepository {
  private readonly leaseOwner = randomUUID();

  constructor(private readonly database: TransactionalExecutor) {}

  async insert(message: OutboxMessage): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO outbox_messages (id, event_id, source, type, scope, tenant_id, status, attempt_count, payload, metadata_json, last_error, lease_owner, lease_expires_at, next_attempt_at, delivered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, NULL, NULL, NULL, $10, NULL, $11, $11)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        message.id,
        message.eventId,
        message.source,
        message.type,
        message.scope,
        message.tenantId,
        message.status,
        message.attempts,
        message.payload,
        message.nextAttemptAt,
        message.createdAt,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findById(id: string): Promise<OutboxMessage | null> {
    const result = await this.database.query<OutboxMessageRow>(
      `SELECT ${OUTBOX_COLUMNS} FROM outbox_messages WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapMessage(row);
  }

  async findByEventId(eventId: string): Promise<OutboxMessage | null> {
    const result = await this.database.query<OutboxMessageRow>(
      `SELECT ${OUTBOX_COLUMNS} FROM outbox_messages WHERE event_id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapMessage(row);
  }

  async claimPending(
    criteria: OutboxClaimCriteria,
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<OutboxMessage[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (criteria.scope === 'tenant') {
      params.push(criteria.tenantId);
      conditions.push(`scope = 'tenant' AND tenant_id = $${params.length}`);
    } else {
      conditions.push(`scope = 'platform'`);
    }
    conditions.push(`status = 'pending'`);
    params.push(now);
    conditions.push(`(next_attempt_at IS NULL OR next_attempt_at <= $${params.length})`);
    params.push(leaseExpiresAt, this.leaseOwner, now, criteria.limit ?? 10);
    const result = await this.database.query<OutboxMessageRow>(
      `WITH claimed AS (
         SELECT id FROM outbox_messages
         WHERE ${conditions.join(' AND ')}
         ORDER BY next_attempt_at NULLS FIRST, created_at, id
         LIMIT $${params.length}
         FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_messages m
       SET status = 'claimed', lease_owner = $${params.length - 2}, lease_expires_at = $${params.length - 3}, updated_at = $${params.length - 1}
       FROM claimed
       WHERE m.id = claimed.id
       RETURNING ${OUTBOX_COLUMNS.split(',')
         .map((column) => `m.${column.trim()}`)
         .join(', ')}`,
      params,
    );
    return result.rows.map(mapMessage);
  }

  async markDelivered(id: string, deliveredAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_messages
       SET status = 'delivered', delivered_at = $2, lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE id = $1 AND status = 'claimed' AND lease_owner = $3 AND (lease_expires_at IS NULL OR lease_expires_at > $2)`,
      [id, deliveredAt, this.leaseOwner],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markFailed(id: string, failure: OutboxFailure): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_messages
       SET status = 'failed', attempt_count = attempt_count + 1, last_error = $2::jsonb, lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
       WHERE id = $1 AND status = 'claimed' AND lease_owner = $4 AND (lease_expires_at IS NULL OR lease_expires_at > $3)`,
      [id, serializeFailure(failure), failure.occurredAt, this.leaseOwner],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async scheduleRetry(id: string, nextAttemptAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_messages
       SET status = 'pending', next_attempt_at = $2, lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE id = $1 AND status = 'failed'`,
      [id, nextAttemptAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markDeadLettered(id: string, deadLetteredAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE outbox_messages
       SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE id = $1 AND status = 'failed'`,
      [id, deadLetteredAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseStaleClaims(now: Date): Promise<number> {
    const result = await this.database.query(
      `UPDATE outbox_messages
       SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1`,
      [now, now],
    );
    return result.rowCount ?? 0;
  }
}
