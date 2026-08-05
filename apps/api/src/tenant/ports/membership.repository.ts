import type { Membership } from '../domain/types.js';

export interface MembershipListOptions {
  limit: number;
  cursor: string | null;
}

export interface MembershipRepository {
  create(membership: Membership): Promise<void>;
  findById(id: string): Promise<Membership | null>;
  findByUserAndInstitution(userId: string, institutionId: string): Promise<Membership | null>;
  listByInstitution(institutionId: string, options: MembershipListOptions): Promise<Membership[]>;
  update(membership: Membership): Promise<void>;
}
