import type { MembershipStatus, TenantStatus } from './types.js';

export interface TenantEventBase {
  readonly type: string;
  readonly occurredAt: Date;
}

export interface TenantCreatedEvent extends TenantEventBase {
  readonly type: 'tenant.created';
  readonly institutionId: string;
  readonly name: string;
  readonly createdByUserId: string;
}

export interface TenantStatusChangedEvent extends TenantEventBase {
  readonly type: 'tenant.status.changed';
  readonly institutionId: string;
  readonly from: TenantStatus;
  readonly to: TenantStatus;
  readonly actorUserId: string;
  readonly reason?: string;
}

export interface MembershipCreatedEvent extends TenantEventBase {
  readonly type: 'membership.created';
  readonly membershipId: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
}

export interface MembershipStatusChangedEvent extends TenantEventBase {
  readonly type: 'membership.status.changed';
  readonly membershipId: string;
  readonly institutionId: string;
  readonly userId: string;
  readonly from: MembershipStatus;
  readonly to: MembershipStatus;
}

export interface InvitationCreatedEvent extends TenantEventBase {
  readonly type: 'invitation.created';
  readonly invitationId: string;
  readonly institutionId: string;
  readonly expiresAt: Date;
}

export interface InvitationAcceptedEvent extends TenantEventBase {
  readonly type: 'invitation.accepted';
  readonly invitationId: string;
  readonly institutionId: string;
  readonly userId: string;
}

export interface InvitationRevokedEvent extends TenantEventBase {
  readonly type: 'invitation.revoked';
  readonly invitationId: string;
  readonly institutionId: string;
}

export interface InvitationExpiredEvent extends TenantEventBase {
  readonly type: 'invitation.expired';
  readonly invitationId: string;
  readonly institutionId: string;
}

export type TenantEvent =
  | TenantCreatedEvent
  | TenantStatusChangedEvent
  | MembershipCreatedEvent
  | MembershipStatusChangedEvent
  | InvitationCreatedEvent
  | InvitationAcceptedEvent
  | InvitationRevokedEvent
  | InvitationExpiredEvent;

export interface TenantEventPublisher {
  publish(event: TenantEvent): Promise<void> | void;
}

export class NoopTenantEventPublisher implements TenantEventPublisher {
  publish(): void {}
}
