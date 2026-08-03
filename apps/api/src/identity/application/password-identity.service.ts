import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  InvalidCredentialsError,
  PasswordIdentityAlreadyExistsError,
  PasswordIdentityNotFoundError,
  UserNotFoundError,
} from '../domain/errors.js';
import type { IdentityEventPublisher } from '../domain/events.js';
import type { PasswordIdentity } from '../domain/types.js';
import type { PasswordHasher } from '../hasher.js';
import {
  IDENTITY_EVENT_PUBLISHER,
  PASSWORD_HASHER,
  PASSWORD_IDENTITY_REPOSITORY,
  USER_REPOSITORY,
} from '../identity.tokens.js';
import type { PasswordIdentityRepository } from '../ports/identity.repository.js';
import type { UserRepository } from '../ports/user.repository.js';
import { assertValidPassword } from './password-policy.js';
import type { SessionService } from './session.service.js';

@Injectable()
export class PasswordIdentityService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_IDENTITY_REPOSITORY) private readonly identityRepository: PasswordIdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessionService: SessionService,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: IdentityEventPublisher,
  ) {}

  async attachPasswordIdentity(userId: string, password: string): Promise<void> {
    assertValidPassword(password);
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundError('User not found');
    }
    const existing = await this.identityRepository.findByUserId(userId);
    if (existing !== null) {
      throw new PasswordIdentityAlreadyExistsError('Password identity already exists');
    }
    const now = new Date();
    const passwordHash = await this.hasher.hash(password);
    const identity: PasswordIdentity = {
      id: randomUUID(),
      userId,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    await this.identityRepository.create(identity);
    await this.events.publish({ type: 'password.identity.attached', occurredAt: now, userId });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    assertValidPassword(newPassword);
    const identity = await this.identityRepository.findByUserId(userId);
    if (identity === null) {
      throw new PasswordIdentityNotFoundError('Password identity not found');
    }
    const verified = await this.hasher.verify(currentPassword, identity.passwordHash);
    if (!verified) {
      throw new InvalidCredentialsError('Invalid credentials');
    }
    const now = new Date();
    const passwordHash = await this.hasher.hash(newPassword);
    await this.identityRepository.update({ ...identity, passwordHash, updatedAt: now });
    await this.sessionService.revokeAllSessions(userId);
    await this.events.publish({ type: 'user.password.reset', occurredAt: now, userId });
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    assertValidPassword(newPassword);
    const identity = await this.identityRepository.findByUserId(userId);
    if (identity === null) {
      throw new PasswordIdentityNotFoundError('Password identity not found');
    }
    const now = new Date();
    const passwordHash = await this.hasher.hash(newPassword);
    await this.identityRepository.update({ ...identity, passwordHash, updatedAt: now });
    await this.sessionService.revokeAllSessions(userId);
    await this.events.publish({ type: 'user.password.reset', occurredAt: now, userId });
  }
}
