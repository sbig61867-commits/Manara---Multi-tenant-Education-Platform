import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
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
import { AuthorizationContextInterceptor } from '../authorizations/authorization-context.interceptor.js';
import { AuthorizationPermissionInterceptor } from '../authorizations/authorization-permission.interceptor.js';
import { RequirePermission } from '../authorizations/require-permission.decorator.js';
import { InstitutionService } from '../tenant/application/institution.service.js';
import { InvitationService } from '../tenant/application/invitation.service.js';
import { MembershipService } from '../tenant/application/membership.service.js';
import type { Institution, Invitation, Membership } from '../tenant/domain/types.js';
import {
  ACCEPT_INVITATION_RESPONSE_OPENAPI,
  CREATE_INVITATION_RESPONSE_OPENAPI,
  INSTITUTION_RESPONSE_OPENAPI,
  INVITATION_LIST_RESPONSE_OPENAPI,
  INVITATION_RESPONSE_OPENAPI,
  MEMBERSHIP_LIST_RESPONSE_OPENAPI,
  MEMBERSHIP_RESPONSE_OPENAPI,
  MANAGEMENT_PERMISSIONS,
  acceptInvitationBodySchema,
  acceptInvitationResponseSchema,
  changeMembershipStatusBodySchema,
  changeTenantStatusBodySchema,
  createInstitutionBodySchema,
  createInvitationBodySchema,
  createInvitationResponseSchema,
  createMembershipBodySchema,
  institutionResponseSchema,
  institutionViewSchema,
  invitationListResponseSchema,
  invitationResponseSchema,
  invitationViewSchema,
  listQuerySchema,
  membershipIdParamsSchema,
  membershipListResponseSchema,
  membershipResponseSchema,
  membershipViewSchema,
  tenantIdParamsSchema,
  invitationIdParamsSchema,
  type AcceptInvitationBody,
  type AcceptInvitationResponse,
  type ChangeMembershipStatusBody,
  type ChangeTenantStatusBody,
  type CreateInstitutionBody,
  type CreateInvitationBody,
  type CreateInvitationResponse,
  type CreateMembershipBody,
  type InstitutionResponse,
  type InstitutionView,
  type InvitationIdParams,
  type InvitationListResponse,
  type InvitationResponse,
  type InvitationView,
  type ListQuery,
  type MembershipIdParams,
  type MembershipListResponse,
  type MembershipResponse,
  type MembershipView,
  type TenantIdParams,
} from './tenant.dto.js';
import { TenantAccessGuard } from './tenant-access.guard.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';

function toInstitutionView(institution: Institution): InstitutionView {
  return institutionViewSchema.parse({
    id: institution.id,
    name: institution.name,
    type: institution.type,
    status: institution.status,
    createdAt: institution.createdAt.toISOString(),
    updatedAt: institution.updatedAt.toISOString(),
  });
}

function toMembershipView(membership: Membership): MembershipView {
  return membershipViewSchema.parse({
    id: membership.id,
    institutionId: membership.institutionId,
    userId: membership.userId,
    status: membership.status,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
    startedAt: membership.startedAt === null ? null : membership.startedAt.toISOString(),
    endedAt: membership.endedAt === null ? null : membership.endedAt.toISOString(),
  });
}

function toInvitationView(invitation: Invitation): InvitationView {
  return invitationViewSchema.parse({
    id: invitation.id,
    institutionId: invitation.institutionId,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    acceptedByUserId: invitation.acceptedByUserId,
    acceptedAt: invitation.acceptedAt === null ? null : invitation.acceptedAt.toISOString(),
    revokedAt: invitation.revokedAt === null ? null : invitation.revokedAt.toISOString(),
  });
}

/**
 * Thin HTTP layer over the tenant application services. All business rules
 * live in `TenantModule`; this controller only maps requests/responses.
 * Tenant scoping is enforced by `TenantAccessGuard` (active membership) and
 * `TenantContextInterceptor` (server-side tenant context).
 */
@ApiTags('tenants')
@Controller('tenants')
@UseGuards(TenantAccessGuard)
@UseInterceptors(TenantContextInterceptor)
export class TenantController {
  constructor(
    @Inject(InstitutionService) private readonly institutions: InstitutionService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private authenticatedUserId(): string {
    const userId = this.requestContext.get()?.authenticatedUserId;
    if (userId === null || userId === undefined) {
      throw new Error('authenticatedUserId is missing; TenantAccessGuard must run before the handler');
    }
    return userId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ValidateBody(createInstitutionBodySchema)
  @ApiOperation({ summary: 'Create a new institution' })
  @ApiCreatedResponse({ description: 'Institution created', schema: INSTITUTION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async createInstitution(@Body() body: CreateInstitutionBody): Promise<InstitutionResponse> {
    const institution = await this.institutions.createInstitution({
      name: body.name,
      type: body.type,
      createdByUserId: this.authenticatedUserId(),
    });
    return institutionResponseSchema.parse({ institution: toInstitutionView(institution) });
  }

  @Get(':tenantId')
  @ValidateParams(tenantIdParamsSchema)
  @ApiOperation({ summary: 'Get an institution by id' })
  @ApiOkResponse({ description: 'Institution', schema: INSTITUTION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  async getInstitution(@Param() params: TenantIdParams): Promise<InstitutionResponse> {
    const institution = await this.institutions.getInstitution({ institutionId: params.tenantId });
    return institutionResponseSchema.parse({ institution: toInstitutionView(institution) });
  }

  @Patch(':tenantId/status')
  @UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
  @RequirePermission(MANAGEMENT_PERMISSIONS.institutionTransition)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(changeTenantStatusBodySchema)
  @ApiOperation({ summary: 'Transition an institution lifecycle status' })
  @ApiOkResponse({ description: 'Status changed', schema: INSTITUTION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  @ApiConflictResponse({ description: 'Invalid lifecycle transition' })
  async changeTenantStatus(
    @Param() params: TenantIdParams,
    @Body() body: ChangeTenantStatusBody,
  ): Promise<InstitutionResponse> {
    const actorUserId = this.authenticatedUserId();
    const institution = await this.transitionLifecycle(params.tenantId, body.status, actorUserId);
    return institutionResponseSchema.parse({ institution: toInstitutionView(institution) });
  }

  private transitionLifecycle(
    institutionId: string,
    to: ChangeTenantStatusBody['status'],
    actorUserId: string,
  ): Promise<Institution> {
    const command = { institutionId, actorUserId };
    switch (to) {
      case 'active':
        return this.institutions.activateInstitution(command);
      case 'suspended':
        return this.institutions.suspendInstitution(command);
      case 'grace_period':
        return this.institutions.moveToGracePeriod(command);
      case 'archived':
        return this.institutions.archiveInstitution(command);
      case 'deleted':
        return this.institutions.closeInstitution(command);
    }
  }

  @Get(':tenantId/memberships')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @ApiOperation({ summary: 'List memberships of an institution' })
  @ApiOkResponse({ description: 'Memberships page', schema: MEMBERSHIP_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  async listMemberships(
    @Param() params: TenantIdParams,
    @Query() query: ListQuery,
  ): Promise<MembershipListResponse> {
    const result = await this.memberships.listMemberships({
      institutionId: params.tenantId,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return membershipListResponseSchema.parse({
      items: result.items.map(toMembershipView),
      nextCursor: result.nextCursor,
    });
  }

  @Post(':tenantId/memberships')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
  @RequirePermission(MANAGEMENT_PERMISSIONS.membershipCreate)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(createMembershipBodySchema)
  @ApiOperation({ summary: 'Create a membership in an institution' })
  @ApiCreatedResponse({ description: 'Membership created', schema: MEMBERSHIP_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  @ApiConflictResponse({ description: 'An active membership already exists' })
  async createMembership(
    @Param() params: TenantIdParams,
    @Body() body: CreateMembershipBody,
  ): Promise<MembershipResponse> {
    const membership = await this.memberships.createMembership({
      institutionId: params.tenantId,
      userId: body.userId,
      status: body.status,
    });
    return membershipResponseSchema.parse({ membership: toMembershipView(membership) });
  }

  @Patch(':tenantId/memberships/:membershipId/status')
  @UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
  @RequirePermission(MANAGEMENT_PERMISSIONS.membershipStatusChange)
  @ValidateParams(membershipIdParamsSchema)
  @ValidateBody(changeMembershipStatusBodySchema)
  @ApiOperation({ summary: 'Change a membership status' })
  @ApiOkResponse({ description: 'Status changed', schema: MEMBERSHIP_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Membership not found' })
  @ApiConflictResponse({ description: 'Invalid membership status transition' })
  async changeMembershipStatus(
    @Param() params: MembershipIdParams,
    @Body() body: ChangeMembershipStatusBody,
  ): Promise<MembershipResponse> {
    const membership = await this.memberships.changeMembershipStatus({
      membershipId: params.membershipId,
      to: body.status,
    });
    return membershipResponseSchema.parse({ membership: toMembershipView(membership) });
  }

  @Get(':tenantId/invitations')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @ApiOperation({ summary: 'List invitations of an institution' })
  @ApiOkResponse({ description: 'Invitations page', schema: INVITATION_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  async listInvitations(
    @Param() params: TenantIdParams,
    @Query() query: ListQuery,
  ): Promise<InvitationListResponse> {
    const result = await this.invitations.listInvitations({
      institutionId: params.tenantId,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return invitationListResponseSchema.parse({
      items: result.items.map(toInvitationView),
      nextCursor: result.nextCursor,
    });
  }

  @Post(':tenantId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
  @RequirePermission(MANAGEMENT_PERMISSIONS.invitationCreate)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(createInvitationBodySchema)
  @ApiOperation({ summary: 'Create an invitation; the raw token is returned once' })
  @ApiCreatedResponse({ description: 'Invitation created with its one-time token', schema: CREATE_INVITATION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Institution not found' })
  async createInvitation(
    @Param() params: TenantIdParams,
    @Body() body: CreateInvitationBody,
  ): Promise<CreateInvitationResponse> {
    const result = await this.invitations.createInvitation({
      institutionId: params.tenantId,
      expiresAt: body.expiresAt,
      createdByUserId: this.authenticatedUserId(),
    });
    return createInvitationResponseSchema.parse({
      invitation: toInvitationView(result.invitation),
      rawToken: result.rawToken,
    });
  }

  @Post(':tenantId/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AuthorizationContextInterceptor, AuthorizationPermissionInterceptor)
  @RequirePermission(MANAGEMENT_PERMISSIONS.invitationRevoke)
  @ValidateParams(invitationIdParamsSchema)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  @ApiOkResponse({ description: 'Invitation revoked', schema: INVITATION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership in this tenant' })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiConflictResponse({ description: 'Invitation is not pending' })
  async revokeInvitation(@Param() params: InvitationIdParams): Promise<InvitationResponse> {
    const invitation = await this.invitations.revokeInvitation({ invitationId: params.invitationId });
    return invitationResponseSchema.parse({ invitation: toInvitationView(invitation) });
  }
}

@ApiTags('invitations')
@Controller('invitations')
@UseGuards(TenantAccessGuard)
export class InvitationController {
  constructor(
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private authenticatedUserId(): string {
    const userId = this.requestContext.get()?.authenticatedUserId;
    if (userId === null || userId === undefined) {
      throw new Error('authenticatedUserId is missing; TenantAccessGuard must run before the handler');
    }
    return userId;
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(TenantContextInterceptor)
  @ValidateBody(acceptInvitationBodySchema)
  @ApiOperation({ summary: 'Accept an invitation with its one-time raw token' })
  @ApiOkResponse({ description: 'Invitation accepted; membership created or reactivated', schema: ACCEPT_INVITATION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiConflictResponse({ description: 'Invitation is unknown, expired, revoked, already used, or the user is already active' })
  async acceptInvitation(@Body() body: AcceptInvitationBody): Promise<AcceptInvitationResponse> {
    const outcome = await this.invitations.acceptInvitation({
      rawToken: body.rawToken,
      userId: this.authenticatedUserId(),
    });
    return acceptInvitationResponseSchema.parse({
      invitation: toInvitationView(outcome.invitation),
      membership: toMembershipView(outcome.membership),
      activated: outcome.activated,
      previousStatus: outcome.previousStatus,
    });
  }
}
