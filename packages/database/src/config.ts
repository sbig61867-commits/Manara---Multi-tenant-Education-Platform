import { z } from 'zod';

const POSTGRES_URL_SCHEMES = new Set(['postgres:', 'postgresql:']);

export function isValidPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return POSTGRES_URL_SCHEMES.has(url.protocol) && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL must not be empty')
    .refine(isValidPostgresUrl, 'DATABASE_URL must be a valid postgres:// or postgresql:// connection string'),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export interface DatabaseConfig {
  connectionString: string;
  host: string;
  port: number;
  database: string;
}

export function resolveDatabaseConfig(env: Record<string, string | undefined> = process.env): DatabaseConfig | null {
  const raw = env.DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const parsed = databaseEnvSchema.safeParse({ DATABASE_URL: raw });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid database configuration: ${issues}`);
  }
  const url = new URL(raw);
  return {
    connectionString: raw,
    host: url.hostname,
    port: url.port === '' ? 5432 : Number(url.port),
    database: url.pathname.replace(/^\/+/, ''),
  };
}
