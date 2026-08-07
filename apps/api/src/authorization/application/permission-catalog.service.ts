import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Permission } from '../domain/types.js';
import type { PermissionRepository } from '../ports/permission.repository.js';
import type { AuthorizationTransactionRunner } from '../ports/transaction-runner.js';
import { PLATFORM_PERMISSION_CATALOG } from '../platform-permission-catalog.js';
import { AUTHORIZATION_TRANSACTION_RUNNER, PERMISSION_REPOSITORY } from '../authorization.tokens.js';

export const PERMISSION_CATALOG_ADVISORY_LOCK_KEY = 7_340_017;

export interface PermissionCatalogSeedResult {
  readonly required: number;
  readonly inserted: number;
  readonly reconciled: number;
  readonly unchanged: number;
}

export interface PermissionCatalogVerification {
  readonly required: number;
  readonly present: number;
  readonly missingKeys: readonly string[];
  readonly valid: boolean;
}

@Injectable()
export class PermissionCatalogService {
  constructor(
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository,
    @Inject(AUTHORIZATION_TRANSACTION_RUNNER) private readonly transactions: AuthorizationTransactionRunner,
  ) {}

  seedCatalog(): Promise<PermissionCatalogSeedResult> {
    return this.transactions.runInTransactionWithAdvisoryLock(PERMISSION_CATALOG_ADVISORY_LOCK_KEY, async () => {
      const keys = PLATFORM_PERMISSION_CATALOG.map((descriptor) => descriptor.key);
      const existing = new Map((await this.permissions.findByKeys(keys)).map((permission) => [permission.key, permission]));
      let inserted = 0;
      let reconciled = 0;
      let unchanged = 0;

      for (const descriptor of PLATFORM_PERMISSION_CATALOG) {
        let permission = existing.get(descriptor.key);
        if (permission === undefined) {
          const now = new Date();
          const candidate: Permission = {
            id: randomUUID(),
            key: descriptor.key,
            module: descriptor.module,
            description: descriptor.description,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          };
          if (await this.permissions.insertCatalogPermission(candidate)) {
            inserted += 1;
            existing.set(candidate.key, candidate);
            continue;
          }
          permission = await this.permissions.findByKey(descriptor.key) ?? undefined;
          if (permission === undefined) {
            throw new Error(`Permission catalog row was not found after insert conflict: ${descriptor.key}`);
          }
          existing.set(permission.key, permission);
        }

        if (permission.module === descriptor.module && permission.description === descriptor.description) {
          unchanged += 1;
          continue;
        }
        if (await this.permissions.reconcileCatalogMetadata(descriptor, new Date())) {
          reconciled += 1;
        } else {
          unchanged += 1;
        }
      }

      return { required: PLATFORM_PERMISSION_CATALOG.length, inserted, reconciled, unchanged };
    });
  }

  async verifyCatalog(): Promise<PermissionCatalogVerification> {
    const keys = PLATFORM_PERMISSION_CATALOG.map((descriptor) => descriptor.key);
    const present = new Set((await this.permissions.findByKeys(keys)).map((permission) => permission.key));
    const missingKeys = keys.filter((key) => !present.has(key));
    return {
      required: keys.length,
      present: present.size,
      missingKeys,
      valid: missingKeys.length === 0,
    };
  }
}
