import { healthSchema, PACKAGE_VERSION } from '@manara/contracts';
import type { HealthStatus } from '@manara/contracts';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
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
}
