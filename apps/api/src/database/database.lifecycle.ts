import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { PostgresDatabase } from '@manara/database';
import { DATABASE } from './database.constants.js';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: PostgresDatabase | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database?.close();
  }
}
