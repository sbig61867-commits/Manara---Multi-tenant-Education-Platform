import type { Membership } from '../domain/types.js';

export interface MembershipRepository {
  create(membership: Membership): Promise<void>;
  findById(id: string): Promise<Membership | null>;
  findByUserAndInstitution(userId: string, institutionId: string): Promise<Membership | null>;
  update(membership: Membership): Promise<void>;
}
