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
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequestContextService } from '../http/request-context.js';
import { HttpNotFoundError } from '../http/errors.js';
import { ValidateBody, ValidateParams, ValidateQuery } from '../http/validate.decorators.js';
import { EntitlementEvaluationService } from '../entitlements/application/entitlement-evaluation.service.js';
import { FeatureCatalogService } from '../entitlements/application/feature-catalog.service.js';
import { PlanCatalogService } from '../entitlements/application/plan-catalog.service.js';
import { TenantEntitlementService } from '../entitlements/application/tenant-entitlement.service.js';
import type {
  EntitlementDecision,
  FeatureDefinition,
  Plan,
  PlanVersion,
  QuotaAvailability,
  TenantEntitlementSnapshot,
  TenantFeatureOverride,
  TenantPlanAssignment,
  UsageMeter,
  UsageReservation,
} from '../entitlements/domain/types.js';
import { TenantAccessGuard } from '../tenants/tenant-access.guard.js';
import { encodeCursor } from '../tenant/pagination.js';
import { AuthorizationPermissionInterceptor } from '../authorizations/authorization-permission.interceptor.js';
import { RequirePermission } from '../authorizations/require-permission.decorator.js';
import {
  ASSIGNMENT_RESPONSE_OPENAPI,
  CHECK_FEATURE_RESPONSE_OPENAPI,
  FEATURE_LIST_RESPONSE_OPENAPI,
  MANAGEMENT_PERMISSIONS,
  OVERRIDE_RESPONSE_OPENAPI,
  PLAN_LIST_RESPONSE_OPENAPI,
  PLAN_RESPONSE_OPENAPI,
  PLAN_VERSION_LIST_RESPONSE_OPENAPI,
  QUOTA_AVAILABILITY_RESPONSE_OPENAPI,
  RESERVATION_RESPONSE_OPENAPI,
  SNAPSHOT_RESPONSE_OPENAPI,
  USAGE_LIST_RESPONSE_OPENAPI,
  applyOverrideBodySchema,
  assignPlanBodySchema,
  assignmentResponseSchema,
  assignmentViewSchema,
  checkFeatureBodySchema,
  checkFeatureResponseSchema,
  decisionViewSchema,
  featureListResponseSchema,
  featureViewSchema,
  listQuerySchema,
  overrideParamsSchema,
  overrideResponseSchema,
  overrideViewSchema,
  planIdParamsSchema,
  planListResponseSchema,
  planResponseSchema,
  planVersionListResponseSchema,
  planVersionViewSchema,
  planViewSchema,
  quotaAvailabilityResponseSchema,
  quotaAvailabilityViewSchema,
  quotaParamsSchema,
  releaseQuotaBodySchema,
  reserveQuotaBodySchema,
  reservationResponseSchema,
  reservationViewSchema,
  snapshotResponseSchema,
  snapshotViewSchema,
  tenantIdParamsSchema,
  usageListResponseSchema,
  usageMeterViewSchema,
  type ApplyOverrideBody,
  type AssignPlanBody,
  type AssignmentResponse,
  type AssignmentView,
  type CheckFeatureBody,
  type CheckFeatureResponse,
  type DecisionView,
  type FeatureListResponse,
  type FeatureView,
  type ListQuery,
  type OverrideParams,
  type OverrideResponse,
  type OverrideView,
  type PlanIdParams,
  type PlanListResponse,
  type PlanResponse,
  type PlanVersionListResponse,
  type PlanVersionView,
  type PlanView,
  type QuotaAvailabilityResponse,
  type QuotaAvailabilityView,
  type QuotaParams,
  type ReleaseQuotaBody,
  type ReserveQuotaBody,
  type ReservationResponse,
  type ReservationView,
  type SnapshotResponse,
  type SnapshotView,
  type TenantIdParams,
  type UsageListResponse,
  type UsageMeterView,
} from './entitlements.dto.js';
import { EntitlementsContextInterceptor } from './entitlements-context.interceptor.js';

function toPlanView(plan: Plan): PlanView {
  return planViewSchema.parse({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    currentVersionId: plan.currentVersionId,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  });
}

function toPlanVersionView(version: PlanVersion): PlanVersionView {
  return planVersionViewSchema.parse({
    id: version.id,
    planId: version.planId,
    version: version.version,
    label: version.label,
    status: version.status,
    effectiveFrom: version.effectiveFrom === null ? null : version.effectiveFrom.toISOString(),
    createdAt: version.createdAt.toISOString(),
    activatedAt: version.activatedAt === null ? null : version.activatedAt.toISOString(),
  });
}

function toFeatureView(feature: FeatureDefinition): FeatureView {
  return featureViewSchema.parse({
    id: feature.id,
    key: feature.key,
    name: feature.name,
    description: feature.description,
    category: feature.category,
    hardRestriction: feature.hardRestriction,
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
  });
}

function toSnapshotView(snapshot: TenantEntitlementSnapshot): SnapshotView {
  return snapshotViewSchema.parse({
    tenantId: snapshot.tenantId,
    planId: snapshot.planId,
    planName: snapshot.planName,
    planVersionId: snapshot.planVersionId,
    planVersionNumber: snapshot.planVersionNumber,
    featureFlags: { ...snapshot.featureFlags },
    quotaLimits: { ...snapshot.quotaLimits },
    generatedAt: snapshot.generatedAt.toISOString(),
  });
}

function toAssignmentView(assignment: TenantPlanAssignment): AssignmentView {
  return assignmentViewSchema.parse({
    id: assignment.id,
    tenantId: assignment.tenantId,
    planId: assignment.planId,
    planVersionId: assignment.planVersionId,
    status: assignment.status,
    assignedByUserId: assignment.assignedByUserId,
    assignedAt: assignment.assignedAt.toISOString(),
  });
}

function toOverrideView(override: TenantFeatureOverride): OverrideView {
  return overrideViewSchema.parse({
    tenantId: override.tenantId,
    featureKey: override.featureKey,
    enabled: override.enabled,
    updatedAt: override.updatedAt.toISOString(),
  });
}

function toDecisionView(decision: EntitlementDecision): DecisionView {
  return decisionViewSchema.parse({
    tenantId: decision.tenantId,
    featureKey: decision.featureKey,
    allowed: decision.allowed,
    reason: decision.reason,
    source: decision.source,
  });
}

function toAvailabilityView(availability: QuotaAvailability): QuotaAvailabilityView {
  return quotaAvailabilityViewSchema.parse({
    quotaKey: availability.quotaKey,
    tenantId: availability.tenantId,
    limit: availability.limit,
    consumed: availability.consumed,
    reserved: availability.reserved,
    available: availability.available,
  });
}

function toReservationView(reservation: UsageReservation): ReservationView {
  return reservationViewSchema.parse({
    reservationId: reservation.reservationId,
    quotaKey: reservation.quotaKey,
    tenantId: reservation.tenantId,
    amount: reservation.amount,
  });
}

function toMeterView(meter: UsageMeter): UsageMeterView {
  return usageMeterViewSchema.parse({
    id: meter.id,
    tenantId: meter.tenantId,
    quotaKey: meter.quotaKey,
    amount: meter.amount,
    kind: meter.kind,
    operationId: meter.operationId,
    recordedAt: meter.recordedAt.toISOString(),
  });
}

function byNewestFirst<T extends { createdAt: Date; id: string }>(a: T, b: T): number {
  const time = b.createdAt.getTime() - a.createdAt.getTime();
  return time !== 0 ? time : a.id.localeCompare(b.id);
}

function byRecordedNewestFirst(a: UsageMeter, b: UsageMeter): number {
  const time = b.recordedAt.getTime() - a.recordedAt.getTime();
  return time !== 0 ? time : a.id.localeCompare(b.id);
}

/**
 * Cursor pagination over an in-memory list ordered by a stable unique key.
 * The cursor is the base64url encoding of `"<createdAt ISO>:" + id` of the
 * last row of the previous page (see `tenant/pagination.ts`).
 */
function pageRows<T>(
  rows: readonly T[],
  cursorOf: (row: T) => string,
  limit: number,
  cursor: string | null,
): { items: T[]; nextCursor: string | null } {
  const start = cursor === null ? 0 : rows.findIndex((row) => cursorOf(row) === cursor);
  const from = cursor === null ? 0 : start === -1 ? 0 : start + 1;
  const items = rows.slice(from, from + limit);
  const nextCursor = rows.length > from + items.length ? cursorOf(items[items.length - 1] as T) : null;
  return { items, nextCursor };
}

/**
 * Thin HTTP layer over the entitlements application services. All business
 * rules live in `EntitlementsModule`; these controllers only map
 * requests/responses. Tenant scoping is enforced by `TenantAccessGuard`
 * (active membership), the server-side tenant context by
 * `EntitlementsContextInterceptor`, and the approved permissions by the
 * shared `AuthorizationPermissionInterceptor`.
 */
@ApiTags('entitlements')
@Controller('plans')
@UseGuards(TenantAccessGuard)
@UseInterceptors(EntitlementsContextInterceptor, AuthorizationPermissionInterceptor)
export class PlanCatalogController {
  constructor(@Inject(PlanCatalogService) private readonly plans: PlanCatalogService) {}

  @Get()
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.planList)
  @ApiOperation({ summary: 'List the platform plan catalog (cursor paginated)' })
  @ApiOkResponse({ description: 'Plans page', schema: PLAN_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listPlans(@Query() query: ListQuery): Promise<PlanListResponse> {
    const plans = [...(await this.plans.listPlans())].sort(byNewestFirst);
    const page = pageRows(plans, (plan) => encodeCursor(plan.createdAt, plan.id), query.limit, query.cursor ?? null);
    return planListResponseSchema.parse({ items: page.items.map(toPlanView), nextCursor: page.nextCursor });
  }

  @Get(':planId')
  @ValidateParams(planIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.planRead)
  @ApiOperation({ summary: 'Get a platform plan by id' })
  @ApiOkResponse({ description: 'Plan', schema: PLAN_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  async getPlan(@Param() params: PlanIdParams): Promise<PlanResponse> {
    const plan = await this.plans.getPlan(params.planId);
    if (plan === null) {
      throw new HttpNotFoundError('Plan not found');
    }
    return planResponseSchema.parse({ plan: toPlanView(plan) });
  }

  @Get(':planId/versions')
  @ValidateParams(planIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.planVersionList)
  @ApiOperation({ summary: 'List the versions of a platform plan (cursor paginated)' })
  @ApiOkResponse({ description: 'Plan versions page', schema: PLAN_VERSION_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  async listPlanVersions(@Param() params: PlanIdParams, @Query() query: ListQuery): Promise<PlanVersionListResponse> {
    const plan = await this.plans.getPlan(params.planId);
    if (plan === null) {
      throw new HttpNotFoundError('Plan not found');
    }
    const versions = [...(await this.plans.listPlanVersions(params.planId))].sort(byNewestFirst);
    const page = pageRows(versions, (version) => encodeCursor(version.createdAt, version.id), query.limit, query.cursor ?? null);
    return planVersionListResponseSchema.parse({ items: page.items.map(toPlanVersionView), nextCursor: page.nextCursor });
  }
}

@ApiTags('entitlements')
@Controller('features')
@UseGuards(TenantAccessGuard)
@UseInterceptors(EntitlementsContextInterceptor, AuthorizationPermissionInterceptor)
export class FeatureCatalogController {
  constructor(@Inject(FeatureCatalogService) private readonly features: FeatureCatalogService) {}

  @Get()
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.featureList)
  @ApiOperation({ summary: 'List the platform feature catalog (cursor paginated)' })
  @ApiOkResponse({ description: 'Features page', schema: FEATURE_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listFeatures(@Query() query: ListQuery): Promise<FeatureListResponse> {
    const features = [...(await this.features.listFeatures())].sort(byNewestFirst);
    const page = pageRows(features, (feature) => encodeCursor(feature.createdAt, feature.id), query.limit, query.cursor ?? null);
    return featureListResponseSchema.parse({ items: page.items.map(toFeatureView), nextCursor: page.nextCursor });
  }
}

@ApiTags('entitlements')
@Controller('tenants')
@UseGuards(TenantAccessGuard)
@UseInterceptors(EntitlementsContextInterceptor, AuthorizationPermissionInterceptor)
export class TenantEntitlementsController {
  constructor(
    @Inject(TenantEntitlementService) private readonly entitlements: TenantEntitlementService,
    @Inject(EntitlementEvaluationService) private readonly evaluation: EntitlementEvaluationService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private authenticatedUserId(): string {
    const userId = this.requestContext.get()?.authenticatedUserId;
    if (userId === null || userId === undefined) {
      throw new Error('authenticatedUserId is missing; TenantAccessGuard must run before the handler');
    }
    return userId;
  }

  @Get(':tenantId/entitlements')
  @ValidateParams(tenantIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementRead)
  @ApiOperation({ summary: 'Get the current entitlement snapshot of a tenant' })
  @ApiOkResponse({ description: 'Snapshot', schema: SNAPSHOT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async getEntitlements(@Param() _params: TenantIdParams): Promise<SnapshotResponse> {
    const snapshot = await this.evaluation.resolveTenantSnapshot();
    return snapshotResponseSchema.parse({ snapshot: toSnapshotView(snapshot) });
  }

  @Get(':tenantId/entitlements/snapshot')
  @ValidateParams(tenantIdParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementRead)
  @ApiOperation({ summary: 'Get the current entitlement snapshot of a tenant (explicit alias)' })
  @ApiOkResponse({ description: 'Snapshot', schema: SNAPSHOT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async getEntitlementsSnapshot(@Param() _params: TenantIdParams): Promise<SnapshotResponse> {
    const snapshot = await this.evaluation.resolveTenantSnapshot();
    return snapshotResponseSchema.parse({ snapshot: toSnapshotView(snapshot) });
  }

  @Post(':tenantId/entitlements/assign-plan')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(assignPlanBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementAssign)
  @ApiOperation({ summary: 'Assign the current plan version to a tenant' })
  @ApiCreatedResponse({ description: 'Assignment created', schema: ASSIGNMENT_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Plan not found' })
  @ApiConflictResponse({ description: 'Plan retired, no active version, or tenant already assigned' })
  async assignPlan(@Param() params: TenantIdParams, @Body() body: AssignPlanBody): Promise<AssignmentResponse> {
    const assignment = await this.entitlements.assignPlanToTenant({
      planId: body.planId,
      assignedByUserId: this.authenticatedUserId(),
    });
    return assignmentResponseSchema.parse({ assignment: toAssignmentView(assignment) });
  }

  @Post(':tenantId/entitlements/overrides')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(applyOverrideBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementOverride)
  @ApiOperation({ summary: 'Apply a feature override for a tenant' })
  @ApiCreatedResponse({ description: 'Override applied', schema: OVERRIDE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Feature not defined or tenant not assigned' })
  @ApiConflictResponse({ description: 'Feature not in plan or not overridable' })
  async applyOverride(@Param() params: TenantIdParams, @Body() body: ApplyOverrideBody): Promise<OverrideResponse> {
    const override = await this.entitlements.applyFeatureOverride({
      featureKey: body.featureKey,
      enabled: body.enabled,
    });
    return overrideResponseSchema.parse({ override: toOverrideView(override) });
  }

  @Delete(':tenantId/entitlements/overrides/:featureKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ValidateParams(overrideParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementOverride)
  @ApiOperation({ summary: 'Remove a feature override for a tenant (idempotent)' })
  @ApiNoContentResponse({ description: 'Override removed' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async removeOverride(@Param() params: OverrideParams): Promise<void> {
    await this.entitlements.removeFeatureOverride({ featureKey: params.featureKey });
  }

  @Post(':tenantId/entitlements/check')
  @HttpCode(HttpStatus.OK)
  @ValidateParams(tenantIdParamsSchema)
  @ValidateBody(checkFeatureBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.entitlementCheck)
  @ApiOperation({ summary: 'Evaluate whether a feature is enabled for a tenant' })
  @ApiOkResponse({ description: 'Decision', schema: CHECK_FEATURE_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async checkFeature(@Param() params: TenantIdParams, @Body() body: CheckFeatureBody): Promise<CheckFeatureResponse> {
    const decision = await this.evaluation.evaluateFeature({ featureKey: body.featureKey });
    return checkFeatureResponseSchema.parse({ decision: toDecisionView(decision) });
  }

  @Post(':tenantId/quotas/:quotaKey/check')
  @HttpCode(HttpStatus.OK)
  @ValidateParams(quotaParamsSchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.quotaRead)
  @ApiOperation({ summary: 'Check the availability of a quota dimension for a tenant' })
  @ApiOkResponse({ description: 'Availability', schema: QUOTA_AVAILABILITY_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Quota dimension is not entitled for this tenant' })
  async checkQuota(@Param() params: QuotaParams): Promise<QuotaAvailabilityResponse> {
    const availability = await this.evaluation.checkQuotaAvailability({ quotaKey: params.quotaKey });
    return quotaAvailabilityResponseSchema.parse({ quota: toAvailabilityView(availability) });
  }

  @Post(':tenantId/quotas/:quotaKey/reserve')
  @HttpCode(HttpStatus.CREATED)
  @ValidateParams(quotaParamsSchema)
  @ValidateBody(reserveQuotaBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.quotaReserve)
  @ApiOperation({ summary: 'Reserve quota units for a tenant' })
  @ApiCreatedResponse({ description: 'Reservation created', schema: RESERVATION_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Quota dimension is not entitled for this tenant' })
  @ApiConflictResponse({ description: 'Reserving would exceed the quota' })
  async reserveQuota(@Param() params: QuotaParams, @Body() body: ReserveQuotaBody): Promise<ReservationResponse> {
    const reservation = await this.evaluation.reserveUsage({
      quotaKey: params.quotaKey,
      amount: body.amount,
      operationId: body.operationId ?? null,
    });
    return reservationResponseSchema.parse({ reservation: toReservationView(reservation) });
  }

  @Post(':tenantId/quotas/:quotaKey/release')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ValidateParams(quotaParamsSchema)
  @ValidateBody(releaseQuotaBodySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.quotaRelease)
  @ApiOperation({ summary: 'Release a pending reservation for a tenant' })
  @ApiNoContentResponse({ description: 'Reservation released' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  @ApiConflictResponse({ description: 'Reservation is not pending' })
  async releaseQuota(@Param() params: QuotaParams, @Body() body: ReleaseQuotaBody): Promise<void> {
    await this.evaluation.releaseReservation({ reservationId: body.reservationId });
  }

  @Get(':tenantId/usage')
  @ValidateParams(tenantIdParamsSchema)
  @ValidateQuery(listQuerySchema)
  @RequirePermission(MANAGEMENT_PERMISSIONS.usageList)
  @ApiOperation({ summary: 'List the usage meters of a tenant (cursor paginated)' })
  @ApiOkResponse({ description: 'Usage meters page', schema: USAGE_LIST_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'No active membership or no management permission' })
  async listUsage(@Param() params: TenantIdParams, @Query() query: ListQuery): Promise<UsageListResponse> {
    const meters = [...(await this.evaluation.listUsageMeters())].sort(byRecordedNewestFirst);
    const page = pageRows(meters, (meter) => encodeCursor(meter.recordedAt, meter.id), query.limit, query.cursor ?? null);
    return usageListResponseSchema.parse({ items: page.items.map(toMeterView), nextCursor: page.nextCursor });
  }
}
