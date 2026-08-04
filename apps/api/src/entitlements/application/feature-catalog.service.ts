import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FeatureDefinitionKeyAlreadyExistsError } from '../domain/errors.js';
import type { EntitlementEventPublisher } from '../domain/events.js';
import type { FeatureDefinition, FeatureHardRestriction } from '../domain/types.js';
import type { FeatureDefinitionRepository } from '../ports/feature-definition.repository.js';
import {
  ENTITLEMENTS_EVENT_PUBLISHER,
  FEATURE_DEFINITION_REPOSITORY,
} from '../entitlements.tokens.js';

export interface CreateFeatureDefinitionCommand {
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  hardRestriction?: FeatureHardRestriction;
}

@Injectable()
export class FeatureCatalogService {
  constructor(
    @Inject(FEATURE_DEFINITION_REPOSITORY)
    private readonly features: FeatureDefinitionRepository,
    @Inject(ENTITLEMENTS_EVENT_PUBLISHER) private readonly events: EntitlementEventPublisher,
  ) {}

  async createFeatureDefinition(command: CreateFeatureDefinitionCommand): Promise<FeatureDefinition> {
    const existing = await this.features.findByKey(command.key);
    if (existing !== null) {
      throw new FeatureDefinitionKeyAlreadyExistsError(
        `A feature definition with key ${command.key} already exists`,
      );
    }
    const now = new Date();
    const definition: FeatureDefinition = {
      id: randomUUID(),
      key: command.key,
      name: command.name,
      description: command.description ?? null,
      category: command.category ?? null,
      hardRestriction: command.hardRestriction ?? 'none',
      createdAt: now,
      updatedAt: now,
    };
    await this.features.create(definition);
    return definition;
  }

  async findByKey(key: string): Promise<FeatureDefinition | null> {
    return this.features.findByKey(key);
  }

  async listFeatures(): Promise<FeatureDefinition[]> {
    return this.features.list();
  }
}
