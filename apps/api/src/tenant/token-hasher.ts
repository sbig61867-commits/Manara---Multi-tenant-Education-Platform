import { createHash } from 'node:crypto';

export interface TokenHasher {
  hash(token: string): Promise<string>;
}

export class Sha256TokenHasher implements TokenHasher {
  async hash(token: string): Promise<string> {
    return createHash('sha256').update(token).digest('hex');
  }
}
