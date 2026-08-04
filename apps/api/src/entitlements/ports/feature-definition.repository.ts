import type { FeatureDefinition } from '../domain/types.js';

export interface FeatureDefinitionRepository {
  create(definition: FeatureDefinition): Promise<void>;
  findById(id: string): Promise<FeatureDefinition | null>;
  findByKey(key: string): Promise<FeatureDefinition | null>;
  list(): Promise<FeatureDefinition[]>;
}
