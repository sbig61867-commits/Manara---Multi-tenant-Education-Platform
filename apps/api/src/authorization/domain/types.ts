export type AttributeValue = string | number | boolean | null;

export type RoleStatus = 'active' | 'retired';

export type PermissionStatus = 'draft' | 'active' | 'retired';

export interface Role {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: RoleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Permission {
  readonly id: string;
  readonly key: string;
  readonly module: string;
  readonly description: string | null;
  readonly status: PermissionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RolePermissionGrant {
  readonly roleId: string;
  readonly permissionId: string;
  readonly permissionKey: string;
  readonly grantedAt: Date;
}

export type RoleAssignmentScope =
  | { readonly type: 'tenant' }
  | { readonly type: 'unit'; readonly unitId: string }
  | { readonly type: 'program'; readonly programId: string }
  | { readonly type: 'group'; readonly groupId: string };

export interface RoleAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scope: RoleAssignmentScope;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
}

export interface AuthorizationSubject {
  readonly userId: string;
}

export interface AuthorizationResource {
  readonly type: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface AuthorizationContext {
  readonly tenantId: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export type AbacOperator = 'equals' | 'not_equals' | 'present' | 'absent';

export interface AbacCondition {
  readonly source: 'context' | 'resource';
  readonly key: string;
  readonly operator: AbacOperator;
  readonly value?: AttributeValue;
}

export type AuthorizationDecisionReason =
  | 'allowed'
  | 'denied_no_permission'
  | 'denied_missing_tenant_context'
  | 'denied_cross_tenant'
  | 'denied_client_tenant_identity'
  | 'denied_abac_condition_failed';

export type AuthorizationDenyReason = Exclude<AuthorizationDecisionReason, 'allowed'>;

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationDecisionReason;
  readonly matchedPermissionKey: string | null;
  readonly matchedRoleId: string | null;
  readonly scope: RoleAssignmentScope | null;
}
