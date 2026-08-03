export interface IdentityEventBase {
  readonly type: string;
  readonly occurredAt: Date;
  readonly userId: string;
}

export interface UserRegisteredEvent extends IdentityEventBase {
  readonly type: 'user.registered';
  readonly email: string;
}

export interface PasswordIdentityAttachedEvent extends IdentityEventBase {
  readonly type: 'password.identity.attached';
}

export interface UserPasswordResetEvent extends IdentityEventBase {
  readonly type: 'user.password.reset';
}

export interface SessionCreatedEvent extends IdentityEventBase {
  readonly type: 'session.created';
  readonly sessionId: string;
}

export interface SessionRevokedEvent extends IdentityEventBase {
  readonly type: 'session.revoked';
  readonly sessionId: string;
}

export interface SessionsRevokedAllEvent extends IdentityEventBase {
  readonly type: 'session.revoked.all';
  readonly count: number;
}

export type IdentityEvent =
  | UserRegisteredEvent
  | PasswordIdentityAttachedEvent
  | UserPasswordResetEvent
  | SessionCreatedEvent
  | SessionRevokedEvent
  | SessionsRevokedAllEvent;

export interface IdentityEventPublisher {
  publish(event: IdentityEvent): Promise<void> | void;
}

export class NoopIdentityEventPublisher implements IdentityEventPublisher {
  publish(): void {}
}
