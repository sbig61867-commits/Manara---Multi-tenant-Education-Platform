import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isValidEmail, normalizeEmail } from '../domain/email.js';
import { InvalidEmailError, UserAlreadyExistsError } from '../domain/errors.js';
import type { IdentityEventPublisher } from '../domain/events.js';
import type { PasswordIdentity, User } from '../domain/types.js';
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

export interface RegisterUserCommand {
  email: string;
  password: string;
}

@Injectable()
export class UserCreationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_IDENTITY_REPOSITORY) private readonly identityRepository: PasswordIdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: IdentityEventPublisher,
  ) {}

  async registerUser(command: RegisterUserCommand): Promise<User> {
    const email = normalizeEmail(command.email);
    if (!isValidEmail(email)) {
      throw new InvalidEmailError('Invalid email address');
    }
    assertValidPassword(command.password);
    const existing = await this.userRepository.findByEmail(email);
    if (existing !== null) {
      throw new UserAlreadyExistsError('A user with this email already exists');
    }
    const now = new Date();
    const user: User = { id: randomUUID(), email, createdAt: now, updatedAt: now };
    const passwordHash = await this.hasher.hash(command.password);
    const identity: PasswordIdentity = {
      id: randomUUID(),
      userId: user.id,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    await this.userRepository.create(user);
    await this.identityRepository.create(identity);
    await this.events.publish({ type: 'user.registered', occurredAt: now, userId: user.id, email });
    await this.events.publish({ type: 'password.identity.attached', occurredAt: now, userId: user.id });
    return user;
  }
}
