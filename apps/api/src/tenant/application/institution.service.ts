import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DeletedInstitutionError, InstitutionNotFoundError, InvalidLifecycleTransitionError } from '../domain/errors.js';
import type { TenantEventPublisher } from '../domain/events.js';
import type { Institution, InstitutionSettings, InstitutionType, TenantStatus } from '../domain/types.js';
import type { InstitutionSettingsRepository } from '../ports/institution-settings.repository.js';
import type { InstitutionRepository } from '../ports/institution.repository.js';
import type { TenantTransactionRunner } from '../ports/transaction-runner.js';
import {
  INSTITUTION_REPOSITORY,
  INSTITUTION_SETTINGS_REPOSITORY,
  TENANT_EVENT_PUBLISHER,
  TENANT_TRANSACTION_RUNNER,
} from '../tenant.tokens.js';

export interface CreateInstitutionCommand {
  name: string;
  type: InstitutionType;
  createdByUserId: string;
}

export interface GetInstitutionCommand {
  institutionId: string;
}

export interface LifecycleTransitionCommand {
  institutionId: string;
  actorUserId: string;
  reason?: string;
}

const LIFECYCLE_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  draft: ['active'],
  active: ['suspended'],
  suspended: ['active', 'grace_period'],
  grace_period: ['active', 'archived'],
  archived: ['deleted'],
  deleted: [],
};

@Injectable()
export class InstitutionService {
  constructor(
    @Inject(INSTITUTION_REPOSITORY) private readonly institutions: InstitutionRepository,
    @Inject(INSTITUTION_SETTINGS_REPOSITORY) private readonly settings: InstitutionSettingsRepository,
    @Inject(TENANT_TRANSACTION_RUNNER) private readonly transactionRunner: TenantTransactionRunner,
    @Inject(TENANT_EVENT_PUBLISHER) private readonly events: TenantEventPublisher,
  ) {}

  async createInstitution(command: CreateInstitutionCommand): Promise<Institution> {
    const now = new Date();
    const institution: Institution = {
      id: randomUUID(),
      name: command.name,
      type: command.type,
      status: 'draft',
      createdByUserId: command.createdByUserId,
      createdAt: now,
      updatedAt: now,
    };
    const settings: InstitutionSettings = {
      institutionId: institution.id,
      branding: { name: command.name, logoUrl: null, primaryColor: null },
      language: 'ar',
      rtl: true,
      terminology: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.transactionRunner.runInTransaction(async () => {
      await this.institutions.create(institution);
      await this.settings.create(settings);
    });
    await this.events.publish({
      type: 'tenant.created',
      occurredAt: now,
      institutionId: institution.id,
      name: institution.name,
      createdByUserId: command.createdByUserId,
    });
    return institution;
  }

  async getInstitution(command: GetInstitutionCommand): Promise<Institution> {
    const institution = await this.institutions.findById(command.institutionId);
    if (institution === null) {
      throw new InstitutionNotFoundError('Institution not found');
    }
    return institution;
  }

  async activateInstitution(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'active');
  }

  async suspendInstitution(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'suspended');
  }

  async restoreInstitution(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'active');
  }

  async moveToGracePeriod(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'grace_period');
  }

  async archiveInstitution(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'archived');
  }

  async closeInstitution(command: LifecycleTransitionCommand): Promise<Institution> {
    return this.transitionLifecycle(command, 'deleted');
  }

  private async transitionLifecycle(
    command: LifecycleTransitionCommand,
    to: TenantStatus,
  ): Promise<Institution> {
    const institution = await this.institutions.findById(command.institutionId);
    if (institution === null) {
      throw new InstitutionNotFoundError('Institution not found');
    }
    if (institution.status === 'deleted') {
      throw new DeletedInstitutionError();
    }
    this.assertAllowedTransition(institution.status, to);
    const updated: Institution = { ...institution, status: to, updatedAt: new Date() };
    await this.institutions.update(updated);
    await this.events.publish({
      type: 'tenant.status.changed',
      occurredAt: updated.updatedAt,
      institutionId: institution.id,
      from: institution.status,
      to,
      actorUserId: command.actorUserId,
      reason: command.reason,
    });
    return updated;
  }

  private assertAllowedTransition(from: TenantStatus, to: TenantStatus): void {
    if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
      throw new InvalidLifecycleTransitionError(from, to);
    }
  }
}
