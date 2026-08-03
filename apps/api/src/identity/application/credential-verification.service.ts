import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '../domain/email.js';
import { InvalidCredentialsError } from '../domain/errors.js';
import type { User } from '../domain/types.js';
import type { PasswordHasher } from '../hasher.js';
import { PASSWORD_HASHER, PASSWORD_IDENTITY_REPOSITORY, USER_REPOSITORY } from '../identity.tokens.js';
import type { PasswordIdentityRepository } from '../ports/identity.repository.js';
import type { UserRepository } from '../ports/user.repository.js';

const DUMMY_PASSWORD = 'identity-verification-equalizer';

@Injectable()
export class CredentialVerificationService {
  private dummyHash: string | null = null;

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_IDENTITY_REPOSITORY) private readonly identityRepository: PasswordIdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  private async equalizationHash(): Promise<string> {
    if (this.dummyHash === null) {
      this.dummyHash = await this.hasher.hash(DUMMY_PASSWORD);
    }
    return this.dummyHash;
  }

  async authenticate(email: string, password: string): Promise<User> {
    const normalized = normalizeEmail(email);
    const user = await this.userRepository.findByEmail(normalized);
    if (user === null) {
      await this.hasher.verify(password, await this.equalizationHash());
      throw new InvalidCredentialsError('Invalid credentials');
    }
    const identity = await this.identityRepository.findByUserId(user.id);
    const storedHash = identity === null ? await this.equalizationHash() : identity.passwordHash;
    const verified = await this.hasher.verify(password, storedHash);
    if (!verified) {
      throw new InvalidCredentialsError('Invalid credentials');
    }
    return user;
  }
}
