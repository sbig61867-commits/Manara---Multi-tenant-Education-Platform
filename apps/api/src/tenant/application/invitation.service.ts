import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { encodeCursor } from '../pagination.js';
import {
  InvitationAcceptanceRejectedError,
  InvitationAlreadyHandledError,
  InvitationNotFoundError,
  MembershipAlreadyActiveError,
} from '../domain/errors.js';
import type { TenantEventPublisher } from '../domain/events.js';
import type { Invitation, Membership, MembershipStatus } from '../domain/types.js';
import type { InvitationRepository } from '../ports/invitation.repository.js';
import type { MembershipRepository } from '../ports/membership.repository.js';
import type { TenantTransactionRunner } from '../ports/transaction-runner.js';
import { assertSameTenant, requireTenantContext } from '../ports/tenant-context.js';
import type { TenantContextResolver } from '../ports/tenant-context.js';
import type { TokenHasher } from '../token-hasher.js';
import {
  INVITATION_REPOSITORY,
  INVITATION_TOKEN_HASHER,
  MEMBERSHIP_REPOSITORY,
  TENANT_EVENT_PUBLISHER,
  TENANT_TRANSACTION_RUNNER,
  TENANT_CONTEXT_RESOLVER,
} from '../tenant.tokens.js';

export interface CreateInvitationCommand {
  institutionId: string;
  expiresAt: Date;
  createdByUserId: string;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  rawToken: string;
}

export interface AcceptInvitationCommand {
  rawToken: string;
  userId: string;
}

export interface InvitationIdCommand {
  invitationId: string;
}

export interface AcceptanceOutcome {
  invitation: Invitation;
  membership: Membership;
  activated: boolean;
  previousStatus: MembershipStatus | null;
}

export interface ListInvitationsCommand {
  institutionId: string;
  limit: number;
  cursor: string | null;
}

export interface InvitationListResult {
  items: Invitation[];
  nextCursor: string | null;
}

@Injectable()
export class InvitationService {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(INVITATION_TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(TENANT_TRANSACTION_RUNNER) private readonly transactionRunner: TenantTransactionRunner,
    @Inject(TENANT_EVENT_PUBLISHER) private readonly events: TenantEventPublisher,
    @Inject(TENANT_CONTEXT_RESOLVER) private readonly tenantContext: TenantContextResolver,
  ) {}

  async createInvitation(command: CreateInvitationCommand): Promise<CreateInvitationResult> {
    const tenantId = requireTenantContext(this.tenantContext);
    assertSameTenant(command.institutionId, tenantId);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = await this.tokenHasher.hash(rawToken);
    const now = new Date();
    const invitation: Invitation = {
      id: randomUUID(),
      institutionId: command.institutionId,
      tokenHash,
      status: 'pending',
      expiresAt: command.expiresAt,
      createdAt: now,
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
    };
    await this.invitations.create(invitation);
    await this.events.publish({
      type: 'invitation.created',
      occurredAt: now,
      invitationId: invitation.id,
      institutionId: invitation.institutionId,
      expiresAt: invitation.expiresAt,
    });
    return { invitation, rawToken };
  }

  async acceptInvitation(command: AcceptInvitationCommand): Promise<AcceptanceOutcome> {
    const tenantId = requireTenantContext(this.tenantContext);
    const tokenHash = await this.tokenHasher.hash(command.rawToken);
    const outcome = await this.transactionRunner.runInTransaction(async () => {
      const invitation = await this.invitations.findByTokenHash(tokenHash);
      if (invitation === null) {
        throw new InvitationAcceptanceRejectedError('Invitation cannot be accepted');
      }
      assertSameTenant(invitation.institutionId, tenantId);
      this.assertAcceptable(invitation);
      const existing = await this.memberships.findByUserAndInstitution(command.userId, invitation.institutionId);
      let membership: Membership;
      let activated = false;
      let previousStatus: MembershipStatus | null = null;
      if (existing === null) {
        membership = this.createMembershipForAcceptance(command.userId, invitation.institutionId);
        await this.memberships.create(membership);
      } else {
        if (existing.status === 'active') {
          throw new MembershipAlreadyActiveError('The user already has an active membership in this institution');
        }
        previousStatus = existing.status;
        membership = this.activateMembership(existing);
        activated = true;
        await this.memberships.update(membership);
      }
      const now = new Date();
      const acceptedInvitation: Invitation = {
        ...invitation,
        status: 'accepted',
        acceptedByUserId: command.userId,
        acceptedAt: now,
      };
      await this.invitations.update(acceptedInvitation);
      return { invitation: acceptedInvitation, membership, activated, previousStatus };
    });
    await this.events.publish({
      type: 'invitation.accepted',
      occurredAt: new Date(),
      invitationId: outcome.invitation.id,
      institutionId: outcome.invitation.institutionId,
      userId: command.userId,
    });
    if (outcome.activated && outcome.previousStatus !== null) {
      await this.events.publish({
        type: 'membership.status.changed',
        occurredAt: new Date(),
        membershipId: outcome.membership.id,
        institutionId: outcome.membership.institutionId,
        userId: outcome.membership.userId,
        from: outcome.previousStatus,
        to: 'active',
      });
    } else {
      await this.events.publish({
        type: 'membership.created',
        occurredAt: new Date(),
        membershipId: outcome.membership.id,
        institutionId: outcome.membership.institutionId,
        userId: outcome.membership.userId,
        status: 'active',
      });
    }
    return outcome;
  }

  async revokeInvitation(command: InvitationIdCommand): Promise<Invitation> {
    return this.handleInvitation(command.invitationId, 'revoked');
  }

  async listInvitations(command: ListInvitationsCommand): Promise<InvitationListResult> {
    const tenantId = requireTenantContext(this.tenantContext);
    assertSameTenant(command.institutionId, tenantId);
    const rows = await this.invitations.listByInstitution(command.institutionId, {
      limit: command.limit + 1,
      cursor: command.cursor,
    });
    const items = rows.slice(0, command.limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > command.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  async expireInvitation(command: InvitationIdCommand): Promise<Invitation> {
    return this.handleInvitation(command.invitationId, 'expired');
  }

  private async handleInvitation(invitationId: string, to: 'revoked' | 'expired'): Promise<Invitation> {
    const tenantId = requireTenantContext(this.tenantContext);
    const invitation = await this.invitations.findById(invitationId);
    if (invitation === null) {
      throw new InvitationNotFoundError('Invitation not found');
    }
    assertSameTenant(invitation.institutionId, tenantId);
    if (invitation.status === to) {
      return invitation;
    }
    if (invitation.status !== 'pending') {
      throw new InvitationAlreadyHandledError(`Invitation is already ${invitation.status}`);
    }
    const now = new Date();
    const updated: Invitation = {
      ...invitation,
      status: to,
      revokedAt: to === 'revoked' ? now : invitation.revokedAt,
    };
    await this.invitations.update(updated);
    await this.events.publish(
      to === 'revoked'
        ? { type: 'invitation.revoked', occurredAt: now, invitationId: invitation.id, institutionId: invitation.institutionId }
        : { type: 'invitation.expired', occurredAt: now, invitationId: invitation.id, institutionId: invitation.institutionId },
    );
    return updated;
  }

  private assertAcceptable(invitation: Invitation): void {
    if (invitation.status !== 'pending') {
      throw new InvitationAcceptanceRejectedError('Invitation cannot be accepted');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new InvitationAcceptanceRejectedError('Invitation cannot be accepted');
    }
  }

  private createMembershipForAcceptance(userId: string, institutionId: string): Membership {
    const now = new Date();
    return {
      id: randomUUID(),
      institutionId,
      userId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      endedAt: null,
    };
  }

  private activateMembership(membership: Membership): Membership {
    const now = new Date();
    return {
      ...membership,
      status: 'active',
      updatedAt: now,
      startedAt: membership.startedAt ?? now,
      endedAt: null,
    };
  }
}
