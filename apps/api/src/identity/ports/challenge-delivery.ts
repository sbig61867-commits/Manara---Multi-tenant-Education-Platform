export interface EmailVerificationChallenge {
  userId: string;
  email: string;
  code: string;
  expiresAt: Date;
}

export interface PasswordResetChallenge {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
}

export interface ChallengeDelivery {
  sendEmailVerification(challenge: EmailVerificationChallenge): Promise<void>;
  sendPasswordReset(challenge: PasswordResetChallenge): Promise<void>;
}
