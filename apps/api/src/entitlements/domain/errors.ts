export abstract class EntitlementsError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingTenantContextError extends EntitlementsError {
  readonly code = 'entitlements.context_missing';
}

export class TenantContextMismatchError extends EntitlementsError {
  readonly code = 'entitlements.context_mismatch';
}

export class PlanNotFoundError extends EntitlementsError {
  readonly code = 'entitlements.plan_not_found';
}

export class PlanNameAlreadyExistsError extends EntitlementsError {
  readonly code = 'entitlements.plan_name_already_exists';
}

export class PlanRetiredError extends EntitlementsError {
  readonly code = 'entitlements.plan_retired';
}

export class PlanVersionNotFoundError extends EntitlementsError {
  readonly code = 'entitlements.plan_version_not_found';
}

export class PlanVersionAlreadyActivatedError extends EntitlementsError {
  readonly code = 'entitlements.plan_version_already_activated';
}

export class PlanHasNoActiveVersionError extends EntitlementsError {
  readonly code = 'entitlements.plan_has_no_active_version';
}

export class FeatureDefinitionNotFoundError extends EntitlementsError {
  readonly code = 'entitlements.feature_definition_not_found';
}

export class FeatureDefinitionKeyAlreadyExistsError extends EntitlementsError {
  readonly code = 'entitlements.feature_definition_key_already_exists';
}

export class FeatureHardRestrictedError extends EntitlementsError {
  readonly code = 'entitlements.feature_hard_restricted';
}

export class FeatureNotInPlanError extends EntitlementsError {
  readonly code = 'entitlements.feature_not_in_plan';
}

export class OverrideNotAllowedError extends EntitlementsError {
  readonly code = 'entitlements.override_not_allowed';
}

export class TenantNotAssignedError extends EntitlementsError {
  readonly code = 'entitlements.tenant_not_assigned';
}

export class TenantAlreadyAssignedError extends EntitlementsError {
  readonly code = 'entitlements.tenant_already_assigned';
}

export class InvalidFeatureEntitlementError extends EntitlementsError {
  readonly code = 'entitlements.invalid_feature_entitlement';
}

export class QuotaDimensionNotFoundError extends EntitlementsError {
  readonly code = 'entitlements.quota_dimension_not_found';
}

export class NegativeUsageError extends EntitlementsError {
  readonly code = 'entitlements.negative_usage';
}

export class QuotaExceededError extends EntitlementsError {
  readonly code = 'entitlements.quota_exceeded';
}

export class ReservationNotFoundError extends EntitlementsError {
  readonly code = 'entitlements.reservation_not_found';
}

export class InvalidReservationOperationError extends EntitlementsError {
  readonly code = 'entitlements.invalid_reservation_operation';
}
