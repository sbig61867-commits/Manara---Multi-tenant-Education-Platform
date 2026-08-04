export interface AuthorizationEventBase {
  readonly type: string;
  readonly occurredAt: Date;
}

export type RoleChangeType = 'created' | 'retired' | 'updated';

export interface RoleChangedEvent extends AuthorizationEventBase {
  readonly type: 'authorization.role.changed';
  readonly roleId: string;
  readonly tenantId: string;
  readonly change: RoleChangeType;
}

export interface PermissionGrantChangedEvent extends AuthorizationEventBase {
  readonly type: 'authorization.permission_grant.changed';
  readonly roleId: string;
  readonly tenantId: string;
  readonly permissionKey: string;
  readonly change: 'granted' | 'revoked';
}

export interface UserRoleChangedEvent extends AuthorizationEventBase {
  readonly type: 'authorization.user_role.changed';
  readonly roleId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly change: 'assigned' | 'revoked';
}

export type AuthorizationEvent =
  | RoleChangedEvent
  | PermissionGrantChangedEvent
  | UserRoleChangedEvent;

export interface AuthorizationEventPublisher {
  publish(event: AuthorizationEvent): Promise<void> | void;
}

export class NoopAuthorizationEventPublisher implements AuthorizationEventPublisher {
  publish(): void {}
}
