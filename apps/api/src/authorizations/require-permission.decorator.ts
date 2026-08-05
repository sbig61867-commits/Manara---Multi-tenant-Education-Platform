import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_METADATA = Symbol('authorization:required_permission');

/**
 * Declares the management permission that must be effectively held by the
 * authenticated user (in the trusted tenant context) for the decorated
 * handler to execute. Enforcement happens in `AuthorizationPermissionInterceptor`.
 */
export function RequirePermission(permissionKey: string): MethodDecorator {
  return SetMetadata(REQUIRED_PERMISSION_METADATA, permissionKey);
}
