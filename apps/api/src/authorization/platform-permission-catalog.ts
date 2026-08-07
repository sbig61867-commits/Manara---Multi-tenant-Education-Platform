export interface PlatformPermissionDescriptor {
  readonly key: string;
  readonly module: string;
  readonly description: string;
}

export const AUTHORIZATION_PERMISSIONS = {
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

export const TENANT_MANAGEMENT_PERMISSIONS = {
  institutionTransition: 'institution:transition',
  membershipCreate: 'membership:create',
  membershipStatusChange: 'membership:status_change',
  invitationCreate: 'invitation:create',
  invitationRevoke: 'invitation:revoke',
} as const;

export const ENTITLEMENTS_PERMISSIONS = {
  planList: 'plan:list',
  planRead: 'plan:read',
  planVersionList: 'plan:versions',
  featureList: 'feature:list',
  entitlementRead: 'entitlement:read',
  entitlementAssign: 'entitlement:assign',
  entitlementOverride: 'entitlement:override',
  entitlementCheck: 'entitlement:check',
  quotaRead: 'quota:read',
  quotaReserve: 'quota:reserve',
  quotaRelease: 'quota:release',
  usageList: 'usage:list',
} as const;

export const AUDIT_PERMISSIONS = {
  auditList: 'audit:list',
  auditRead: 'audit:read',
  auditPlatform: 'audit:platform',
} as const;

export function definePlatformPermissionCatalog(
  descriptors: readonly PlatformPermissionDescriptor[],
): readonly PlatformPermissionDescriptor[] {
  const keys = new Set<string>();
  for (const descriptor of descriptors) {
    if (keys.has(descriptor.key)) {
      throw new Error(`Duplicate platform permission key: ${descriptor.key}`);
    }
    keys.add(descriptor.key);
  }
  return Object.freeze(descriptors.map((descriptor) => Object.freeze({ ...descriptor })));
}

export const PLATFORM_PERMISSION_CATALOG = definePlatformPermissionCatalog([
  { key: AUTHORIZATION_PERMISSIONS.roleCreate, module: 'role', description: 'Create tenant roles.' },
  { key: AUTHORIZATION_PERMISSIONS.roleList, module: 'role', description: 'List tenant roles.' },
  { key: AUTHORIZATION_PERMISSIONS.roleRead, module: 'role', description: 'Read tenant role details.' },
  { key: AUTHORIZATION_PERMISSIONS.roleUpdate, module: 'role', description: 'Update tenant roles.' },
  { key: AUTHORIZATION_PERMISSIONS.roleRetire, module: 'role', description: 'Retire tenant roles.' },
  { key: AUTHORIZATION_PERMISSIONS.rolePermissionList, module: 'role_permission', description: 'List permissions granted to a role.' },
  { key: AUTHORIZATION_PERMISSIONS.rolePermissionGrant, module: 'role_permission', description: 'Grant permissions to a role.' },
  { key: AUTHORIZATION_PERMISSIONS.rolePermissionRevoke, module: 'role_permission', description: 'Revoke permissions from a role.' },
  { key: AUTHORIZATION_PERMISSIONS.roleAssignmentList, module: 'role_assignment', description: 'List tenant role assignments.' },
  { key: AUTHORIZATION_PERMISSIONS.roleAssignmentAssign, module: 'role_assignment', description: 'Assign tenant roles to users.' },
  { key: AUTHORIZATION_PERMISSIONS.roleAssignmentRevoke, module: 'role_assignment', description: 'Revoke tenant role assignments.' },
  { key: AUTHORIZATION_PERMISSIONS.permissionList, module: 'permission', description: 'List the platform permission catalog.' },
  { key: AUTHORIZATION_PERMISSIONS.authorizationCheck, module: 'authorization', description: 'Evaluate one authorization decision.' },
  { key: AUTHORIZATION_PERMISSIONS.authorizationCheckMany, module: 'authorization', description: 'Evaluate multiple authorization decisions.' },
  { key: TENANT_MANAGEMENT_PERMISSIONS.institutionTransition, module: 'institution', description: 'Transition an institution lifecycle status.' },
  { key: TENANT_MANAGEMENT_PERMISSIONS.membershipCreate, module: 'membership', description: 'Create tenant memberships.' },
  { key: TENANT_MANAGEMENT_PERMISSIONS.membershipStatusChange, module: 'membership', description: 'Change tenant membership status.' },
  { key: TENANT_MANAGEMENT_PERMISSIONS.invitationCreate, module: 'invitation', description: 'Create tenant invitations.' },
  { key: TENANT_MANAGEMENT_PERMISSIONS.invitationRevoke, module: 'invitation', description: 'Revoke tenant invitations.' },
  { key: ENTITLEMENTS_PERMISSIONS.planList, module: 'plan', description: 'List platform plans.' },
  { key: ENTITLEMENTS_PERMISSIONS.planRead, module: 'plan', description: 'Read platform plan details.' },
  { key: ENTITLEMENTS_PERMISSIONS.planVersionList, module: 'plan', description: 'List platform plan versions.' },
  { key: ENTITLEMENTS_PERMISSIONS.featureList, module: 'feature', description: 'List platform feature definitions.' },
  { key: ENTITLEMENTS_PERMISSIONS.entitlementRead, module: 'entitlement', description: 'Read tenant entitlements.' },
  { key: ENTITLEMENTS_PERMISSIONS.entitlementAssign, module: 'entitlement', description: 'Assign plans to tenants.' },
  { key: ENTITLEMENTS_PERMISSIONS.entitlementOverride, module: 'entitlement', description: 'Manage tenant entitlement overrides.' },
  { key: ENTITLEMENTS_PERMISSIONS.entitlementCheck, module: 'entitlement', description: 'Evaluate tenant feature entitlements.' },
  { key: ENTITLEMENTS_PERMISSIONS.quotaRead, module: 'quota', description: 'Read tenant quota availability.' },
  { key: ENTITLEMENTS_PERMISSIONS.quotaReserve, module: 'quota', description: 'Reserve tenant quota capacity.' },
  { key: ENTITLEMENTS_PERMISSIONS.quotaRelease, module: 'quota', description: 'Release tenant quota reservations.' },
  { key: ENTITLEMENTS_PERMISSIONS.usageList, module: 'usage', description: 'List tenant usage meters.' },
  { key: AUDIT_PERMISSIONS.auditList, module: 'audit', description: 'List tenant audit events.' },
  { key: AUDIT_PERMISSIONS.auditRead, module: 'audit', description: 'Read tenant audit event details.' },
  { key: AUDIT_PERMISSIONS.auditPlatform, module: 'audit', description: 'Read platform audit events.' },
] as const);
