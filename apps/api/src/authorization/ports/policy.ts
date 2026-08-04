import type {
  AbacCondition,
  AuthorizationContext,
  AuthorizationResource,
  AuthorizationSubject,
  Role,
  RoleAssignment,
  RoleAssignmentScope,
  RolePermissionGrant,
} from '../domain/types.js';

export interface RbacResolution {
  readonly permissionKey: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly scope: RoleAssignmentScope;
}

export interface RbacRequest {
  readonly subject: AuthorizationSubject;
  readonly resource: AuthorizationResource;
  readonly action: string;
  readonly context: AuthorizationContext;
  readonly roles: readonly Role[];
  readonly grants: readonly RolePermissionGrant[];
  readonly assignments: readonly RoleAssignment[];
}

export interface RbacPolicy {
  resolve(request: RbacRequest): Promise<RbacResolution | null>;
}

export interface AbacPolicy {
  evaluate(
    condition: AbacCondition,
    context: AuthorizationContext,
    resource: AuthorizationResource,
  ): Promise<boolean>;
}
