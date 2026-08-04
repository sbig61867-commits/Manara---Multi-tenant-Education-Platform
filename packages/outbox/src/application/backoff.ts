export const OUTBOX_MAX_ATTEMPTS = 5;

export const OUTBOX_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;

export const OUTBOX_DEFAULT_CLAIM_LEASE_MS = 300_000;

export function outboxAttemptsExhausted(attempts: number): boolean {
  return attempts >= OUTBOX_MAX_ATTEMPTS;
}

export function outboxRetryDelayMs(attempts: number): number | null {
  if (!Number.isInteger(attempts) || attempts < 1) {
    return null;
  }
  if (outboxAttemptsExhausted(attempts)) {
    return null;
  }
  return OUTBOX_RETRY_DELAYS_MS[attempts - 1] ?? null;
}
