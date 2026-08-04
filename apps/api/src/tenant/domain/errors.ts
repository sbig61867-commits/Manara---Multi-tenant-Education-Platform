export abstract class TenantError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InstitutionNotFoundError extends TenantError {
  readonly code = 'tenant.institution_not_found';
}

export class InvalidLifecycleTransitionError extends TenantError {
  readonly code = 'tenant.invalid_lifecycle_transition';

  constructor(from: string, to: string) {
    super(`Invalid institution lifecycle transition: ${from} -> ${to}`);
  }
}

export class DeletedInstitutionError extends TenantError {
  readonly code = 'tenant.institution_deleted';

  constructor() {
    super('Institution is deleted and cannot be transitioned');
  }
}

export class MembershipNotFoundError extends TenantError {
  readonly code = 'tenant.membership_not_found';
}

export class MembershipAlreadyExistsError extends TenantError {
  readonly code = 'tenant.membership_already_exists';
}

export class MembershipAlreadyActiveError extends TenantError {
  readonly code = 'tenant.membership_already_active';
}

export class InvalidMembershipTransitionError extends TenantError {
  readonly code = 'tenant.invalid_membership_transition';

  constructor(from: string, to: string) {
    super(`Invalid membership status transition: ${from} -> ${to}`);
  }
}

export class InvitationNotFoundError extends TenantError {
  readonly code = 'tenant.invitation_not_found';
}

export class InvitationAlreadyHandledError extends TenantError {
  readonly code = 'tenant.invitation_already_handled';
}

export class InvitationAcceptanceRejectedError extends TenantError {
  readonly code = 'tenant.invitation_acceptance_rejected';
}

export class MissingTenantContextError extends TenantError {
  readonly code = 'tenant.context_missing';
}

export class TenantContextMismatchError extends TenantError {
  readonly code = 'tenant.context_mismatch';
}
