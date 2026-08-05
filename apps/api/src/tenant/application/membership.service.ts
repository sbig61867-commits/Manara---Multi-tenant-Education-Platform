import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { encodeCursor } from '../pagination.js';
import {
  InvalidMembershipTransitionError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
} from '../domain/errors.js';
import type { TenantEventPublisher } from '../domain/events.js';
import type { Membership, MembershipStatus } from '../domain/types.js';
import type { MembershipRepository } from '../ports/membership.repository.js';
import type { TenantTransactionRunner } from '../ports/transaction-runner.js';
import { assertSameTenant, requireTenantContext } from '../ports/tenant-context.js';
import type { TenantContextResolver } from '../ports/tenant-context.js';
import {
  MEMBERSHIP_REPOSITORY,
  TENANT_EVENT_PUBLISHER,
  TENANT_TRANSACTION_RUNNER,
  TENANT_CONTEXT_RESOLVER,
} from '../tenant.tokens.js';

export interface CreateMembershipCommand {
  institutionId: string;
  userId: string;
  status?: Exclude<MembershipStatus, 'suspended' | 'ended'>;
}

export interface ChangeMembershipStatusCommand {
  membershipId: string;
  to: MembershipStatus;
}

export interface ListMembershipsCommand {
  institutionId: string;
  limit: number;
  cursor: string | null;
}

export interface MembershipListResult {
  items: Membership[];
  nextCursor: string | null;
}

const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  pending: ['active', 'ended'],
  active: ['inactive', 'suspended', 'ended'],
  inactive: ['active', 'ended'],
  suspended: ['active', 'ended'],
  ended: [],
};

@Injectable()
export class MembershipService {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(TENANT_TRANSACTION_RUNNER) private readonly transactionRunner: TenantTransactionRunner,
    @Inject(TENANT_EVENT_PUBLISHER) private readonly events: TenantEventPublisher,
    @Inject(TENANT_CONTEXT_RESOLVER) private readonly tenantContext: TenantContextResolver,
  ) {}

  async createMembership(command: CreateMembershipCommand): Promise<Membership> {
    const tenantId = requireTenantContext(this.tenantContext);
    assertSameTenant(command.institutionId, tenantId);
    const status = command.status ?? 'active';
    const now = new Date();
    const membership = await this.transactionRunner.runInTransaction(async () => {
      const existing = await this.memberships.findByUserAndInstitution(command.userId, command.institutionId);
      if (existing !== null && existing.status === 'active') {
        throw new MembershipAlreadyExistsError('An active membership already exists for this user and institution');
      }
      const created: Membership = {
        id: randomUUID(),
        institutionId: command.institutionId,
        userId: command.userId,
        status,
        createdAt: now,
        updatedAt: now,
        startedAt: status === 'active' ? now : null,
        endedAt: null,
      };
      await this.memberships.create(created);
      return created;
    });
    await this.events.publish({
      type: 'membership.created',
      occurredAt: now,
      membershipId: membership.id,
      institutionId: command.institutionId,
      userId: command.userId,
      status,
    });
    return membership;
  }

  async changeMembershipStatus(command: ChangeMembershipStatusCommand): Promise<Membership> {
    const tenantId = requireTenantContext(this.tenantContext);
    const membership = await this.memberships.findById(command.membershipId);
    if (membership === null) {
      throw new MembershipNotFoundError('Membership not found');
    }
    assertSameTenant(membership.institutionId, tenantId);
    this.assertAllowedTransition(membership.status, command.to);
    const now = new Date();
    const updated: Membership = {
      ...membership,
      status: command.to,
      updatedAt: now,
      startedAt: command.to === 'active' ? (membership.startedAt ?? now) : membership.startedAt,
      endedAt: command.to === 'ended' ? now : null,
    };
    await this.memberships.update(updated);
    await this.events.publish({
      type: 'membership.status.changed',
      occurredAt: now,
      membershipId: membership.id,
      institutionId: membership.institutionId,
      userId: membership.userId,
      from: membership.status,
      to: command.to,
    });
    return updated;
  }

  async listMemberships(command: ListMembershipsCommand): Promise<MembershipListResult> {
    const tenantId = requireTenantContext(this.tenantContext);
    assertSameTenant(command.institutionId, tenantId);
    const rows = await this.memberships.listByInstitution(command.institutionId, {
      limit: command.limit + 1,
      cursor: command.cursor,
    });
    const items = rows.slice(0, command.limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > command.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  private assertAllowedTransition(from: MembershipStatus, to: MembershipStatus): void {
    if (!MEMBERSHIP_TRANSITIONS[from].includes(to)) {
      throw new InvalidMembershipTransitionError(from, to);
    }
  }
}
