import { cursorPaginationSchema } from '@manara/contracts';
import { z } from 'zod';
import { tenantIdParamsSchema } from '../tenants/tenant.dto.js';
import { AUDIT_PERMISSIONS as PLATFORM_AUDIT_PERMISSIONS } from '../authorization/platform-permission-catalog.js';

export { tenantIdParamsSchema };
export type TenantIdParams = z.infer<typeof tenantIdParamsSchema>;

/**
 * Approved audit permissions that protect the audit HTTP endpoints. The
 * permission catalog itself lives in the database (`permissions` table,
 * read-only platform data); these keys are the documented set this HTTP layer
 * requires. Keys follow the platform-wide `${resourceType}:${action}`
 * convention.
 *
 * - `audit:list` / `audit:read` protect the tenant-scoped routes and are
 *   evaluated in the trusted tenant context of the authenticated user's
 *   active membership.
 * - `audit:platform` is the approved platform audit-read authority: it must
 *   be granted (like any permission) through the shared RBAC and is required
 *   for both platform audit routes. Platform queries remain structurally
 *   platform-scoped and never downgrade into tenant queries.
 */
export const AUDIT_PERMISSIONS = PLATFORM_AUDIT_PERMISSIONS;

export type AuditPermissionKey = (typeof AUDIT_PERMISSIONS)[keyof typeof AUDIT_PERMISSIONS];

export const auditEventIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
});

export type AuditEventIdParams = z.infer<typeof auditEventIdParamsSchema>;

export const platformAuditEventIdParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export type PlatformAuditEventIdParams = z.infer<typeof platformAuditEventIdParamsSchema>;

export const auditListQuerySchema = cursorPaginationSchema
  .extend({
    actorUserId: z.string().uuid().optional(),
    actorPlatformRole: z.string().trim().min(1).max(128).optional(),
    action: z.string().trim().min(1).max(200).optional(),
    targetEntityType: z.string().trim().min(1).max(64).optional(),
    targetEntityId: z.string().trim().min(1).max(128).optional(),
    requestId: z.string().trim().min(1).max(128).optional(),
    occurredFrom: z.coerce.date().optional(),
    occurredTo: z.coerce.date().optional(),
  })
  .superRefine((query, ctx) => {
    if (
      query.occurredFrom !== undefined &&
      query.occurredTo !== undefined &&
      query.occurredFrom.getTime() > query.occurredTo.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['occurredTo'],
        message: 'occurredTo must be on or after occurredFrom',
      });
    }
  });

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditScopeSchema = z.enum(['tenant', 'platform', 'cross_tenant']);

export const auditActorTypeSchema = z.enum(['user', 'system']);

export const auditActorViewSchema = z.object({
  id: z.string(),
  type: auditActorTypeSchema,
});

export type AuditActorView = z.infer<typeof auditActorViewSchema>;

export const auditTargetViewSchema = z.object({
  type: z.string(),
  id: z.string(),
});

export type AuditTargetView = z.infer<typeof auditTargetViewSchema>;

export const auditMetadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const auditEventViewSchema = z.object({
  id: z.string().uuid(),
  scope: auditScopeSchema,
  tenantId: z.string().uuid().nullable(),
  actor: auditActorViewSchema,
  target: auditTargetViewSchema,
  action: z.string(),
  reason: z.string().nullable(),
  requestId: z.string(),
  occurredAt: z.string(),
  metadata: z.record(z.string(), auditMetadataValueSchema),
});

export type AuditEventView = z.infer<typeof auditEventViewSchema>;

export const auditEventResponseSchema = z.object({
  event: auditEventViewSchema,
});

export type AuditEventResponse = z.infer<typeof auditEventResponseSchema>;

export const auditEventListResponseSchema = z.object({
  items: z.array(auditEventViewSchema),
  nextCursor: z.string().nullable(),
});

export type AuditEventListResponse = z.infer<typeof auditEventListResponseSchema>;

const auditActorViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: auditActorTypeSchema.options },
  },
  required: ['id', 'type'],
};

const auditTargetViewOpenApi = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    id: { type: 'string' },
  },
  required: ['type', 'id'],
};

const auditEventViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    scope: { type: 'string', enum: auditScopeSchema.options },
    tenantId: { type: 'string', format: 'uuid', nullable: true },
    actor: auditActorViewOpenApi,
    target: auditTargetViewOpenApi,
    action: { type: 'string' },
    reason: { type: 'string', nullable: true },
    requestId: { type: 'string' },
    occurredAt: { type: 'string' },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Redacted metadata (sensitive values replaced at write time)',
    },
  },
  required: [
    'id',
    'scope',
    'tenantId',
    'actor',
    'target',
    'action',
    'reason',
    'requestId',
    'occurredAt',
    'metadata',
  ],
};

const paginatedListOpenApi = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    nextCursor: { type: 'string', nullable: true },
  },
  required: ['items', 'nextCursor'],
});

export const AUDIT_EVENT_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { event: auditEventViewOpenApi },
  required: ['event'],
};

export const AUDIT_EVENT_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(auditEventViewOpenApi);
