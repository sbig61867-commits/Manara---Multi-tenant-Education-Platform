import { argon2id } from 'hash-wasm';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const ARGON2_MEMORY_SIZE = 65536;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

interface Argon2idPhc {
  memorySize: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  expected: Uint8Array;
}

function parseArgon2idPhc(encoded: string): Argon2idPhc | null {
  const parts = encoded.split('$');
  const version = parts[2];
  const paramsSegment = parts[3];
  const saltSegment = parts[4];
  const hashSegment = parts[5];
  if (
    parts.length !== 6 ||
    parts[1] !== 'argon2id' ||
    version === undefined ||
    !version.startsWith('v=') ||
    paramsSegment === undefined ||
    saltSegment === undefined ||
    hashSegment === undefined
  ) {
    return null;
  }
  const params = new Map<string, number>();
  for (const param of paramsSegment.split(',')) {
    const [key, value] = param.split('=');
    const parsed = Number(value);
    if (key === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    params.set(key, parsed);
  }
  const memorySize = params.get('m');
  const iterations = params.get('t');
  const parallelism = params.get('p');
  if (memorySize === undefined || iterations === undefined || parallelism === undefined) {
    return null;
  }
  const salt = Buffer.from(saltSegment, 'base64');
  const expected = Buffer.from(hashSegment, 'base64');
  if (salt.length === 0 || expected.length === 0) {
    return null;
  }
  return { memorySize, iterations, parallelism, salt, expected };
}

export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2id({
      password,
      salt: randomBytes(ARGON2_SALT_LENGTH),
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_ITERATIONS,
      memorySize: ARGON2_MEMORY_SIZE,
      hashLength: ARGON2_HASH_LENGTH,
      outputType: 'encoded',
    });
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const phc = parseArgon2idPhc(encoded);
    if (phc === null) {
      return false;
    }
    try {
      const derived = await argon2id({
        password,
        salt: phc.salt,
        parallelism: phc.parallelism,
        iterations: phc.iterations,
        memorySize: phc.memorySize,
        hashLength: phc.expected.length,
        outputType: 'binary',
      });
      return timingSafeEqual(derived, phc.expected);
    } catch {
      return false;
    }
  }
}

