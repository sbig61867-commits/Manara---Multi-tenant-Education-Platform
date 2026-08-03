export abstract class IdentityError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidEmailError extends IdentityError {
  readonly code = 'identity.invalid_email';
}

export class UserAlreadyExistsError extends IdentityError {
  readonly code = 'identity.user_already_exists';
}

export class WeakPasswordError extends IdentityError {
  readonly code = 'identity.weak_password';
}

export class InvalidCredentialsError extends IdentityError {
  readonly code = 'identity.invalid_credentials';
}

export class UserNotFoundError extends IdentityError {
  readonly code = 'identity.user_not_found';
}

export class PasswordIdentityNotFoundError extends IdentityError {
  readonly code = 'identity.password_identity_not_found';
}

export class PasswordIdentityAlreadyExistsError extends IdentityError {
  readonly code = 'identity.password_identity_already_exists';
}
