export abstract class AuthorizationError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingTenantContextError extends AuthorizationError {
  readonly code = 'authorization.context_missing';
}

export class TenantContextMismatchError extends AuthorizationError {
  readonly code = 'authorization.context_mismatch';
}

export class ClientSuppliedTenantIdentityError extends AuthorizationError {
  readonly code = 'authorization.tenant_identity_from_client';
}

export class RoleNotFoundError extends AuthorizationError {
  readonly code = 'authorization.role_not_found';
}

export class RoleNameAlreadyExistsError extends AuthorizationError {
  readonly code = 'authorization.role_name_already_exists';
}

export class PermissionNotFoundError extends AuthorizationError {
  readonly code = 'authorization.permission_not_found';
}

export class PermissionAlreadyGrantedError extends AuthorizationError {
  readonly code = 'authorization.permission_already_granted';
}

export class PermissionNotGrantedError extends AuthorizationError {
  readonly code = 'authorization.permission_not_granted';
}

export class RoleAssignmentNotFoundError extends AuthorizationError {
  readonly code = 'authorization.assignment_not_found';
}

export class RoleAssignmentAlreadyExistsError extends AuthorizationError {
  readonly code = 'authorization.assignment_already_exists';
}

export class InvalidAssignmentScopeError extends AuthorizationError {
  readonly code = 'authorization.invalid_assignment_scope';
}
