import type { RoleAssignment } from '../domain/types.js';

export interface RoleAssignmentRepository {
  create(assignment: RoleAssignment): Promise<void>;
  findById(id: string): Promise<RoleAssignment | null>;
  delete(id: string): Promise<void>;
  listByUserAndTenant(userId: string, tenantId: string): Promise<RoleAssignment[]>;
}
