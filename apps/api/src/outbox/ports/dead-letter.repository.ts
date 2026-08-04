import type { DeadLetterRecord } from '../domain/types.js';

export interface DeadLetterRepository {
  /** Inserts a dead-letter record. Returns false when the message id is already recorded (exactly-once). */
  insert(record: DeadLetterRecord): Promise<boolean>;

  findById(messageId: string): Promise<DeadLetterRecord | null>;
}
