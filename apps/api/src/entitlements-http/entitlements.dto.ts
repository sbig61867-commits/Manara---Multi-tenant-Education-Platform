import { cursorPaginationSchema } from '@manara/contracts';
import { z } from 'zod';
import { tenantIdParamsSchema } from '../tenants/tenant.dto.js';
import { ENTITLEMENTS_PERMISSIONS } from '../authorization/platform-permission-catalog.js';

export { tenantIdParamsSchema };
export type TenantIdParams = z.infer<typeof tenantIdParamsSchema>;

/**
 * Approved management permissions that protect the entitlements HTTP
 * endpoints. The permission catalog itself lives in the database
 * (`permissions` table, read-only platform data); these keys are the
 * documented set this HTTP layer requires. Keys follow the platform-wide
 * `${resourceType}:${action}` convention.
 */
export const MANAGEMENT_PERMISSIONS = ENTITLEMENTS_PERMISSIONS;

export type ManagementPermissionKey = (typeof MANAGEMENT_PERMISSIONS)[keyof typeof MANAGEMENT_PERMISSIONS];

export const featureKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_][a-z0-9_.-]*$/, 'must be a lowercase feature key');

export type FeatureKey = z.infer<typeof featureKeySchema>;

export const quotaKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_][a-z0-9_.-]*$/, 'must be a lowercase quota key');

export type QuotaKey = z.infer<typeof quotaKeySchema>;

export const listQuerySchema = cursorPaginationSchema;

export type ListQuery = z.infer<typeof listQuerySchema>;

export const planIdParamsSchema = z.object({
  planId: z.string().uuid(),
});

export type PlanIdParams = z.infer<typeof planIdParamsSchema>;

export const quotaParamsSchema = z.object({
  tenantId: z.string().uuid(),
  quotaKey: quotaKeySchema,
});

export type QuotaParams = z.infer<typeof quotaParamsSchema>;

export const overrideParamsSchema = z.object({
  tenantId: z.string().uuid(),
  featureKey: featureKeySchema,
});

export type OverrideParams = z.infer<typeof overrideParamsSchema>;

export const assignPlanBodySchema = z.object({
  planId: z.string().uuid(),
});

export type AssignPlanBody = z.infer<typeof assignPlanBodySchema>;

export const applyOverrideBodySchema = z.object({
  featureKey: featureKeySchema,
  enabled: z.boolean(),
});

export type ApplyOverrideBody = z.infer<typeof applyOverrideBodySchema>;

export const checkFeatureBodySchema = z.object({
  featureKey: featureKeySchema,
});

export type CheckFeatureBody = z.infer<typeof checkFeatureBodySchema>;

export const reserveQuotaBodySchema = z.object({
  amount: z.number().finite().positive(),
  operationId: z.string().trim().min(1).max(128).optional(),
});

export type ReserveQuotaBody = z.infer<typeof reserveQuotaBodySchema>;

export const releaseQuotaBodySchema = z.object({
  reservationId: z.string().uuid(),
});

export type ReleaseQuotaBody = z.infer<typeof releaseQuotaBodySchema>;

export const planStatusSchema = z.enum(['active', 'retired']);

export const planVersionStatusSchema = z.enum(['draft', 'active']);

export const hardRestrictionSchema = z.enum(['none', 'blocked']);

export const planViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: planStatusSchema,
  currentVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlanView = z.infer<typeof planViewSchema>;

export const planVersionViewSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  version: z.number(),
  label: z.string().nullable(),
  status: planVersionStatusSchema,
  effectiveFrom: z.string().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});

export type PlanVersionView = z.infer<typeof planVersionViewSchema>;

export const featureViewSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  hardRestriction: hardRestrictionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FeatureView = z.infer<typeof featureViewSchema>;

export const snapshotViewSchema = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  planName: z.string().nullable(),
  planVersionId: z.string().uuid().nullable(),
  planVersionNumber: z.number().nullable(),
  featureFlags: z.record(z.string(), z.boolean()),
  quotaLimits: z.record(z.string(), z.number().nullable()),
  generatedAt: z.string(),
});

export type SnapshotView = z.infer<typeof snapshotViewSchema>;

export const assignmentViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
  planVersionId: z.string().uuid(),
  status: z.literal('active'),
  assignedByUserId: z.string().uuid().nullable(),
  assignedAt: z.string(),
});

export type AssignmentView = z.infer<typeof assignmentViewSchema>;

export const overrideViewSchema = z.object({
  tenantId: z.string().uuid(),
  featureKey: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string(),
});

export type OverrideView = z.infer<typeof overrideViewSchema>;

export const decisionReasonSchema = z.enum([
  'allowed',
  'denied_no_entitlement',
  'denied_hard_restricted',
  'denied_missing_tenant_context',
  'denied_cross_tenant',
]);

export const decisionViewSchema = z.object({
  tenantId: z.string().uuid(),
  featureKey: z.string(),
  allowed: z.boolean(),
  reason: decisionReasonSchema,
  source: z.enum(['plan', 'override']).nullable(),
});

export type DecisionView = z.infer<typeof decisionViewSchema>;

export const quotaAvailabilityViewSchema = z.object({
  quotaKey: z.string(),
  tenantId: z.string().uuid(),
  limit: z.number().nullable(),
  consumed: z.number(),
  reserved: z.number(),
  available: z.number().nullable(),
});

export type QuotaAvailabilityView = z.infer<typeof quotaAvailabilityViewSchema>;

export const reservationViewSchema = z.object({
  reservationId: z.string().uuid(),
  quotaKey: z.string(),
  tenantId: z.string().uuid(),
  amount: z.number(),
});

export type ReservationView = z.infer<typeof reservationViewSchema>;

export const usageMeterKindSchema = z.enum(['consumed', 'reserved', 'committed', 'released']);

export const usageMeterViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  quotaKey: z.string(),
  amount: z.number(),
  kind: usageMeterKindSchema,
  operationId: z.string().nullable(),
  recordedAt: z.string(),
});

export type UsageMeterView = z.infer<typeof usageMeterViewSchema>;

export const planResponseSchema = z.object({
  plan: planViewSchema,
});

export type PlanResponse = z.infer<typeof planResponseSchema>;

export const planListResponseSchema = z.object({
  items: z.array(planViewSchema),
  nextCursor: z.string().nullable(),
});

export type PlanListResponse = z.infer<typeof planListResponseSchema>;

export const planVersionListResponseSchema = z.object({
  items: z.array(planVersionViewSchema),
  nextCursor: z.string().nullable(),
});

export type PlanVersionListResponse = z.infer<typeof planVersionListResponseSchema>;

export const featureListResponseSchema = z.object({
  items: z.array(featureViewSchema),
  nextCursor: z.string().nullable(),
});

export type FeatureListResponse = z.infer<typeof featureListResponseSchema>;

export const snapshotResponseSchema = z.object({
  snapshot: snapshotViewSchema,
});

export type SnapshotResponse = z.infer<typeof snapshotResponseSchema>;

export const assignmentResponseSchema = z.object({
  assignment: assignmentViewSchema,
});

export type AssignmentResponse = z.infer<typeof assignmentResponseSchema>;

export const overrideResponseSchema = z.object({
  override: overrideViewSchema,
});

export type OverrideResponse = z.infer<typeof overrideResponseSchema>;

export const checkFeatureResponseSchema = z.object({
  decision: decisionViewSchema,
});

export type CheckFeatureResponse = z.infer<typeof checkFeatureResponseSchema>;

export const quotaAvailabilityResponseSchema = z.object({
  quota: quotaAvailabilityViewSchema,
});

export type QuotaAvailabilityResponse = z.infer<typeof quotaAvailabilityResponseSchema>;

export const reservationResponseSchema = z.object({
  reservation: reservationViewSchema,
});

export type ReservationResponse = z.infer<typeof reservationResponseSchema>;

export const usageListResponseSchema = z.object({
  items: z.array(usageMeterViewSchema),
  nextCursor: z.string().nullable(),
});

export type UsageListResponse = z.infer<typeof usageListResponseSchema>;

const planViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: planStatusSchema.options },
    currentVersionId: { type: 'string', format: 'uuid', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'name', 'description', 'status', 'currentVersionId', 'createdAt', 'updatedAt'],
};

const planVersionViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid' },
    version: { type: 'number' },
    label: { type: 'string', nullable: true },
    status: { type: 'string', enum: planVersionStatusSchema.options },
    effectiveFrom: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    activatedAt: { type: 'string', nullable: true },
  },
  required: ['id', 'planId', 'version', 'label', 'status', 'effectiveFrom', 'createdAt', 'activatedAt'],
};

const featureViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    key: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    category: { type: 'string', nullable: true },
    hardRestriction: { type: 'string', enum: hardRestrictionSchema.options },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'key', 'name', 'description', 'category', 'hardRestriction', 'createdAt', 'updatedAt'],
};

const snapshotViewOpenApi = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid', nullable: true },
    planName: { type: 'string', nullable: true },
    planVersionId: { type: 'string', format: 'uuid', nullable: true },
    planVersionNumber: { type: 'number', nullable: true },
    featureFlags: { type: 'object', additionalProperties: { type: 'boolean' } },
    quotaLimits: { type: 'object', additionalProperties: { type: 'number', nullable: true } },
    generatedAt: { type: 'string' },
  },
  required: [
    'tenantId',
    'planId',
    'planName',
    'planVersionId',
    'planVersionNumber',
    'featureFlags',
    'quotaLimits',
    'generatedAt',
  ],
};

const assignmentViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid' },
    planVersionId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['active'] },
    assignedByUserId: { type: 'string', format: 'uuid', nullable: true },
    assignedAt: { type: 'string' },
  },
  required: ['id', 'tenantId', 'planId', 'planVersionId', 'status', 'assignedByUserId', 'assignedAt'],
};

const overrideViewOpenApi = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    featureKey: { type: 'string' },
    enabled: { type: 'boolean' },
    updatedAt: { type: 'string' },
  },
  required: ['tenantId', 'featureKey', 'enabled', 'updatedAt'],
};

const decisionViewOpenApi = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    featureKey: { type: 'string' },
    allowed: { type: 'boolean' },
    reason: { type: 'string', enum: decisionReasonSchema.options },
    source: { type: 'string', enum: ['plan', 'override'], nullable: true },
  },
  required: ['tenantId', 'featureKey', 'allowed', 'reason', 'source'],
};

const quotaAvailabilityViewOpenApi = {
  type: 'object',
  properties: {
    quotaKey: { type: 'string' },
    tenantId: { type: 'string', format: 'uuid' },
    limit: { type: 'number', nullable: true },
    consumed: { type: 'number' },
    reserved: { type: 'number' },
    available: { type: 'number', nullable: true },
  },
  required: ['quotaKey', 'tenantId', 'limit', 'consumed', 'reserved', 'available'],
};

const reservationViewOpenApi = {
  type: 'object',
  properties: {
    reservationId: { type: 'string', format: 'uuid' },
    quotaKey: { type: 'string' },
    tenantId: { type: 'string', format: 'uuid' },
    amount: { type: 'number' },
  },
  required: ['reservationId', 'quotaKey', 'tenantId', 'amount'],
};

const usageMeterViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    quotaKey: { type: 'string' },
    amount: { type: 'number' },
    kind: { type: 'string', enum: usageMeterKindSchema.options },
    operationId: { type: 'string', nullable: true },
    recordedAt: { type: 'string' },
  },
  required: ['id', 'tenantId', 'quotaKey', 'amount', 'kind', 'operationId', 'recordedAt'],
};

const paginatedListOpenApi = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    nextCursor: { type: 'string', nullable: true },
  },
  required: ['items', 'nextCursor'],
});

export const PLAN_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { plan: planViewOpenApi },
  required: ['plan'],
};

export const PLAN_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(planViewOpenApi);

export const PLAN_VERSION_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(planVersionViewOpenApi);

export const FEATURE_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(featureViewOpenApi);

export const SNAPSHOT_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { snapshot: snapshotViewOpenApi },
  required: ['snapshot'],
};

export const ASSIGNMENT_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { assignment: assignmentViewOpenApi },
  required: ['assignment'],
};

export const OVERRIDE_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { override: overrideViewOpenApi },
  required: ['override'],
};

export const CHECK_FEATURE_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { decision: decisionViewOpenApi },
  required: ['decision'],
};

export const QUOTA_AVAILABILITY_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { quota: quotaAvailabilityViewOpenApi },
  required: ['quota'],
};

export const RESERVATION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { reservation: reservationViewOpenApi },
  required: ['reservation'],
};

export const USAGE_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(usageMeterViewOpenApi);
