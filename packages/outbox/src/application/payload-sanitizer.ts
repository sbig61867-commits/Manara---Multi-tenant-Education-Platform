import { InvalidOutboxMessageError } from '../domain/errors.js';
import type { OutboxPayload } from '../domain/types.js';

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  'token',
  'password',
  'passphrase',
  'secret',
  'apikey',
  'authorization',
  'credential',
  'privatekey',
  'accesskey',
  'session',
  'cookie',
  'refresh',
  'signature',
];

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isJsonSafeValue(
  value: unknown,
): value is string | number | boolean | null | OutboxPayload | Array<unknown> {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafeValue(item));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every((item) => isJsonSafeValue(item));
  }
  return false;
}

function isPlainRecord(value: unknown): value is OutboxPayload {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value: unknown, key: string): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, String(index)));
  }
  if (isPlainRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeValue(childValue, childKey);
    }
    return result;
  }
  return value;
}

/**
 * Returns a deep copy of the payload with sensitive keys redacted.
 * Throws InvalidOutboxMessageError when the payload is not JSON-safe.
 */
export function sanitizeOutboxPayload(value: unknown): OutboxPayload {
  if (!isJsonSafeValue(value)) {
    throw new InvalidOutboxMessageError('Outbox payload must be JSON-safe');
  }
  if (!isPlainRecord(value)) {
    throw new InvalidOutboxMessageError('Outbox payload must be a JSON object');
  }
  const sanitized = sanitizeValue(value, '');
  if (!isPlainRecord(sanitized)) {
    throw new InvalidOutboxMessageError('Outbox payload must be a JSON object');
  }
  return sanitized;
}

export function sanitizeErrorMessage(value: unknown, maxLength: number): string {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }
  if (value instanceof Error) {
    return sanitizeErrorMessage(value.message, maxLength);
  }
  const text = String(value ?? 'unknown delivery failure').replace(/\s+/g, ' ').trim();
  return text === '' ? 'unknown delivery failure' : text.slice(0, maxLength);
}
