import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { NoopOutboxEventPublisher } from './domain/events.js';
import { OutboxService } from './application/outbox.service.js';
import { PostgresDeadLetterRepository } from './adapters/postgres-dead-letter.repository.js';
import { PostgresOutboxRepository } from './adapters/postgres-outbox.repository.js';
import {
  OUTBOX_CLOCK,
  OUTBOX_DEAD_LETTER_REPOSITORY,
  OUTBOX_EVENT_PUBLISHER,
  OUTBOX_REPOSITORY,
} from './outbox.tokens.js';
import type { OutboxClock } from './ports/outbox-clock.js';

class SystemOutboxClock implements OutboxClock {
  now(): Date {
    return new Date();
  }
}

@Module({
  providers: [
    OutboxService,
    { provide: OUTBOX_EVENT_PUBLISHER, useClass: NoopOutboxEventPublisher },
    { provide: OUTBOX_CLOCK, useClass: SystemOutboxClock },
  ],
  exports: [OutboxService],
})
export class OutboxModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: OutboxModule };
    }
    return {
      module: OutboxModule,
      providers: [
        { provide: OUTBOX_REPOSITORY, useValue: new PostgresOutboxRepository(database) },
        { provide: OUTBOX_DEAD_LETTER_REPOSITORY, useValue: new PostgresDeadLetterRepository(database) },
      ],
    };
  }
}
