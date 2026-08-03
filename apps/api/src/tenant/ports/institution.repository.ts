import type { Institution } from '../domain/types.js';

export interface InstitutionRepository {
  create(institution: Institution): Promise<void>;
  findById(id: string): Promise<Institution | null>;
  update(institution: Institution): Promise<void>;
}
