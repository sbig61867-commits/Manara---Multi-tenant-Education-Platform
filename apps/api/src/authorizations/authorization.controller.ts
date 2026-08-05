import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequestContextService } from '../http/request-context.js';
import { ValidateBody, ValidateParams, ValidateQuery } from '../http/validate.decorators.js';
import { AuthorizationDecisionService } from '../authorization/application/authorization-decision.service.js';
import { RoleAssignmentService } from '../authorization/application/role-assignment.service.js';
import { RoleManagementService } from '../authorization/application/role-management.service.js';
import type { Permission, Role, RoleAssignment, RolePermissionGrant } from '../authorization/domain/types.js';
import { TenantAccessGuard } from '../tenants/tenant-access.guard.js';
import { AuthorizationContextInterceptor } from './authorization-context.interceptor.js';
import {
  CHECK_MANY_RESPONSE_OPENAPI,
  CHECK_RESPONSE_OPENAPI,
  MANAGEMENT_PERMISSIONS,
  PERMISSION_LIST_RESPONSE_OPENAPI,
  ROLE_ASSIGNMENT_LIST_RESPONSE_OPENAPI,
  ROLE_ASSIGNMENT_RESPONSE_OPENAPI,
  ROLE_LIST_RESPONSE_OPENAPI,
  ROLE_PERMISSION_LIST_RESPONSE_OPENAPI,
  ROLE_PERMISSION_RESPONSE_OPENAPI,
  ROLE_RESPONSE_OPENAPI,
  assignRoleBodySchema,
  assignmentIdParamsSchema,
  checkBodySchema,
  checkManyBodySchema,
  checkManyResponseSchema,
  checkResponseSchema,
  createRoleBodySchema,
  grantPermissionBodySchema,
  listQuerySchema,
  permissionKeyParamsSchema,
  permissionListQuerySchema,
  permissionListResponseSchema,
  permissionViewSchema,
  roleAssignmentListResponseSchema,
  roleAssignmentResponseSchema,
  roleAssignmentViewSchema,
  roleIdParamsSchema,
  roleListResponseSchema,
  rolePermissionListResponseSchema,
  rolePermissionResponseSchema,
  rolePermissionViewSchema,
  roleResponseSchema,
  roleViewSchema,
  splitPermissionKey,
  tenantIdParamsSchema,
  updateRoleBodySchema,
  type AssignRoleBody,
  type AssignmentIdParams,
  type CheckBody,
  type CheckManyBody,
  type CheckManyResponse,
  type CheckResponse,
  type CreateRoleBody,
  type GrantPermissionBody,
  type ListQuery,
  type PermissionKeyParams,
  type PermissionListQuery,
  type PermissionListResponse,
  type RoleAssignmentListResponse,
  type RoleAssignmentResponse,
  type RoleAssignmentScopeView,
  type RoleIdParams,
  type RoleListResponse,
  type RolePermissionListResponse,
  type RolePermissionResponse,
  type RoleResponse,
  type TenantIdParams,
  type UpdateRoleBody,
} from './authorization.dto.js';
import { AuthorizationPermissionInterceptor } from './authorization-permission.interceptor.js';
import { RequirePermission } from './require-permission.decorator.js';

function toRoleView(role: Role) {
  return roleViewSchema.parse({
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    description: role.description,
    status: role.status,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  });
}

function toPermissionView(permission: Permission) {
  return permissionViewSchema.parse({
    id: permission.id,
    key: permission.key,
    module: permission.module,
    description: permission.description,
    status: permission.status,
    createdAt: permission.createdAt.toISOString(),
    updatedAt: permission.updatedAt.toISOString(),
  });
}

function toGrantView(grant: RolePermissionGrant) {
  return rolePermissionViewSchema.parse({
    roleId: grant.roleId,
    permissionId: grant.permissionId,
    permissionKey: grant.permissionKey,
    grantedAt: grant.grantedAt.toISOString(),
  });
}

function toAssignmentView(assignment: RoleAssignment) {
  return roleAssignmentViewSchema.parse({
    id: assignment.id,
    tenantId: assignment.tenantId,
    roleId: assignment.roleId,
    userId: assignment.userId,
    scope: assignment.scope as RoleAssignmentScopeView,
    createdByUserId: assignment.createdByUserId,
    createdAt: assignment.createdAt.toISOString(),
  });
}

/**
 * Thin HTTP layer over the authorization application services. All business
 * rules live in `AuthorizationModule`; this controller only maps
 * requests/responses. Tenant scoping is enforced by `TenantAccessGuard`
 * (active membership), the server-side tenant context by
 * `AuthorizationContextInterceptor`, and the approved management permissions
 * by `AuthorizationPermissionInterceptor`.
 */
@ApiTags('authorization')
@Controller('tenants')
@UseGuards(TenantAccessGuard)
@UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
export class AuthorizationController {
  constructor(
    @Inject(RoleManagementService) private readonly roles: RoleManagementService,
    @Inject(RoleAssignmentService) private readonly assignments: RoleAssignmentService,
    @Inject(AuthorizationDecisionService) private readonly decisions: AuthorizationDecisionService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private authenticatedUserId(): string {
    const userId = this.requestContext.get()?.authenticatedUserId;
    if (userId === null || userId === undefined) {
      throw new Error('authenticatedUserId is missing; TenantAccessGuard must run before the handler');
    }
    return userId;
  }

  private async requireHeldPermission(userId: string, permissionKey: string): Promise<void> {
    const split = splitPermissionKey(permissionKey);
    if (split === null) {
      throw new ForbiddenException('Insufficient permissions to manage authorization');
    }
    const allowed = await this.decisions.checkPermission({
      subject: { userId },
      resource: { type: split.type, attributes: {} },
      action: split.action,
    });
    if (!allowed) {
      throw new ForbiddenException('You cannot grant authority you do not hold');
    }
  }

  @Get(':tenantId/roles')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleList)
  @ApiOperation({ summary: 'List roles of a tenant (cursor paginated)' })
  @ApiOkResponse({ description: 'Roles page', schema: ROLE_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listRoles(@Param() params: TenantIdParams, @Query() query: ListQuery): Promise<RoleListResponse> {
    const result = await this.roles.listRoles({ limit: query.limit, cursor: query.cursor ?? null });
    return roleListResponseSchema.parse({ items: result.items.map(toRoleView), nextCursor: result.nextCursor });
  }

  @Post(':tenantId/roles')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(createRoleBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleCreate)
  @ApiOperation({ summary: 'Create a tenant role' })
  @ApiCreatedResponse({ description: 'Role created', schema: ROLE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiConflictResponse({ description: 'A role with this name already exists in the tenant' })
  async createRole(@Param() params: TenantIdParams, @Body() body: CreateRoleBody): Promise<RoleResponse> {
    const role = await this.roles.createRole({ name: body.name, description: body.description ?? null });
    return roleResponseSchema.parse({ role: toRoleView(role) });
  }

  @Get(':tenantId/roles/:roleId')
  @ValidateParams(roleIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleRead)
  @ApiOperation({ summary: 'Get a tenant role by id' })
  @ApiOkResponse({ description: 'Role', schema: ROLE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async getRole(@Param() params: RoleIdParams): Promise<RoleResponse> {
    const role = await this.roles.getRole(params.roleId);
    return roleResponseSchema.parse({ role: toRoleView(role) });
  }

  @Patch(':tenantId/roles/:roleId')
  @ValidateParams(roleIdParamsSchema)
  @ValidateBody(updateRoleBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleUpdate)
  @ApiOperation({ summary: 'Update a tenant role name or description' })
  @ApiOkResponse({ description: 'Role updated', schema: ROLE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({ description: 'A role with this name already exists in the tenant' })
  async updateRole(@Param() params: RoleIdParams, @Body() body: UpdateRoleBody): Promise<RoleResponse> {
    const role = await this.roles.updateRole({ roleId: params.roleId, name: body.name, description: body.description });
    return roleResponseSchema.parse({ role: toRoleView(role) });
  }

  @Post(':tenantId/roles/:roleId/retire')
  @HttpCode(HttpStatus.OK)
  @ValidateParams(roleIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleRetire)
  @ApiOperation({ summary: 'Retire a role; it stops granting permissions immediately (idempotent)' })
  @ApiOkResponse({ description: 'Role retired', schema: ROLE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async retireRole(@Param() params: RoleIdParams): Promise<RoleResponse> {
    const role = await this.roles.retireRole(params.roleId);
    return roleResponseSchema.parse({ role: toRoleView(role) });
  }

  @Get(':tenantId/roles/:roleId/permissions')
  @ValidateParams(roleIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.rolePermissionList)
  @ApiOperation({ summary: 'List the permissions granted to a role (cursor paginated)' })
  @ApiOkResponse({ description: 'Grants page', schema: ROLE_PERMISSION_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async listRolePermissions(@Param() params: RoleIdParams, @Query() query: ListQuery): Promise<RolePermissionListResponse> {
    const result = await this.roles.listRolePermissions({ roleId: params.roleId, limit: query.limit, cursor: query.cursor ?? null });
    return rolePermissionListResponseSchema.parse({ items: result.items.map(toGrantView), nextCursor: result.nextCursor });
  }

  @Post(':tenantId/roles/:roleId/permissions')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(roleIdParamsSchema)
  @ValidateBody(grantPermissionBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.rolePermissionGrant)
  @ApiOperation({ summary: 'Grant a permission to a role; the caller must hold the granted permission' })
  @ApiCreatedResponse({ description: 'Permission granted', schema: ROLE_PERMISSION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership, no management permission, or granting authority you do not hold' })
  @ApiNotFoundResponse({ description: 'Role or permission not found' })
  @ApiConflictResponse({ description: 'Permission is already granted to this role' })
  async grantPermissionToRole(@Param() params: RoleIdParams, @Body() body: GrantPermissionBody): Promise<RolePermissionResponse> {
    await this.requireHeldPermission(this.authenticatedUserId(), body.permissionKey);
    const grant = await this.roles.assignPermissionToRole({ roleId: params.roleId, permissionKey: body.permissionKey });
    return rolePermissionResponseSchema.parse({ grant: toGrantView(grant) });
  }

  @Delete(':tenantId/roles/:roleId/permissions/:permissionKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ValidateParams(permissionKeyParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.rolePermissionRevoke)
  @ApiOperation({ summary: 'Revoke a permission from a role' })
  @ApiNoContentResponse({ description: 'Permission revoked' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Role or permission not found' })
  @ApiConflictResponse({ description: 'Permission is not granted to this role' })
  async revokePermissionFromRole(@Param() params: PermissionKeyParams): Promise<void> {
    await this.roles.removePermissionFromRole({ roleId: params.roleId, permissionKey: params.permissionKey });
  }

  @Get(':tenantId/role-assignments')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleAssignmentList)
  @ApiOperation({ summary: 'List role assignments of a tenant (cursor paginated)' })
  @ApiOkResponse({ description: 'Assignments page', schema: ROLE_ASSIGNMENT_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listRoleAssignments(@Param() params: TenantIdParams, @Query() query: ListQuery): Promise<RoleAssignmentListResponse> {
    const result = await this.assignments.listAssignments({ limit: query.limit, cursor: query.cursor ?? null });
    return roleAssignmentListResponseSchema.parse({ items: result.items.map(toAssignmentView), nextCursor: result.nextCursor });
  }

  @Post(':tenantId/role-assignments')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(assignRoleBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleAssignmentAssign)
  @ApiOperation({ summary: 'Assign a role to a user; the caller must hold every permission the role grants' })
  @ApiCreatedResponse({ description: 'Role assigned', schema: ROLE_ASSIGNMENT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership, no management permission, or assigning authority you do not hold' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({ description: 'This role is already assigned to the user in this scope' })
  async assignRoleToUser(@Param() params: TenantIdParams, @Body() body: AssignRoleBody): Promise<RoleAssignmentResponse> {
    const userId = this.authenticatedUserId();
    const keys = await this.roles.listRolePermissionKeys(body.roleId);
    for (const key of keys) {
      await this.requireHeldPermission(userId, key);
    }
    const assignment = await this.assignments.assignRoleToUser({
      userId: body.userId,
      roleId: body.roleId,
      scope: body.scope,
      createdByUserId: userId,
    });
    return roleAssignmentResponseSchema.parse({ assignment: toAssignmentView(assignment) });
  }

  @Delete(':tenantId/role-assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ValidateParams(assignmentIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.roleAssignmentRevoke)
  @ApiOperation({ summary: 'Revoke a role assignment; it takes effect immediately' })
  @ApiNoContentResponse({ description: 'Assignment revoked' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Assignment not found' })
  async revokeRoleAssignment(@Param() params: AssignmentIdParams): Promise<void> {
    await this.assignments.revokeRoleFromUser({ assignmentId: params.assignmentId });
  }

  @Post(':tenantId/authorization/check')
  @HttpCode(HttpStatus.OK)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(checkBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.authorizationCheck)
  @ApiOperation({ summary: 'Check whether a subject holds a permission for a resource' })
  @ApiOkResponse({ description: 'Decision', schema: CHECK_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async checkPermission(@Param() params: TenantIdParams, @Body() body: CheckBody): Promise<CheckResponse> {
    const allowed = await this.evaluateCheck(body);
    return checkResponseSchema.parse({ allowed });
  }

  @Post(':tenantId/authorization/check-many')
  @HttpCode(HttpStatus.OK)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(checkManyBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.authorizationCheckMany)
  @ApiOperation({ summary: 'Check multiple permissions in one request' })
  @ApiOkResponse({ description: 'Per-check decisions', schema: CHECK_MANY_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async checkPermissions(@Param() params: TenantIdParams, @Body() body: CheckManyBody): Promise<CheckManyResponse> {
    const results = [];
    for (const check of body.checks) {
      const allowed = await this.evaluateCheck({ subject: body.subject, ...check });
      results.push({ permissionKey: check.permissionKey, allowed });
    }
    return checkManyResponseSchema.parse({ allowed: results.every((result) => result.allowed), results });
  }

  private async evaluateCheck(body: CheckBody): Promise<boolean> {
    const split = splitPermissionKey(body.permissionKey);
    if (split === null) {
      throw new ForbiddenException('Insufficient permissions to manage authorization');
    }
    return this.decisions.checkPermission({
      subject: body.subject,
      resource: {
        type: split.type,
        attributes: {
          ...(body.resourceAttributes ?? {}),
          ...(body.resourceId === undefined ? {} : { id: body.resourceId }),
        },
      },
      action: split.action,
    });
  }
}

@ApiTags('authorization')
@Controller('permissions')
@UseGuards(TenantAccessGuard)
@UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
export class PermissionCatalogController {
  constructor(
    @Inject(RoleManagementService) private readonly roles: RoleManagementService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  @Get()
  @ValidateQuery(permissionListQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.permissionList)
  @ApiOperation({ summary: 'List the read-only platform permission catalog (cursor paginated)' })
  @ApiOkResponse({ description: 'Catalog page', schema: PERMISSION_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listPermissions(@Query() query: PermissionListQuery): Promise<PermissionListResponse> {
    const result = await this.roles.listPermissions({ limit: query.limit, cursor: query.cursor ?? null, module: query.module ?? null });
    return permissionListResponseSchema.parse({ items: result.items.map(toPermissionView), nextCursor: result.nextCursor });
  }
}
