import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CrossTenantReadDeniedError,
  InvalidAuditEventError,
  InvalidAuditQueryError,
  TenantContextMismatchError,
} from '../domain/errors.js';
import type {
  AuditActor,
  AuditEvent,
  AuditMetadataValue,
  AuditQueryCriteria,
  AuditScope,
  AuditTarget,
} from '../domain/types.js';
import type { AuditContextResolver } from '../ports/audit-context.js';
import { requireAuditTenantContext } from '../ports/audit-context.js';
import type { AuditRepository } from '../ports/audit.repository.js';
import { AUDIT_CONTEXT_RESOLVER, AUDIT_REPOSITORY } from '../audit.tokens.js';
import { redactAuditMetadata } from './redaction.js';

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ACTION_LENGTH = 200;
const MAX_ID_LENGTH = 128;
const MAX_ENTITY_TYPE_LENGTH = 64;
const MAX_REASON_LENGTH = 2000;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_VALUE_LENGTH = 4000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;

export interface AuditRecordingCommand {
  action: string;
  actor: AuditActor;
  target: AuditTarget;
  reason?: string | null;
  requestId?: string | null;
  occurredAt?: Date;
  metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

export interface RecordAuditEventCommand extends AuditRecordingCommand {
  scope: AuditScope;
  tenantId?: string | null;
}

export type RecordTenantActionCommand = AuditRecordingCommand;

export interface RecordPlatformActionCommand extends AuditRecordingCommand {
  reason: string;
}

export interface RecordCrossTenantActionCommand extends AuditRecordingCommand {
  targetTenantId: string;
  reason: string;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function deepFreeze<T extends object>(value: T): T {
  for (const entry of Object.values(value)) {
    if (entry !== null && typeof entry === 'object') {
      deepFreeze(entry);
    }
  }
  return Object.freeze(value);
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
    @Inject(AUDIT_CONTEXT_RESOLVER) private readonly contextResolver: AuditContextResolver,
  ) {}

  async record(command: RecordAuditEventCommand): Promise<AuditEvent> {
    if (command.scope !== 'tenant' && command.scope !== 'platform' && command.scope !== 'cross_tenant') {
      throw new InvalidAuditEventError('Audit scope must be tenant, platform, or cross_tenant');
    }
    const event = await this.buildEvent(command.scope, command);
    await this.repository.append(event);
    return event;
  }

  async recordTenantAction(command: RecordTenantActionCommand): Promise<AuditEvent> {
    const event = await this.buildEvent('tenant', command);
    await this.repository.append(event);
    return event;
  }

  async recordPlatformAction(command: RecordPlatformActionCommand): Promise<AuditEvent> {
    const event = await this.buildEvent('platform', command);
    await this.repository.append(event);
    return event;
  }

  async recordCrossTenantAction(command: RecordCrossTenantActionCommand): Promise<AuditEvent> {
    const event = await this.buildEvent('cross_tenant', {
      ...command,
      tenantId: command.targetTenantId,
    });
    await this.repository.append(event);
    return event;
  }

  async queryAuditHistory(criteria: AuditQueryCriteria): Promise<AuditEvent[]> {
    const tenantId = requireAuditTenantContext(this.contextResolver);
    const scope = criteria.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform' && scope !== 'cross_tenant') {
      throw new InvalidAuditQueryError('Audit query scope must be tenant, platform, or cross_tenant');
    }
    if (scope !== 'tenant') {
      throw new CrossTenantReadDeniedError('Cross-tenant audit reads are denied by default');
    }
    if (criteria.tenantId !== undefined && criteria.tenantId !== tenantId) {
      throw new CrossTenantReadDeniedError('Cross-tenant audit reads are denied by default');
    }
    this.assertValidCriteriaStrings(criteria);
    if (criteria.from !== undefined && !this.isValidDate(criteria.from)) {
      throw new InvalidAuditQueryError('Audit query from date must be a valid date');
    }
    if (criteria.to !== undefined && !this.isValidDate(criteria.to)) {
      throw new InvalidAuditQueryError('Audit query to date must be a valid date');
    }
    if (
      criteria.from !== undefined &&
      criteria.to !== undefined &&
      criteria.from.getTime() > criteria.to.getTime()
    ) {
      throw new InvalidAuditQueryError('Audit query from date must not be after the to date');
    }
    const limit = criteria.limit ?? DEFAULT_QUERY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
      throw new InvalidAuditQueryError('Audit query limit must be an integer between 1 and 1000');
    }
    const events = await this.repository.query({
      ...criteria,
      scope: 'tenant',
      tenantId,
      limit,
    });
    return events.map(deepFreeze);
  }

  private async buildEvent(
    scope: AuditScope,
    input: AuditRecordingCommand & { tenantId?: string | null },
  ): Promise<AuditEvent> {
    if (!isNonEmptyString(input.action)) {
      throw new InvalidAuditEventError('Audit action is required and must be a non-empty string');
    }
    if (input.action.length > MAX_ACTION_LENGTH) {
      throw new InvalidAuditEventError('Audit action exceeds the maximum allowed length');
    }
    this.assertValidActor(input.actor);
    this.assertValidTarget(input.target);

    let tenantId: string | null;
    if (scope === 'tenant') {
      tenantId = requireAuditTenantContext(this.contextResolver);
      if (input.tenantId !== undefined && input.tenantId !== null && input.tenantId !== tenantId) {
        throw new TenantContextMismatchError('Audit tenant scope must match the ambient tenant context');
      }
    } else if (scope === 'platform') {
      if (input.tenantId !== undefined && input.tenantId !== null) {
        throw new InvalidAuditEventError('Platform-scoped audit events must not carry a tenant id');
      }
      tenantId = null;
    } else {
      if (!isNonEmptyString(input.tenantId)) {
        throw new InvalidAuditEventError('Cross-tenant audit events require a target tenant id');
      }
      if (input.tenantId.length > MAX_ID_LENGTH) {
        throw new InvalidAuditEventError('Audit target tenant id exceeds the maximum allowed length');
      }
      tenantId = input.tenantId;
    }

    const reason: string | null = input.reason ?? null;
    if (scope !== 'tenant') {
      if (!isNonEmptyString(reason)) {
        throw new InvalidAuditEventError('Privileged audit events require a recorded reason');
      }
      if (reason.length > MAX_REASON_LENGTH) {
        throw new InvalidAuditEventError('Audit reason exceeds the maximum allowed length');
      }
    } else if (reason !== null && reason.length > MAX_REASON_LENGTH) {
      throw new InvalidAuditEventError('Audit reason exceeds the maximum allowed length');
    }

    const context = this.contextResolver.resolveAuditContext();
    const requestId = input.requestId ?? context.requestId ?? randomUUID();
    if (!isNonEmptyString(requestId) || requestId.length > MAX_REQUEST_ID_LENGTH) {
      throw new InvalidAuditEventError('Audit request id must be a valid server-side identifier');
    }

    const occurredAt = input.occurredAt ?? new Date();
    if (!this.isValidDate(occurredAt)) {
      throw new InvalidAuditEventError('Audit timestamp must be a valid date');
    }

    const metadata = redactAuditMetadata(input.metadata ?? {});
    if (Object.keys(metadata).length > MAX_METADATA_ENTRIES) {
      throw new InvalidAuditEventError('Audit metadata exceeds the maximum allowed number of fields');
    }
    for (const value of Object.values(metadata)) {
      if (typeof value === 'string' && value.length > MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidAuditEventError('Audit metadata value exceeds the maximum allowed length');
      }
    }

    const event: AuditEvent = {
      id: randomUUID(),
      scope,
      tenantId,
      actor: input.actor,
      target: input.target,
      action: input.action,
      reason,
      requestId,
      occurredAt,
      metadata,
    };
    return deepFreeze(event);
  }

  private assertValidActor(actor: AuditActor): void {
    if (actor === null || typeof actor !== 'object') {
      throw new InvalidAuditEventError('Audit actor is required');
    }
    if (actor.type !== 'user' && actor.type !== 'system') {
      throw new InvalidAuditEventError('Audit actor type must be user or system');
    }
    if (!isNonEmptyString(actor.id) || actor.id.length > MAX_ID_LENGTH) {
      throw new InvalidAuditEventError('Audit actor id is required and must be a non-empty string');
    }
  }

  private assertValidTarget(target: AuditTarget): void {
    if (target === null || typeof target !== 'object') {
      throw new InvalidAuditEventError('Audit target is required');
    }
    if (!isNonEmptyString(target.type) || target.type.length > MAX_ENTITY_TYPE_LENGTH) {
      throw new InvalidAuditEventError('Audit target type is required and must be a non-empty string');
    }
    if (!isNonEmptyString(target.id) || target.id.length > MAX_ID_LENGTH) {
      throw new InvalidAuditEventError('Audit target id is required and must be a non-empty string');
    }
  }

  private assertValidCriteriaStrings(criteria: AuditQueryCriteria): void {
    for (const field of [criteria.actorId, criteria.action, criteria.targetType, criteria.targetId]) {
      if (field !== undefined && !isNonEmptyString(field)) {
        throw new InvalidAuditQueryError('Audit query filters must be non-empty strings when provided');
      }
    }
  }

  private isValidDate(value: Date): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }
}
