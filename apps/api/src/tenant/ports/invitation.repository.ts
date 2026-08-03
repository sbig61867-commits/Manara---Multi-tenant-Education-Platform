import type { Invitation } from '../domain/types.js';

export interface InvitationRepository {
  create(invitation: Invitation): Promise<void>;
  findById(id: string): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  update(invitation: Invitation): Promise<void>;
}
