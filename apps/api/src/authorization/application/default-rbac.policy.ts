import { Injectable } from '@nestjs/common';
import type {
  AttributeValue,
  RoleAssignmentScope,
} from '../domain/types.js';
import type { RbacPolicy, RbacRequest, RbacResolution } from '../ports/policy.js';

function scopeMatches(
  scope: RoleAssignmentScope,
  attributes: Readonly<Record<string, AttributeValue>>,
): boolean {
  switch (scope.type) {
    case 'tenant':
      return true;
    case 'unit':
      return attributes['unitId'] === scope.unitId;
    case 'program':
      return attributes['programId'] === scope.programId;
    case 'group':
      return attributes['groupId'] === scope.groupId;
  }
}

@Injectable()
export class DefaultRbacPolicy implements RbacPolicy {
  async resolve(request: RbacRequest): Promise<RbacResolution | null> {
    const permissionKey = `${request.resource.type}:${request.action}`;
    for (const assignment of request.assignments) {
      const role = request.roles.find((candidate) => candidate.id === assignment.roleId);
      if (role === undefined || role.status !== 'active') {
        continue;
      }
      const grant = request.grants.find(
        (candidate) => candidate.roleId === role.id && candidate.permissionKey === permissionKey,
      );
      if (grant === undefined) {
        continue;
      }
      if (!scopeMatches(assignment.scope, request.resource.attributes)) {
        continue;
      }
      return { permissionKey, roleId: role.id, roleName: role.name, scope: assignment.scope };
    }
    return null;
  }
}
