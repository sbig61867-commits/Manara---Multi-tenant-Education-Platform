import { z } from 'zod';
import { cursorPaginationSchema, userIdSchema } from '@manara/contracts';
import { TENANT_MANAGEMENT_PERMISSIONS } from '../authorization/platform-permission-catalog.js';

/** Management permissions required for administrative tenant mutations. */
export const MANAGEMENT_PERMISSIONS = TENANT_MANAGEMENT_PERMISSIONS;

export const institutionTypeSchema = z.enum([
  'university',
  'school',
  'training_centre',
  'corporate',
  'non_profit',
  'government',
  'academy',
  'custom',
]);

export type InstitutionType = z.infer<typeof institutionTypeSchema>;

export const tenantStatusSchema = z.enum(['draft', 'active', 'suspended', 'grace_period', 'archived', 'deleted']);

export const lifecycleTargetStatusSchema = z.enum(['active', 'suspended', 'grace_period', 'archived', 'deleted']);

export type LifecycleTargetStatus = z.infer<typeof lifecycleTargetStatusSchema>;

export const membershipStatusSchema = z.enum(['pending', 'active', 'inactive', 'suspended', 'ended']);

export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const invitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const tenantIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
});

export type TenantIdParams = z.infer<typeof tenantIdParamsSchema>;

export const membershipIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export type MembershipIdParams = z.infer<typeof membershipIdParamsSchema>;

export const invitationIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export type InvitationIdParams = z.infer<typeof invitationIdParamsSchema>;

export const listQuerySchema = cursorPaginationSchema;

export type ListQuery = z.infer<typeof listQuerySchema>;

export const createInstitutionBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: institutionTypeSchema,
});

export type CreateInstitutionBody = z.infer<typeof createInstitutionBodySchema>;

export const changeTenantStatusBodySchema = z.object({
  status: lifecycleTargetStatusSchema,
});

export type ChangeTenantStatusBody = z.infer<typeof changeTenantStatusBodySchema>;

export const createMembershipBodySchema = z.object({
  userId: userIdSchema,
  status: z.enum(['pending', 'active', 'inactive']).optional(),
});

export type CreateMembershipBody = z.infer<typeof createMembershipBodySchema>;

export const changeMembershipStatusBodySchema = z.object({
  status: membershipStatusSchema,
});

export type ChangeMembershipStatusBody = z.infer<typeof changeMembershipStatusBodySchema>;

export const createInvitationBodySchema = z.object({
  expiresAt: z.coerce.date(),
});

export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

export const acceptInvitationBodySchema = z.object({
  rawToken: z.string().min(1).max(512),
});

export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;

export const institutionViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: institutionTypeSchema,
  status: tenantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type InstitutionView = z.infer<typeof institutionViewSchema>;

export const membershipViewSchema = z.object({
  id: z.string().uuid(),
  institutionId: z.string().uuid(),
  userId: userIdSchema,
  status: membershipStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export type MembershipView = z.infer<typeof membershipViewSchema>;

export const invitationViewSchema = z.object({
  id: z.string().uuid(),
  institutionId: z.string().uuid(),
  status: invitationStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedByUserId: userIdSchema.nullable(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export type InvitationView = z.infer<typeof invitationViewSchema>;

export const institutionResponseSchema = z.object({
  institution: institutionViewSchema,
});

export type InstitutionResponse = z.infer<typeof institutionResponseSchema>;

export const membershipResponseSchema = z.object({
  membership: membershipViewSchema,
});

export type MembershipResponse = z.infer<typeof membershipResponseSchema>;

export const membershipListResponseSchema = z.object({
  items: z.array(membershipViewSchema),
  nextCursor: z.string().nullable(),
});

export type MembershipListResponse = z.infer<typeof membershipListResponseSchema>;

export const invitationResponseSchema = z.object({
  invitation: invitationViewSchema,
});

export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

export const createInvitationResponseSchema = z.object({
  invitation: invitationViewSchema,
  rawToken: z.string(),
});

export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

export const invitationListResponseSchema = z.object({
  items: z.array(invitationViewSchema),
  nextCursor: z.string().nullable(),
});

export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;

export const acceptInvitationResponseSchema = z.object({
  invitation: invitationViewSchema,
  membership: membershipViewSchema,
  activated: z.boolean(),
  previousStatus: membershipStatusSchema.nullable(),
});

export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

const institutionViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    type: { type: 'string', enum: institutionTypeSchema.options },
    status: { type: 'string', enum: tenantStatusSchema.options },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'name', 'type', 'status', 'createdAt', 'updatedAt'],
};

const membershipViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    institutionId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: membershipStatusSchema.options },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    startedAt: { type: 'string', nullable: true },
    endedAt: { type: 'string', nullable: true },
  },
  required: ['id', 'institutionId', 'userId', 'status', 'createdAt', 'updatedAt', 'startedAt', 'endedAt'],
};

const invitationViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    institutionId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: invitationStatusSchema.options },
    expiresAt: { type: 'string' },
    createdAt: { type: 'string' },
    acceptedByUserId: { type: 'string', format: 'uuid', nullable: true },
    acceptedAt: { type: 'string', nullable: true },
    revokedAt: { type: 'string', nullable: true },
  },
  required: ['id', 'institutionId', 'status', 'expiresAt', 'createdAt', 'acceptedByUserId', 'acceptedAt', 'revokedAt'],
};

const paginatedListOpenApi = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    nextCursor: { type: 'string', nullable: true },
  },
  required: ['items', 'nextCursor'],
});

export const INSTITUTION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { institution: institutionViewOpenApi },
  required: ['institution'],
};

export const MEMBERSHIP_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { membership: membershipViewOpenApi },
  required: ['membership'],
};

export const MEMBERSHIP_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(membershipViewOpenApi);

export const INVITATION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { invitation: invitationViewOpenApi },
  required: ['invitation'],
};

export const CREATE_INVITATION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: {
    invitation: invitationViewOpenApi,
    rawToken: { type: 'string', description: 'One-time invitation token; shown only here' },
  },
  required: ['invitation', 'rawToken'],
};

export const INVITATION_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(invitationViewOpenApi);

export const ACCEPT_INVITATION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: {
    invitation: invitationViewOpenApi,
    membership: membershipViewOpenApi,
    activated: { type: 'boolean' },
    previousStatus: { type: 'string', enum: membershipStatusSchema.options, nullable: true },
  },
  required: ['invitation', 'membership', 'activated', 'previousStatus'],
};
