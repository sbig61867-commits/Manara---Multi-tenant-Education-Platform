import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  InvalidReservationOperationError,
  NegativeUsageError,
  PlanVersionNotFoundError,
  QuotaDimensionNotFoundError,
  QuotaExceededError,
  ReservationNotFoundError,
} from '../domain/errors.js';
import type { EntitlementEventPublisher } from '../domain/events.js';
import type {
  EntitlementDecision,
  QuotaAvailability,
  TenantEntitlementSnapshot,
  UsageMeter,
  UsageQuota,
  UsageReservation,
} from '../domain/types.js';
import type { EntitlementsContextResolver } from '../ports/entitlements-context.js';
import { assertSameTenant, requireTenantContext } from '../ports/entitlements-context.js';
import type { FeatureDefinitionRepository } from '../ports/feature-definition.repository.js';
import type { PlanRepository } from '../ports/plan.repository.js';
import type { TenantEntitlementRepository } from '../ports/tenant-entitlement.repository.js';
import type { EntitlementsTransactionRunner } from '../ports/transaction-runner.js';
import type { UsageMeterRepository } from '../ports/usage-meter.repository.js';
import type { UsageQuotaRepository } from '../ports/usage-quota.repository.js';
import {
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_EVENT_PUBLISHER,
  ENTITLEMENTS_TRANSACTION_RUNNER,
  FEATURE_DEFINITION_REPOSITORY,
  PLAN_REPOSITORY,
  TENANT_ENTITLEMENT_REPOSITORY,
  USAGE_METER_REPOSITORY,
  USAGE_QUOTA_REPOSITORY,
} from '../entitlements.tokens.js';

const MONTHLY_WINDOW_DAYS = 30;

export interface EvaluateFeatureCommand {
  featureKey: string;
}

export interface CheckQuotaAvailabilityCommand {
  quotaKey: string;
}

export interface RecordUsageCommand {
  quotaKey: string;
  amount: number;
  operationId?: string | null;
}

export interface ReserveUsageCommand {
  quotaKey: string;
  amount: number;
  operationId?: string | null;
}

export interface ReservationCommand {
  reservationId: string;
}

@Injectable()
export class EntitlementEvaluationService {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    @Inject(FEATURE_DEFINITION_REPOSITORY) private readonly features: FeatureDefinitionRepository,
    @Inject(TENANT_ENTITLEMENT_REPOSITORY) private readonly tenantState: TenantEntitlementRepository,
    @Inject(USAGE_QUOTA_REPOSITORY) private readonly quotas: UsageQuotaRepository,
    @Inject(USAGE_METER_REPOSITORY) private readonly meters: UsageMeterRepository,
    @Inject(ENTITLEMENTS_TRANSACTION_RUNNER)
    private readonly transactionRunner: EntitlementsTransactionRunner,
    @Inject(ENTITLEMENTS_EVENT_PUBLISHER) private readonly events: EntitlementEventPublisher,
    @Inject(ENTITLEMENTS_CONTEXT_RESOLVER)
    private readonly contextResolver: EntitlementsContextResolver,
  ) {}

  async resolveTenantSnapshot(): Promise<TenantEntitlementSnapshot> {
    const tenantId = requireTenantContext(this.contextResolver);
    const assignment = await this.tenantState.findActiveAssignmentByTenant(tenantId);
    if (assignment === null) {
      return this.emptySnapshot(tenantId);
    }
    const plan = await this.plans.findById(assignment.planId);
    if (plan === null || plan.currentVersionId === null) {
      return this.emptySnapshot(tenantId);
    }
    const version = await this.plans.findVersionById(plan.currentVersionId);
    if (version === null) {
      throw new PlanVersionNotFoundError('The current plan version is missing');
    }
    const entitlements = await this.plans.listFeatureEntitlementsByVersion(version.id);
    const definitions = await this.features.list();
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const overrides = await this.tenantState.listOverridesByTenant(tenantId);
    const overrideByKey = new Map(overrides.map((override) => [override.featureKey, override]));

    const featureFlags: Record<string, boolean> = {};
    const quotaLimits: Record<string, number | null> = {};
    for (const entitlement of [...entitlements].sort((a, b) => a.featureKey.localeCompare(b.featureKey))) {
      const definition = definitionByKey.get(entitlement.featureKey);
      const hardRestricted = definition?.hardRestriction === 'blocked';
      const override = overrideByKey.get(entitlement.featureKey);
      featureFlags[entitlement.featureKey] = hardRestricted ? false : (override?.enabled ?? entitlement.enabled);
      if (entitlement.quotaKey !== null && !hardRestricted) {
        quotaLimits[entitlement.quotaKey] = entitlement.quotaLimit;
      }
    }

    return {
      tenantId,
      planId: plan.id,
      planName: plan.name,
      planVersionId: version.id,
      planVersionNumber: version.version,
      featureFlags,
      quotaLimits,
      generatedAt: new Date(),
    };
  }

  async evaluateFeature(command: EvaluateFeatureCommand): Promise<EntitlementDecision> {
    const tenantId = requireTenantContext(this.contextResolver);
    const definition = await this.features.findByKey(command.featureKey);
    if (definition !== null && definition.hardRestriction === 'blocked') {
      return {
        tenantId,
        featureKey: command.featureKey,
        allowed: false,
        reason: 'denied_hard_restricted',
        source: null,
      };
    }
    const snapshot = await this.resolveTenantSnapshot();
    const enabled = snapshot.featureFlags[command.featureKey] === true;
    const override = await this.tenantState.findOverride(tenantId, command.featureKey);
    return {
      tenantId,
      featureKey: command.featureKey,
      allowed: enabled,
      reason: enabled ? 'allowed' : 'denied_no_entitlement',
      source: enabled ? (override !== null ? 'override' : 'plan') : null,
    };
  }

  async checkQuotaAvailability(command: CheckQuotaAvailabilityCommand): Promise<QuotaAvailability> {
    const tenantId = requireTenantContext(this.contextResolver);
    const snapshot = await this.resolveTenantSnapshot();
    if (!(command.quotaKey in snapshot.quotaLimits)) {
      throw new QuotaDimensionNotFoundError(
        `Quota dimension ${command.quotaKey} is not entitled for this tenant`,
      );
    }
    const limit = snapshot.quotaLimits[command.quotaKey] ?? null;
    const quota = await this.quotas.findByTenantAndKey(tenantId, command.quotaKey);
    const consumed = quota?.consumed ?? 0;
    const reserved = quota?.reserved ?? 0;
    return {
      quotaKey: command.quotaKey,
      tenantId,
      limit,
      consumed,
      reserved,
      available: limit === null ? null : Math.max(0, limit - consumed - reserved),
    };
  }

  async recordUsage(command: RecordUsageCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    this.assertPositiveAmount(command.amount);
    await this.transactionRunner.runInTransaction(async () => {
      const quota = await this.getOrCreateQuotaInTransaction(tenantId, command.quotaKey);
      if (quota.limit !== null && quota.consumed + command.amount > quota.limit) {
        await this.publishQuotaExceeded(tenantId, command.quotaKey, command.amount, quota);
        throw new QuotaExceededError(
          `Usage of ${command.amount} exceeds the remaining quota for ${command.quotaKey}`,
        );
      }
      const updated: UsageQuota = {
        ...quota,
        consumed: quota.consumed + command.amount,
        updatedAt: new Date(),
      };
      await this.quotas.update(updated);
      await this.recordMeter(tenantId, command.quotaKey, command.amount, 'consumed', command.operationId ?? null);
    });
  }

  async reserveUsage(command: ReserveUsageCommand): Promise<UsageReservation> {
    const tenantId = requireTenantContext(this.contextResolver);
    this.assertPositiveAmount(command.amount);
    const reservationId = randomUUID();
    await this.transactionRunner.runInTransaction(async () => {
      const quota = await this.getOrCreateQuotaInTransaction(tenantId, command.quotaKey);
      if (quota.limit !== null && quota.consumed + quota.reserved + command.amount > quota.limit) {
        await this.publishQuotaExceeded(tenantId, command.quotaKey, command.amount, quota);
        throw new QuotaExceededError(
          `Reserving ${command.amount} would exceed the quota for ${command.quotaKey}`,
        );
      }
      const updated: UsageQuota = {
        ...quota,
        reserved: quota.reserved + command.amount,
        updatedAt: new Date(),
      };
      await this.quotas.update(updated);
      await this.recordMeter(tenantId, command.quotaKey, command.amount, 'reserved', command.operationId ?? null, reservationId);
    });
    return {
      reservationId,
      quotaKey: command.quotaKey,
      tenantId,
      amount: command.amount,
    };
  }

  async commitReservation(command: ReservationCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    await this.transactionRunner.runInTransaction(async () => {
      const meter = await this.requireReservedMeter(command.reservationId, tenantId);
      const quota = await this.quotas.findByTenantAndKey(tenantId, meter.quotaKey);
      if (quota === null) {
        throw new ReservationNotFoundError('The reservation has no quota state');
      }
      const updated: UsageQuota = {
        ...quota,
        consumed: quota.consumed + meter.amount,
        reserved: quota.reserved - meter.amount,
        updatedAt: new Date(),
      };
      await this.quotas.update(updated);
      await this.meters.update({ ...meter, kind: 'committed' });
      await this.publishUsageRecorded(tenantId, meter.quotaKey, meter.amount, 'committed');
    });
  }

  async releaseReservation(command: ReservationCommand): Promise<void> {
    const tenantId = requireTenantContext(this.contextResolver);
    await this.transactionRunner.runInTransaction(async () => {
      const meter = await this.requireReservedMeter(command.reservationId, tenantId);
      const quota = await this.quotas.findByTenantAndKey(tenantId, meter.quotaKey);
      if (quota === null) {
        throw new ReservationNotFoundError('The reservation has no quota state');
      }
      const updated: UsageQuota = {
        ...quota,
        reserved: quota.reserved - meter.amount,
        updatedAt: new Date(),
      };
      await this.quotas.update(updated);
      await this.meters.update({ ...meter, kind: 'released' });
      await this.publishUsageRecorded(tenantId, meter.quotaKey, meter.amount, 'released');
    });
  }

  async listUsageMeters(): Promise<UsageMeter[]> {
    const tenantId = requireTenantContext(this.contextResolver);
    return this.meters.listByTenant(tenantId);
  }

  private async requireReservedMeter(reservationId: string, tenantId: string): Promise<UsageMeter> {
    const meter = await this.meters.findById(reservationId);
    if (meter === null) {
      throw new ReservationNotFoundError('The reservation does not exist');
    }
    assertSameTenant(meter.tenantId, tenantId);
    if (meter.kind !== 'reserved') {
      throw new InvalidReservationOperationError(
        'Only a pending reservation can be committed or released',
      );
    }
    return meter;
  }

  private async getOrCreateQuotaInTransaction(tenantId: string, quotaKey: string): Promise<UsageQuota> {
    const limit = await this.resolveQuotaLimit(tenantId, quotaKey);
    const existing = await this.quotas.findByTenantAndKey(tenantId, quotaKey);
    const now = new Date();
    if (existing === null) {
      const created: UsageQuota = {
        id: randomUUID(),
        tenantId,
        quotaKey,
        period: 'monthly',
        limit,
        consumed: 0,
        reserved: 0,
        periodStart: now,
        periodEnd: new Date(now.getTime() + MONTHLY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        updatedAt: now,
      };
      await this.quotas.create(created);
      return created;
    }
    if (existing.periodEnd !== null && now.getTime() > existing.periodEnd.getTime()) {
      const rolled: UsageQuota = {
        ...existing,
        limit,
        consumed: 0,
        reserved: 0,
        periodStart: now,
        periodEnd: new Date(now.getTime() + MONTHLY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        updatedAt: now,
      };
      await this.quotas.update(rolled);
      return rolled;
    }
    return existing;
  }

  private async resolveQuotaLimit(tenantId: string, quotaKey: string): Promise<number | null> {
    const snapshot = await this.resolveTenantSnapshot();
    if (!(quotaKey in snapshot.quotaLimits)) {
      throw new QuotaDimensionNotFoundError(
        `Quota dimension ${quotaKey} is not entitled for this tenant`,
      );
    }
    return snapshot.quotaLimits[quotaKey] ?? null;
  }

  private async recordMeter(
    tenantId: string,
    quotaKey: string,
    amount: number,
    kind: UsageMeter['kind'],
    operationId: string | null,
    id?: string,
  ): Promise<void> {
    const meter: UsageMeter = {
      id: id ?? randomUUID(),
      tenantId,
      quotaKey,
      amount,
      kind,
      operationId,
      recordedAt: new Date(),
    };
    await this.meters.record(meter);
    await this.publishUsageRecorded(tenantId, quotaKey, amount, kind);
  }

  private async publishUsageRecorded(
    tenantId: string,
    quotaKey: string,
    amount: number,
    kind: UsageMeter['kind'],
  ): Promise<void> {
    await this.events.publish({
      type: 'entitlement.usage.recorded',
      occurredAt: new Date(),
      tenantId,
      quotaKey,
      amount,
      kind,
    });
  }

  private async publishQuotaExceeded(
    tenantId: string,
    quotaKey: string,
    requested: number,
    quota: UsageQuota,
  ): Promise<void> {
    await this.events.publish({
      type: 'entitlement.quota.exceeded',
      occurredAt: new Date(),
      tenantId,
      quotaKey,
      requested,
      available: quota.limit === null ? null : Math.max(0, quota.limit - quota.consumed - quota.reserved),
    });
  }

  private assertPositiveAmount(amount: number): void {
    if (amount <= 0) {
      throw new NegativeUsageError('Usage amounts must be positive');
    }
  }

  private emptySnapshot(tenantId: string): TenantEntitlementSnapshot {
    return {
      tenantId,
      planId: null,
      planName: null,
      planVersionId: null,
      planVersionNumber: null,
      featureFlags: {},
      quotaLimits: {},
      generatedAt: new Date(),
    };
  }
}
