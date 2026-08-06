import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditService } from '../audit/application/audit.service.js';
import type { AuditEvent, AuditQueryCriteria, PlatformAuditQueryCriteria } from '../audit/domain/types.js';
import { HttpNotFoundError } from '../http/errors.js';
import { ValidateParams, ValidateQuery } from '../http/validate.decorators.js';
import { decodeCursor, encodeCursor } from '../tenant/pagination.js';
import { TenantAccessGuard } from '../tenants/tenant-access.guard.js';
import { AuthorizationPermissionInterceptor } from '../authorizations/authorization-permission.interceptor.js';
import { RequirePermission } from '../authorizations/require-permission.decorator.js';
import { TenantAuditContextInterceptor, PlatformAuditContextInterceptor } from './audit-context.interceptor.js';
import {
  AUDIT_EVENT_LIST_RESPONSE_OPENAPI,
  AUDIT_EVENT_RESPONSE_OPENAPI,
  AUDIT_PERMISSIONS,
  auditEventIdParamsSchema,
  auditEventListResponseSchema,
  auditEventResponseSchema,
  auditEventViewSchema,
  auditListQuerySchema,
  platformAuditEventIdParamsSchema,
  tenantIdParamsSchema,
  type AuditEventIdParams,
  type AuditEventListResponse,
  type AuditEventResponse,
  type AuditEventView,
  type AuditListQuery,
  type PlatformAuditEventIdParams,
  type TenantIdParams,
} from './audit.dto.js';

interface DecodedCursor {
  occurredAt: Date;
  id: string;
}

function toAuditEventView(event: AuditEvent): AuditEventView {
  return auditEventViewSchema.parse({
    id: event.id,
    scope: event.scope,
    tenantId: event.tenantId,
    actor: event.actor,
    target: event.target,
    action: event.action,
    reason: event.reason,
    requestId: event.requestId,
    occurredAt: event.occurredAt.toISOString(),
    metadata: { ...event.metadata },
  });
}

function decodeQueryCursor(cursor: string | undefined): DecodedCursor | null {
  if (cursor === undefined) {
    return null;
  }
  const decoded = decodeCursor(cursor);
  return decoded === null ? null : { occurredAt: decoded.createdAt, id: decoded.id };
}

/**
 * Maps the validated list query to service criteria. The page is fetched as
 * `requestedLimit + 1` rows so the HTTP layer can decide whether a
 * `nextCursor` exists; the service still bounds every fetch to at most 1000
 * rows and the repository keeps the deterministic `(occurred_at, id)`
 * ordering.
 */
function auditCriteriaFromQuery(
  query: AuditListQuery,
  cursor: DecodedCursor | null,
): AuditQueryCriteria & PlatformAuditQueryCriteria {
  return {
    actorUserId: query.actorUserId,
    actorPlatformRole: query.actorPlatformRole,
    action: query.action,
    targetType: query.targetEntityType,
    targetId: query.targetEntityId,
    requestId: query.requestId,
    from: query.occurredFrom,
    to: query.occurredTo,
    beforeOccurredAt: cursor?.occurredAt,
    beforeId: cursor?.id,
    limit: query.limit + 1,
  };
}

function toPage(events: readonly AuditEvent[], requestedLimit: number): AuditEventListResponse {
  const items = events.slice(0, requestedLimit);
  const last = items[items.length - 1];
  const nextCursor = events.length > requestedLimit && last !== undefined ? encodeCursor(last.occurredAt, last.id) : null;
  return auditEventListResponseSchema.parse({ items: items.map(toAuditEventView), nextCursor });
}

/**
 * Thin HTTP layer over `AuditService` for tenant audit history. All business
 * rules live in `AuditModule`; these controllers only map requests/responses.
 * Tenant scoping is enforced by `TenantAccessGuard` (active membership in the
 * requested tenant), the server-side tenant context by
 * `TenantAuditContextInterceptor`, and the approved permissions by the shared
 * `AuthorizationPermissionInterceptor`. No mutation endpoints exist: audit
 * data remains append-only.
 */
@ApiTags('audit')
@Controller('tenants')
@UseGuards(TenantAccessGuard)
@UseInterceptors(TenantAuditContextInterceptor, AuthorizationPermissionInterceptor)
export class TenantAuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get(':tenantId/audit-events')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(auditListQuerySchema)
  @RequirePermission(AUDIT_PERMISSIONS.auditList)
  @ApiOperation({ summary: 'List the audit events of a tenant (cursor paginated)' })
  @ApiQuery({ name: 'actorUserId', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Filter by the actor user id (uuid)' })
  @ApiQuery({ name: 'actorPlatformRole', required: false, schema: { type: 'string' }, description: 'Filter by the actor platform role' })
  @ApiQuery({ name: 'action', required: false, schema: { type: 'string' }, description: 'Filter by the exact action' })
  @ApiQuery({ name: 'targetEntityType', required: false, schema: { type: 'string' }, description: 'Filter by the exact target entity type' })
  @ApiQuery({ name: 'targetEntityId', required: false, schema: { type: 'string' }, description: 'Filter by the exact target entity id' })
  @ApiQuery({ name: 'requestId', required: false, schema: { type: 'string' }, description: 'Filter by the recorded request id' })
  @ApiQuery({ name: 'occurredFrom', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Inclusive lower bound (ISO-8601 date-time)' })
  @ApiQuery({ name: 'occurredTo', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Inclusive upper bound (ISO-8601 date-time); must be on or after occurredFrom' })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' }, description: 'Opaque pagination cursor from the previous page' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 }, description: 'Maximum page size (1-100, default 50)' })
  @ApiOkResponse({ description: 'Audit events page', schema: AUDIT_EVENT_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no audit permission' })
  async listAuditEvents(@Param() _params: TenantIdParams, @Query() query: AuditListQuery): Promise<AuditEventListResponse> {
    const events = await this.audit.queryAuditHistory(auditCriteriaFromQuery(query, decodeQueryCursor(query.cursor)));
    return toPage(events, query.limit);
  }

  @Get(':tenantId/audit-events/:eventId')
  @ValidateParams(auditEventIdParamsSchema)
  @RequirePermission(AUDIT_PERMISSIONS.auditRead)
  @ApiOperation({ summary: 'Get a single audit event of a tenant' })
  @ApiOkResponse({ description: 'Audit event', schema: AUDIT_EVENT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no audit permission' })
  @ApiNotFoundResponse({ description: 'Audit event not found in this tenant' })
  async getAuditEvent(@Param() params: AuditEventIdParams): Promise<AuditEventResponse> {
    const event = await this.audit.findTenantAuditEventById(params.eventId);
    if (event === null) {
      throw new HttpNotFoundError('Audit event not found');
    }
    return auditEventResponseSchema.parse({ event: toAuditEventView(event) });
  }
}

/**
 * Platform audit routes. The `audit:platform` authority is evaluated by the
 * shared permission interceptor inside the authorization context established
 * by `PlatformAuditContextInterceptor` (the user's most recent active
 * membership). The queries themselves are platform-scoped: they run without
 * any audit tenant scope and are hard-filtered to `scope = 'platform'` with
 * no tenant, so they can never silently downgrade into tenant queries.
 */
@ApiTags('audit')
@Controller('platform')
@UseGuards(TenantAccessGuard)
@UseInterceptors(PlatformAuditContextInterceptor, AuthorizationPermissionInterceptor)
export class PlatformAuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get('audit-events')
  @ValidateQuery(auditListQuerySchema)
  @RequirePermission(AUDIT_PERMISSIONS.auditPlatform)
  @ApiOperation({ summary: 'List the platform audit events (cursor paginated)' })
  @ApiQuery({ name: 'actorUserId', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Filter by the actor user id (uuid)' })
  @ApiQuery({ name: 'actorPlatformRole', required: false, schema: { type: 'string' }, description: 'Filter by the actor platform role' })
  @ApiQuery({ name: 'action', required: false, schema: { type: 'string' }, description: 'Filter by the exact action' })
  @ApiQuery({ name: 'targetEntityType', required: false, schema: { type: 'string' }, description: 'Filter by the exact target entity type' })
  @ApiQuery({ name: 'targetEntityId', required: false, schema: { type: 'string' }, description: 'Filter by the exact target entity id' })
  @ApiQuery({ name: 'requestId', required: false, schema: { type: 'string' }, description: 'Filter by the recorded request id' })
  @ApiQuery({ name: 'occurredFrom', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Inclusive lower bound (ISO-8601 date-time)' })
  @ApiQuery({ name: 'occurredTo', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Inclusive upper bound (ISO-8601 date-time); must be on or after occurredFrom' })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' }, description: 'Opaque pagination cursor from the previous page' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 }, description: 'Maximum page size (1-100, default 50)' })
  @ApiOkResponse({ description: 'Platform audit events page', schema: AUDIT_EVENT_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no platform audit-read authority' })
  async listPlatformAuditEvents(@Query() query: AuditListQuery): Promise<AuditEventListResponse> {
    const events = await this.audit.queryPlatformAuditHistory(auditCriteriaFromQuery(query, decodeQueryCursor(query.cursor)));
    return toPage(events, query.limit);
  }

  @Get('audit-events/:eventId')
  @ValidateParams(platformAuditEventIdParamsSchema)
  @RequirePermission(AUDIT_PERMISSIONS.auditPlatform)
  @ApiOperation({ summary: 'Get a single platform audit event' })
  @ApiOkResponse({ description: 'Platform audit event', schema: AUDIT_EVENT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no platform audit-read authority' })
  @ApiNotFoundResponse({ description: 'Platform audit event not found' })
  async getPlatformAuditEvent(@Param() params: PlatformAuditEventIdParams): Promise<AuditEventResponse> {
    const event = await this.audit.findPlatformAuditEventById(params.eventId);
    if (event === null) {
      throw new HttpNotFoundError('Audit event not found');
    }
    return auditEventResponseSchema.parse({ event: toAuditEventView(event) });
  }
}
