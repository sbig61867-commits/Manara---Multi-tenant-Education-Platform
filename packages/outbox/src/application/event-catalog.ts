export type OutboxEventCatalogPolicy = 'open' | 'strict';

export type OutboxEventTypeClassification = 'with-destination' | 'without-destination' | 'undeclared';

/**
 * Single source of truth for every outbox event type the platform emits.
 *
 * The worker (dispatch side) and the API (enqueue side) both import this
 * catalog, so an event type cannot be enqueued on one side and unknown on the
 * other. Each emitted type is classified exactly once:
 * - `with-destination`: a real dispatcher is registered in the worker,
 * - `without-destination`: explicitly declared as having no delivery target
 *   yet; enqueueing it would guarantee a dead letter, so strict enqueues are
 *   rejected,
 * - anything else is undeclared and treated as a misconfiguration.
 */
export const OUTBOX_EVENT_TYPES: readonly string[] = [
  'tenant.created',
  'tenant.status.changed',
  'membership.created',
  'membership.status.changed',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
  'invitation.expired',
  'user.registered',
  'password.identity.attached',
  'user.password.reset',
  'session.created',
  'session.revoked',
  'session.revoked.all',
  'authorization.role.changed',
  'authorization.permission_grant.changed',
  'authorization.user_role.changed',
  'entitlement.plan.created',
  'entitlement.plan.retired',
  'entitlement.plan_version.activated',
  'entitlement.plan.assigned',
  'entitlement.override.changed',
  'entitlement.usage.recorded',
  'entitlement.quota.exceeded',
];

/** Event types explicitly declared as having no delivery target yet. */
export const OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION: readonly string[] = [
  ...OUTBOX_EVENT_TYPES,
];

export function classifyOutboxEventType(eventType: string): OutboxEventTypeClassification {
  if (!OUTBOX_EVENT_TYPES.includes(eventType)) {
    return 'undeclared';
  }
  return OUTBOX_EVENT_TYPES_WITHOUT_DESTINATION.includes(eventType)
    ? 'without-destination'
    : 'with-destination';
}
