export interface EntitlementEventBase {
  readonly type: string;
  readonly occurredAt: Date;
}

export interface PlanCreatedEvent extends EntitlementEventBase {
  readonly type: 'entitlement.plan.created';
  readonly planId: string;
  readonly name: string;
}

export interface PlanRetiredEvent extends EntitlementEventBase {
  readonly type: 'entitlement.plan.retired';
  readonly planId: string;
}

export interface PlanVersionActivatedEvent extends EntitlementEventBase {
  readonly type: 'entitlement.plan_version.activated';
  readonly planId: string;
  readonly planVersionId: string;
  readonly version: number;
}

export interface PlanAssignedEvent extends EntitlementEventBase {
  readonly type: 'entitlement.plan.assigned';
  readonly tenantId: string;
  readonly planId: string;
  readonly planVersionId: string;
}

export interface FeatureOverrideChangedEvent extends EntitlementEventBase {
  readonly type: 'entitlement.override.changed';
  readonly tenantId: string;
  readonly featureKey: string;
  readonly enabled: boolean;
}

export interface UsageRecordedEvent extends EntitlementEventBase {
  readonly type: 'entitlement.usage.recorded';
  readonly tenantId: string;
  readonly quotaKey: string;
  readonly amount: number;
  readonly kind: 'consumed' | 'reserved' | 'committed' | 'released';
}

export interface QuotaExceededEvent extends EntitlementEventBase {
  readonly type: 'entitlement.quota.exceeded';
  readonly tenantId: string;
  readonly quotaKey: string;
  readonly requested: number;
  readonly available: number | null;
}

export type EntitlementEvent =
  | PlanCreatedEvent
  | PlanRetiredEvent
  | PlanVersionActivatedEvent
  | PlanAssignedEvent
  | FeatureOverrideChangedEvent
  | UsageRecordedEvent
  | QuotaExceededEvent;

export interface EntitlementEventPublisher {
  publish(event: EntitlementEvent): Promise<void> | void;
}

export class NoopEntitlementEventPublisher implements EntitlementEventPublisher {
  publish(): void {}
}
