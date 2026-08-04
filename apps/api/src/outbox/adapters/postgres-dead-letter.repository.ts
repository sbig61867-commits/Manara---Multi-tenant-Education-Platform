import type { TransactionalExecutor } from '@manara/database';
import type { DeadLetterRecord, OutboxFailure, OutboxPayload, OutboxScope } from '../domain/types.js';
import type { DeadLetterRepository } from '../ports/dead-letter.repository.js';

interface DeadLetterRow {
  message_id: string;
  event_id: string;
  source: string;
  type: string;
  scope: string;
  tenant_id: string | null;
  attempt_count: number;
  payload: Record<string, unknown>;
  failure: { code: string; message: string; retryable: boolean; occurred_at: string };
  dead_lettered_at: Date;
}

const DEAD_LETTER_COLUMNS =
  'message_id, event_id, source, type, scope, tenant_id, attempt_count, payload, failure, dead_lettered_at';

function serializeFailure(failure: OutboxFailure): string {
  return JSON.stringify({
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    occurred_at: failure.occurredAt.toISOString(),
  });
}

function mapRecord(row: DeadLetterRow): DeadLetterRecord {
  return {
    messageId: row.message_id,
    eventId: row.event_id,
    source: row.source,
    type: row.type,
    scope: row.scope as OutboxScope,
    tenantId: row.tenant_id,
    attempts: row.attempt_count,
    payload: row.payload as OutboxPayload,
    failure: {
      code: row.failure.code,
      message: row.failure.message,
      retryable: row.failure.retryable,
      occurredAt: new Date(row.failure.occurred_at),
    },
    deadLetteredAt: row.dead_lettered_at,
  };
}

export class PostgresDeadLetterRepository implements DeadLetterRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async insert(record: DeadLetterRecord): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO outbox_dead_letters (message_id, event_id, source, type, scope, tenant_id, attempt_count, payload, failure, dead_lettered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        record.messageId,
        record.eventId,
        record.source,
        record.type,
        record.scope,
        record.tenantId,
        record.attempts,
        record.payload,
        serializeFailure(record.failure),
        record.deadLetteredAt,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findById(messageId: string): Promise<DeadLetterRecord | null> {
    const result = await this.database.query<DeadLetterRow>(
      `SELECT ${DEAD_LETTER_COLUMNS} FROM outbox_dead_letters WHERE message_id = $1`,
      [messageId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRecord(row);
  }
}
