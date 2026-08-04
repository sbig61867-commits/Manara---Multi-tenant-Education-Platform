import { Module } from '@nestjs/common';
import { NoopOutboxEventPublisher } from './domain/events.js';
import { OutboxService } from './application/outbox.service.js';
import { OUTBOX_CLOCK, OUTBOX_EVENT_PUBLISHER } from './outbox.tokens.js';
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
export class OutboxModule {}
