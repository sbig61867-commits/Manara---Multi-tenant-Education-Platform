import { cursorPaginationSchema, userIdSchema } from '@manara/contracts';
import { z } from 'zod';
import { tenantIdParamsSchema } from '../tenants/tenant.dto.js';

export { tenantIdParamsSchema };
export type TenantIdParams = z.infer<typeof tenantIdParamsSchema>;

/**
 * Approved management permissions that protect the authorization HTTP
 * endpoints. The permission catalog itself lives in the database
 * (`permissions` table, read-only platform data); these keys are the
 * documented set this HTTP layer requires. Keys follow the platform-wide
 * `${resourceType}:${action}` convention.
 */
export const MANAGEMENT_PERMISSIONS = {
  roleCreate: 'role:create',
  roleList: 'role:list',
  roleRead: 'role:read',
  roleUpdate: 'role:update',
  roleRetire: 'role:retire',
  rolePermissionList: 'role_permission:list',
  rolePermissionGrant: 'role_permission:grant',
  rolePermissionRevoke: 'role_permission:revoke',
  roleAssignmentList: 'role_assignment:list',
  roleAssignmentAssign: 'role_assignment:assign',
  roleAssignmentRevoke: 'role_assignment:revoke',
  permissionList: 'permission:list',
  authorizationCheck: 'authorization:check',
  authorizationCheckMany: 'authorization:check_many',
} as const;

export type ManagementPermissionKey = (typeof MANAGEMENT_PERMISSIONS)[keyof typeof MANAGEMENT_PERMISSIONS];

/**
 * Splits a permission key of the form `${resourceType}:${action}`. Returns
 * null when the key has no colon or either side is empty.
 */
export function splitPermissionKey(key: string): { type: string; action: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return { type: key.slice(0, separator), action: key.slice(separator + 1) };
}

export const roleStatusSchema = z.enum(['active', 'retired']);

export type RoleStatus = z.infer<typeof roleStatusSchema>;

export const permissionKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+:[a-z0-9_.-]+$/i);

export type PermissionKey = z.infer<typeof permissionKeySchema>;

export const listQuerySchema = cursorPaginationSchema;

export type ListQuery = z.infer<typeof listQuerySchema>;

export const permissionListQuerySchema = cursorPaginationSchema.extend({
  module: z.string().trim().min(1).max(64).optional(),
});

export type PermissionListQuery = z.infer<typeof permissionListQuerySchema>;

export const roleIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export type RoleIdParams = z.infer<typeof roleIdParamsSchema>;

export const assignmentIdParamsSchema = z.object({
  tenantId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});

export type AssignmentIdParams = z.infer<typeof assignmentIdParamsSchema>;

export const createRoleBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

export const updateRoleBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'At least one of name or description must be provided',
  });

export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;

export const grantPermissionBodySchema = z.object({
  permissionKey: permissionKeySchema,
});

export type GrantPermissionBody = z.infer<typeof grantPermissionBodySchema>;

export const permissionKeyParamsSchema = z.object({
  tenantId: z.string().uuid(),
  roleId: z.string().uuid(),
  permissionKey: permissionKeySchema,
});

export type PermissionKeyParams = z.infer<typeof permissionKeyParamsSchema>;

export const roleAssignmentScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tenant') }),
  z.object({ type: z.literal('unit'), unitId: z.string().uuid() }),
  z.object({ type: z.literal('program'), programId: z.string().uuid() }),
  z.object({ type: z.literal('group'), groupId: z.string().uuid() }),
]);

export type RoleAssignmentScopeView = z.infer<typeof roleAssignmentScopeSchema>;

export const assignRoleBodySchema = z.object({
  userId: userIdSchema,
  roleId: z.string().uuid(),
  scope: roleAssignmentScopeSchema,
});

export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;

export const attributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type AttributeValueView = z.infer<typeof attributeValueSchema>;

export const resourceAttributesSchema = z.record(z.string(), attributeValueSchema);

export const checkItemSchema = z
  .object({
    permissionKey: permissionKeySchema,
    resourceType: z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/i),
    resourceId: z.string().trim().min(1).max(128).optional(),
    resourceAttributes: resourceAttributesSchema.optional(),
  })
  .superRefine((item, ctx) => {
    const split = splitPermissionKey(item.permissionKey);
    if (split !== null && split.type !== item.resourceType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resourceType'],
        message: `resourceType must match the type part of permissionKey (${split.type})`,
      });
    }
  });

export type CheckItemBody = z.infer<typeof checkItemSchema>;

export const checkBodySchema = z
  .object({
    subject: z.object({ userId: userIdSchema }),
    permissionKey: permissionKeySchema,
    resourceType: z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/i),
    resourceId: z.string().trim().min(1).max(128).optional(),
    resourceAttributes: resourceAttributesSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const split = splitPermissionKey(body.permissionKey);
    if (split !== null && split.type !== body.resourceType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resourceType'],
        message: `resourceType must match the type part of permissionKey (${split.type})`,
      });
    }
  });

export type CheckBody = z.infer<typeof checkBodySchema>;

export const checkManyBodySchema = z.object({
  subject: z.object({ userId: userIdSchema }),
  checks: z.array(checkItemSchema).min(1).max(20),
});

export type CheckManyBody = z.infer<typeof checkManyBodySchema>;

export const roleViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: roleStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoleView = z.infer<typeof roleViewSchema>;

export const permissionViewSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  module: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'retired']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PermissionView = z.infer<typeof permissionViewSchema>;

export const rolePermissionViewSchema = z.object({
  roleId: z.string().uuid(),
  permissionId: z.string().uuid(),
  permissionKey: z.string(),
  grantedAt: z.string(),
});

export type RolePermissionView = z.infer<typeof rolePermissionViewSchema>;

export const roleAssignmentViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  roleId: z.string().uuid(),
  userId: userIdSchema,
  scope: roleAssignmentScopeSchema,
  createdByUserId: userIdSchema.nullable(),
  createdAt: z.string(),
});

export type RoleAssignmentView = z.infer<typeof roleAssignmentViewSchema>;

export const roleResponseSchema = z.object({
  role: roleViewSchema,
});

export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const roleListResponseSchema = z.object({
  items: z.array(roleViewSchema),
  nextCursor: z.string().nullable(),
});

export type RoleListResponse = z.infer<typeof roleListResponseSchema>;

export const permissionListResponseSchema = z.object({
  items: z.array(permissionViewSchema),
  nextCursor: z.string().nullable(),
});

export type PermissionListResponse = z.infer<typeof permissionListResponseSchema>;

export const rolePermissionResponseSchema = z.object({
  grant: rolePermissionViewSchema,
});

export type RolePermissionResponse = z.infer<typeof rolePermissionResponseSchema>;

export const rolePermissionListResponseSchema = z.object({
  items: z.array(rolePermissionViewSchema),
  nextCursor: z.string().nullable(),
});

export type RolePermissionListResponse = z.infer<typeof rolePermissionListResponseSchema>;

export const roleAssignmentResponseSchema = z.object({
  assignment: roleAssignmentViewSchema,
});

export type RoleAssignmentResponse = z.infer<typeof roleAssignmentResponseSchema>;

export const roleAssignmentListResponseSchema = z.object({
  items: z.array(roleAssignmentViewSchema),
  nextCursor: z.string().nullable(),
});

export type RoleAssignmentListResponse = z.infer<typeof roleAssignmentListResponseSchema>;

export const checkResponseSchema = z.object({
  allowed: z.boolean(),
});

export type CheckResponse = z.infer<typeof checkResponseSchema>;

export const checkManyResponseSchema = z.object({
  allowed: z.boolean(),
  results: z.array(z.object({ permissionKey: z.string(), allowed: z.boolean() })),
});

export type CheckManyResponse = z.infer<typeof checkManyResponseSchema>;

const roleViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: roleStatusSchema.options },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'tenantId', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
};

const permissionViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    key: { type: 'string' },
    module: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['draft', 'active', 'retired'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'key', 'module', 'description', 'status', 'createdAt', 'updatedAt'],
};

const rolePermissionViewOpenApi = {
  type: 'object',
  properties: {
    roleId: { type: 'string', format: 'uuid' },
    permissionId: { type: 'string', format: 'uuid' },
    permissionKey: { type: 'string' },
    grantedAt: { type: 'string' },
  },
  required: ['roleId', 'permissionId', 'permissionKey', 'grantedAt'],
};

const roleAssignmentScopeOpenApi: { oneOf: Record<string, unknown>[] } = {
  oneOf: [
    { type: 'object', properties: { type: { type: 'string', enum: ['tenant'] } }, required: ['type'] },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['unit'] },
        unitId: { type: 'string', format: 'uuid' },
      },
      required: ['type', 'unitId'],
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['program'] },
        programId: { type: 'string', format: 'uuid' },
      },
      required: ['type', 'programId'],
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['group'] },
        groupId: { type: 'string', format: 'uuid' },
      },
      required: ['type', 'groupId'],
    },
  ],
};

const roleAssignmentViewOpenApi = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    roleId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    scope: roleAssignmentScopeOpenApi,
    createdByUserId: { type: 'string', format: 'uuid', nullable: true },
    createdAt: { type: 'string' },
  },
  required: ['id', 'tenantId', 'roleId', 'userId', 'scope', 'createdByUserId', 'createdAt'],
};

const paginatedListOpenApi = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema },
    nextCursor: { type: 'string', nullable: true },
  },
  required: ['items', 'nextCursor'],
});

export const ROLE_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { role: roleViewOpenApi },
  required: ['role'],
};

export const ROLE_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(roleViewOpenApi);

export const PERMISSION_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(permissionViewOpenApi);

export const ROLE_PERMISSION_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { grant: rolePermissionViewOpenApi },
  required: ['grant'],
};

export const ROLE_PERMISSION_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(rolePermissionViewOpenApi);

export const ROLE_ASSIGNMENT_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { assignment: roleAssignmentViewOpenApi },
  required: ['assignment'],
};

export const ROLE_ASSIGNMENT_LIST_RESPONSE_OPENAPI = paginatedListOpenApi(roleAssignmentViewOpenApi);

export const CHECK_RESPONSE_OPENAPI = {
  type: 'object',
  properties: { allowed: { type: 'boolean' } },
  required: ['allowed'],
};

export const CHECK_MANY_RESPONSE_OPENAPI = {
  type: 'object',
  properties: {
    allowed: { type: 'boolean' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          permissionKey: { type: 'string' },
          allowed: { type: 'boolean' },
        },
        required: ['permissionKey', 'allowed'],
      },
    },
  },
  required: ['allowed', 'results'],
};
