import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { TenantEvent, TenantEventPublisher } from '../../src/tenant/domain/events.js';
import type {
  Institution,
  InstitutionSettings,
  Invitation,
  Membership,
  TenantStatus,
} from '../../src/tenant/domain/types.js';
import type { InstitutionSettingsRepository } from '../../src/tenant/ports/institution-settings.repository.js';
import type { InstitutionRepository } from '../../src/tenant/ports/institution.repository.js';
import type { InvitationRepository } from '../../src/tenant/ports/invitation.repository.js';
import type { MembershipRepository } from '../../src/tenant/ports/membership.repository.js';
import type { TenantTransactionRunner } from '../../src/tenant/ports/transaction-runner.js';
import type { TenantContextResolver } from '../../src/tenant/ports/tenant-context.js';
import { decodeCursor } from '../../src/tenant/pagination.js';

export class FakeInstitutionRepository implements InstitutionRepository {
  readonly institutions = new Map<string, Institution>();

  async create(institution: Institution): Promise<void> {
    this.institutions.set(institution.id, institution);
  }

  async findById(id: string): Promise<Institution | null> {
    return this.institutions.get(id) ?? null;
  }

  async update(institution: Institution): Promise<void> {
    this.institutions.set(institution.id, institution);
  }
}

export class FakeInstitutionSettingsRepository implements InstitutionSettingsRepository {
  readonly settings = new Map<string, InstitutionSettings>();

  async create(settings: InstitutionSettings): Promise<void> {
    this.settings.set(settings.institutionId, settings);
  }

  async getByInstitutionId(institutionId: string): Promise<InstitutionSettings | null> {
    return this.settings.get(institutionId) ?? null;
  }

  async update(settings: InstitutionSettings): Promise<void> {
    this.settings.set(settings.institutionId, settings);
  }
}

export class FakeMembershipRepository implements MembershipRepository {
  readonly memberships = new Map<string, Membership>();
  failNextCreate = false;

  async create(membership: Membership): Promise<void> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('simulated persistence failure');
    }
    this.memberships.set(membership.id, membership);
  }

  async findById(id: string): Promise<Membership | null> {
    return this.memberships.get(id) ?? null;
  }

  async findByUserAndInstitution(userId: string, institutionId: string): Promise<Membership | null> {
    for (const membership of this.memberships.values()) {
      if (membership.userId === userId && membership.institutionId === institutionId) {
        return membership;
      }
    }
    return null;
  }

  async listByInstitution(
    institutionId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<Membership[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.memberships.values()]
      .filter((membership) => membership.institutionId === institutionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (membership) =>
              membership.createdAt.getTime() < cursor.createdAt.getTime() ||
              (membership.createdAt.getTime() === cursor.createdAt.getTime() && membership.id < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }

  async update(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }
}

export class FakeInvitationRepository implements InvitationRepository {
  readonly invitations = new Map<string, Invitation>();

  async create(invitation: Invitation): Promise<void> {
    this.invitations.set(invitation.id, invitation);
  }

  async findById(id: string): Promise<Invitation | null> {
    return this.invitations.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.tokenHash === tokenHash) {
        return invitation;
      }
    }
    return null;
  }

  async listByInstitution(
    institutionId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<Invitation[]> {
    const cursor = options.cursor === null ? null : decodeCursor(options.cursor);
    const rows = [...this.invitations.values()]
      .filter((invitation) => invitation.institutionId === institutionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const filtered =
      cursor === null
        ? rows
        : rows.filter(
            (invitation) =>
              invitation.createdAt.getTime() < cursor.createdAt.getTime() ||
              (invitation.createdAt.getTime() === cursor.createdAt.getTime() && invitation.id < cursor.id),
          );
    return filtered.slice(0, options.limit);
  }

  async update(invitation: Invitation): Promise<void> {
    this.invitations.set(invitation.id, invitation);
  }
}

export class RecordingTenantEventPublisher implements TenantEventPublisher {
  readonly published: TenantEvent[] = [];

  publish(event: TenantEvent): void {
    this.published.push(event);
  }

  eventsOfType(type: string): TenantEvent[] {
    return this.published.filter((event) => event.type === type);
  }
}

export class TrackingTenantTransactionRunner implements TenantTransactionRunner {
  calls = 0;
  maxDepth = 0;
  private depth = 0;

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    try {
      return await work();
    } finally {
      this.depth -= 1;
    }
  }
}

export class FakeTenantContextResolver implements TenantContextResolver {
  private readonly tenantId: string | null;

  constructor(tenantId: string | null) {
    this.tenantId = tenantId;
  }

  resolveTenantId(): string | null {
    return this.tenantId;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createInstitution(overrides?: Partial<Institution>): Institution {
  const now = new Date();
  return {
    id: randomUUID(),
    name: 'Manara University',
    type: 'university',
    status: 'draft',
    createdByUserId: 'user-owner',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createInstitutionWithStatus(status: TenantStatus, overrides?: Partial<Institution>): Institution {
  return createInstitution({ ...overrides, status });
}

export function createMembership(overrides?: Partial<Membership>): Membership {
  const now = new Date();
  return {
    id: randomUUID(),
    institutionId: 'institution-1',
    userId: 'user-1',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    endedAt: null,
    ...overrides,
  };
}
