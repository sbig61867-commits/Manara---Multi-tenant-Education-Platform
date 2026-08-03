import { checkDatabaseReadiness, type PostgresDatabase } from '@manara/database';
import { healthSchema, PACKAGE_VERSION, readinessSchema } from '@manara/contracts';
import type { DatabaseHealth, HealthStatus, ReadinessStatus } from '@manara/contracts';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DATABASE } from '../database/database.constants.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: PostgresDatabase | null) {}

  @Get()
  getHealth(): HealthStatus {
    return healthSchema.parse({
      status: 'ok',
      service: 'api',
      version: PACKAGE_VERSION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessStatus> {
    const database: DatabaseHealth = this.database
      ? await checkDatabaseReadiness(this.database)
      : { status: 'unavailable', error: 'database not configured' };
    const ready = database.status === 'ready';
    if (!ready) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readinessSchema.parse({
      status: ready ? 'ready' : 'unavailable',
      service: 'api',
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString(),
      database,
    });
  }
}
