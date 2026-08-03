import type { PasswordIdentity } from '../domain/types.js';

export interface PasswordIdentityRepository {
  create(identity: PasswordIdentity): Promise<void>;
  findByUserId(userId: string): Promise<PasswordIdentity | null>;
  update(identity: PasswordIdentity): Promise<void>;
}
