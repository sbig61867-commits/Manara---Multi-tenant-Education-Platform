import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityEventPublisher } from '../domain/events.js';
import type { AuthSession } from '../domain/types.js';
import { IDENTITY_EVENT_PUBLISHER, SESSION_REPOSITORY } from '../identity.tokens.js';
import type { SessionRepository } from '../ports/session.repository.js';

export const SESSION_ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
export const SESSION_TOKEN_BYTES = 32;

export interface CreatedSession {
  session: AuthSession;
  token: string;
}

export interface CreateSessionOptions {
  previousSessionId?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessionRepository: SessionRepository,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: IdentityEventPublisher,
  ) {}

  async createSession(userId: string, options?: CreateSessionOptions): Promise<CreatedSession> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const now = new Date();
    const session: AuthSession = {
      id: randomUUID(),
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
      revokedAt: null,
    };
    if (options?.previousSessionId !== undefined) {
      await this.sessionRepository.revokeById(options.previousSessionId);
      await this.events.publish({
        type: 'session.revoked',
        occurredAt: now,
        userId,
        sessionId: options.previousSessionId,
      });
    }
    await this.sessionRepository.create(session);
    await this.events.publish({ type: 'session.created', occurredAt: now, userId, sessionId: session.id });
    return { session, token };
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    const session = await this.sessionRepository.findByTokenHash(hashToken(token));
    if (session === null || session.revokedAt !== null) {
      return null;
    }
    const now = new Date();
    if (now.getTime() >= session.expiresAt.getTime() || now.getTime() >= session.idleExpiresAt.getTime()) {
      return null;
    }
    return session;
  }

  async rotateSession(token: string): Promise<CreatedSession | null> {
    const current = await this.validateSession(token);
    if (current === null) {
      return null;
    }
    const created = await this.createSession(current.userId);
    const rotated: AuthSession = { ...created.session, expiresAt: current.expiresAt };
    await this.sessionRepository.update(rotated);
    await this.sessionRepository.revokeById(current.id);
    await this.events.publish({
      type: 'session.revoked',
      occurredAt: new Date(),
      userId: current.userId,
      sessionId: current.id,
    });
    return { session: rotated, token: created.token };
  }

  async revokeSession(token: string): Promise<boolean> {
    const session = await this.sessionRepository.findByTokenHash(hashToken(token));
    if (session === null || session.revokedAt !== null) {
      return false;
    }
    await this.sessionRepository.revokeById(session.id);
    await this.events.publish({
      type: 'session.revoked',
      occurredAt: new Date(),
      userId: session.userId,
      sessionId: session.id,
    });
    return true;
  }

  async revokeAllSessions(userId: string): Promise<number> {
    const count = await this.sessionRepository.revokeAllForUser(userId);
    if (count > 0) {
      await this.events.publish({
        type: 'session.revoked.all',
        occurredAt: new Date(),
        userId,
        count,
      });
    }
    return count;
  }
}
