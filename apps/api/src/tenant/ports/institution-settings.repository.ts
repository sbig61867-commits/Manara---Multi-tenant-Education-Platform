import type { InstitutionSettings } from '../domain/types.js';

export interface InstitutionSettingsRepository {
  create(settings: InstitutionSettings): Promise<void>;
  getByInstitutionId(institutionId: string): Promise<InstitutionSettings | null>;
  update(settings: InstitutionSettings): Promise<void>;
}
