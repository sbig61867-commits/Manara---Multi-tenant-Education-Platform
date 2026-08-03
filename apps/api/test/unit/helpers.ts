import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { IdentityEvent, IdentityEventPublisher } from '../../src/identity/domain/events.js';
import type { AuthSession, PasswordIdentity, User } from '../../src/identity/domain/types.js';
import type { PasswordHasher } from '../../src/identity/hasher.js';
import type { PasswordIdentityRepository } from '../../src/identity/ports/identity.repository.js';
import type { SessionRepository } from '../../src/identity/ports/session.repository.js';
import type { UserRepository } from '../../src/identity/ports/user.repository.js';

export class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async create(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async update(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
}

export class FakePasswordIdentityRepository implements PasswordIdentityRepository {
  private readonly identities = new Map<string, PasswordIdentity>();

  async create(identity: PasswordIdentity): Promise<void> {
    this.identities.set(identity.userId, identity);
  }

  async findByUserId(userId: string): Promise<PasswordIdentity | null> {
    return this.identities.get(userId) ?? null;
  }

  async update(identity: PasswordIdentity): Promise<void> {
    this.identities.set(identity.userId, identity);
  }
}

export class FakeSessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, AuthSession>();

  async create(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async findById(id: string): Promise<AuthSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }
    return null;
  }

  async update(session: AuthSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async revokeById(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session !== undefined) {
      this.sessions.set(id, { ...session, revokedAt: new Date() });
    }
  }

  async revokeAllForUser(userId: string): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && session.revokedAt === null) {
        this.sessions.set(id, { ...session, revokedAt: new Date() });
        count += 1;
      }
    }
    return count;
  }

  storedSessions(): AuthSession[] {
    return [...this.sessions.values()];
  }
}

export class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `argon2id$${createHash('sha256').update(password).digest('hex')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    return encoded === `argon2id$${createHash('sha256').update(password).digest('hex')}`;
  }
}

export class RecordingEventPublisher implements IdentityEventPublisher {
  readonly published: IdentityEvent[] = [];

  publish(event: IdentityEvent): void {
    this.published.push(event);
  }

  eventsOfType(type: string): IdentityEvent[] {
    return this.published.filter((event) => event.type === type);
  }
}

export function createUser(overrides?: Partial<User>): User {
  const now = new Date();
  return {
    id: randomUUID(),
    email: 'student@example.com',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
