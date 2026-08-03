import { z } from 'zod';

export const PACKAGE_VERSION = '0.1.0';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(['api', 'worker']),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});

export type HealthStatus = z.infer<typeof healthSchema>;

export const databaseHealthSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export type DatabaseHealth = z.infer<typeof databaseHealthSchema>;

export const readinessSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  service: z.literal('api'),
  version: z.string(),
  timestamp: z.string(),
  database: databaseHealthSchema,
});

export type ReadinessStatus = z.infer<typeof readinessSchema>;

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
