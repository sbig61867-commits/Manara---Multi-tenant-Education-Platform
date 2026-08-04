import type { AuditMetadata, AuditMetadataValue } from '../domain/types.js';

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'hash',
  'token',
  'secret',
  'credential',
  'apikey',
  'authorization',
  'authheader',
  'card',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
  'databaseurl',
  'dburl',
  'dsn',
  'connectionstring',
  'connectionuri',
  'jwt',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function redactAuditMetadata(
  metadata: Readonly<Record<string, AuditMetadataValue>>,
): AuditMetadata {
  const redacted: Record<string, AuditMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = normalizeKey(key);
    const sensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
    redacted[key] = sensitive ? REDACTED_VALUE : value;
  }
  return redacted;
}
