import { Injectable } from '@nestjs/common';
import type {
  AbacCondition,
  AuthorizationContext,
  AuthorizationResource,
  AttributeValue,
} from '../domain/types.js';
import type { AbacPolicy } from '../ports/policy.js';

@Injectable()
export class DefaultAbacPolicy implements AbacPolicy {
  async evaluate(
    condition: AbacCondition,
    context: AuthorizationContext,
    resource: AuthorizationResource,
  ): Promise<boolean> {
    const source: Readonly<Record<string, AttributeValue>> =
      condition.source === 'context' ? context.attributes : resource.attributes;
    const actual = source[condition.key];
    switch (condition.operator) {
      case 'equals':
        return actual === condition.value;
      case 'not_equals':
        return actual !== condition.value;
      case 'present':
        return actual !== undefined && actual !== null;
      case 'absent':
        return actual === undefined || actual === null;
    }
  }
}
