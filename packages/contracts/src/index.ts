import { z } from 'zod';

export const PACKAGE_VERSION = '0.1.0';

export const API_VERSION = 'v1';

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
  service: z.enum(['api', 'worker']),
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

export const requestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, 'must contain only letters, digits, and hyphens');

export type RequestId = z.infer<typeof requestIdSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'must contain only letters, digits, dots, underscores, and hyphens');

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const errorDetailSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const emailSchema = z.string().trim().toLowerCase().min(1).max(254);

export type Email = z.infer<typeof emailSchema>;

export const userIdSchema = z.string().uuid();

export type UserId = z.infer<typeof userIdSchema>;

export const userSummarySchema = z.object({
  id: userIdSchema,
  email: emailSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserSummary = z.infer<typeof userSummarySchema>;

export const authSessionSchema = z.object({
  id: z.string(),
  userId: userIdSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  idleExpiresAt: z.string(),
});

export type AuthSessionView = z.infer<typeof authSessionSchema>;
