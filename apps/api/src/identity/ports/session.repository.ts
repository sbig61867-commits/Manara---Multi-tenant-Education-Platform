import type { AuthSession } from '../domain/types.js';

export interface SessionRepository {
  create(session: AuthSession): Promise<void>;
  findById(id: string): Promise<AuthSession | null>;
  findByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  update(session: AuthSession): Promise<void>;
  revokeById(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;
}
