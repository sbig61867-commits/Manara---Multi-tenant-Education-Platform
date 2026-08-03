import type { PostgresDatabase } from '@manara/database';
import { Module, type DynamicModule } from '@nestjs/common';
import { PostgresPasswordIdentityRepository } from './adapters/postgres-password-identity.repository.js';
import { PostgresSessionRepository } from './adapters/postgres-session.repository.js';
import { PostgresTransactionRunner } from './adapters/postgres-transaction-runner.js';
import { PostgresUserRepository } from './adapters/postgres-user.repository.js';
import { CredentialVerificationService } from './application/credential-verification.service.js';
import { PasswordIdentityService } from './application/password-identity.service.js';
import { SessionService } from './application/session.service.js';
import { UserCreationService } from './application/user-creation.service.js';
import { NoopIdentityEventPublisher } from './domain/events.js';
import { Argon2idPasswordHasher } from './hasher.js';
import {
  IDENTITY_EVENT_PUBLISHER,
  PASSWORD_HASHER,
  PASSWORD_IDENTITY_REPOSITORY,
  SESSION_REPOSITORY,
  TRANSACTION_RUNNER,
  USER_REPOSITORY,
} from './identity.tokens.js';

@Module({
  providers: [
    UserCreationService,
    PasswordIdentityService,
    CredentialVerificationService,
    SessionService,
    { provide: PASSWORD_HASHER, useClass: Argon2idPasswordHasher },
    { provide: IDENTITY_EVENT_PUBLISHER, useClass: NoopIdentityEventPublisher },
  ],
  exports: [UserCreationService, PasswordIdentityService, CredentialVerificationService, SessionService],
})
export class IdentityModule {
  static forRoot(database: PostgresDatabase | null): DynamicModule {
    if (database === null) {
      return { module: IdentityModule };
    }
    return {
      module: IdentityModule,
      providers: [
        { provide: USER_REPOSITORY, useValue: new PostgresUserRepository(database) },
        { provide: PASSWORD_IDENTITY_REPOSITORY, useValue: new PostgresPasswordIdentityRepository(database) },
        { provide: SESSION_REPOSITORY, useValue: new PostgresSessionRepository(database) },
        { provide: TRANSACTION_RUNNER, useValue: new PostgresTransactionRunner(database) },
      ],
    };
  }
}
