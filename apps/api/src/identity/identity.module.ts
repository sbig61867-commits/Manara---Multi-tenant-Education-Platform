import { Module } from '@nestjs/common';
import { CredentialVerificationService } from './application/credential-verification.service.js';
import { PasswordIdentityService } from './application/password-identity.service.js';
import { SessionService } from './application/session.service.js';
import { UserCreationService } from './application/user-creation.service.js';
import { NoopIdentityEventPublisher } from './domain/events.js';
import { Argon2idPasswordHasher } from './hasher.js';
import { IDENTITY_EVENT_PUBLISHER, PASSWORD_HASHER } from './identity.tokens.js';

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
export class IdentityModule {}
