import type { Invitation } from '../domain/types.js';

export interface InvitationListOptions {
  limit: number;
  cursor: string | null;
}

export interface InvitationRepository {
  create(invitation: Invitation): Promise<void>;
  findById(id: string): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  listByInstitution(institutionId: string, options: InvitationListOptions): Promise<Invitation[]>;
  update(invitation: Invitation): Promise<void>;
}
