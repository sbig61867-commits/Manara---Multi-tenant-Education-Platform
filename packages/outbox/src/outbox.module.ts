import { Module, type DynamicModule } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { NoopOutboxEventPublisher } from './domain/events.js';
import { OutboxService } from './application/outbox.service.js';
import type { OutboxEventCatalogPolicy } from './application/event-catalog.js';
import { PostgresDeadLetterRepository } from './adapters/postgres-dead-letter.repository.js';
import { PostgresOutboxRepository } from './adapters/postgres-outbox.repository.js';
import {
  OUTBOX_CLOCK,
  OUTBOX_DEAD_LETTER_REPOSITORY,
  OUTBOX_EVENT_CATALOG_POLICY,
  OUTBOX_EVENT_PUBLISHER,
  OUTBOX_REPOSITORY,
} from './outbox.tokens.js';
import type { OutboxClock } from './ports/outbox-clock.js';

class SystemOutboxClock implements OutboxClock {
  now(): Date {
    return new Date();
  }
}

export interface OutboxModuleOptions {
  /**
   * When strict, the outbox rejects enqueues of event types that are undeclared
   * or declared without a delivery destination, so business flows cannot create
   * messages that are guaranteed to dead-letter. Defaults to strict whenever a
   * database is provided, and to open otherwise.
   */
  readonly eventCatalogPolicy?: OutboxEventCatalogPolicy;
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
  static forRoot(database: PostgresDatabase | null, options?: OutboxModuleOptions): DynamicModule {
    if (database === null) {
      return {
        module: OutboxModule,
        providers: [{ provide: OUTBOX_EVENT_CATALOG_POLICY, useValue: 'open' }],
        exports: [OutboxService],
      };
    }
    return {
      module: OutboxModule,
      providers: [
        { provide: OUTBOX_REPOSITORY, useValue: new PostgresOutboxRepository(database) },
        { provide: OUTBOX_DEAD_LETTER_REPOSITORY, useValue: new PostgresDeadLetterRepository(database) },
        {
          provide: OUTBOX_EVENT_CATALOG_POLICY,
          useValue: options?.eventCatalogPolicy ?? 'strict',
        },
      ],
      exports: [OutboxService],
    };
  }
}
