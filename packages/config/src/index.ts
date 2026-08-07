import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';

export type ApiTrustProxy = boolean | number | string[];

const MAX_TRUSTED_PROXY_HOPS = 16;

function parseTrustedProxyEntry(entry: string): boolean {
  const parts = entry.split('/');
  if (parts.length === 1) return isIP(entry) !== 0;
  if (parts.length !== 2) return false;

  const [address, rawPrefix] = parts;
  if (address === undefined || rawPrefix === undefined) return false;
  const version = isIP(address);
  if (version === 0 || !/^\d+$/.test(rawPrefix)) return false;

  return Number(rawPrefix) <= (version === 4 ? 32 : 128);
}

function parseApiTrustProxy(value: string, context: z.RefinementCtx): ApiTrustProxy {
  const normalized = value.trim();
  if (normalized === 'off' || normalized === 'false') return false;
  if (normalized === 'true') return true;

  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS) return hops;
  } else {
    const entries = normalized.split(',').map((entry) => entry.trim());
    if (entries.length > 0 && entries.every((entry) => entry !== '' && parseTrustedProxyEntry(entry))) {
      return entries;
    }
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'API_TRUST_PROXY must be off, false, true, a hop count from 1 to 16, or an IP/CIDR allowlist',
  });
  return z.NEVER;
}

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const apiEnvSchema = baseEnvSchema.extend({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_CORS_ORIGINS: z.string().default(''),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(1_048_576),
  API_ENABLE_DOCS: z.enum(['auto', 'true', 'false']).default('auto'),
  API_COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  API_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('manara_session'),
  API_TRUST_PROXY: z.string().default('off').transform(parseApiTrustProxy),
  // Authentication abuse protection (in-memory per instance; see AuthModule).
  AUTH_LOGIN_IP_MAX_FAILURES: z.coerce.number().int().min(1).max(10_000).default(20),
  AUTH_LOGIN_IP_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  AUTH_LOGIN_EMAIL_IP_MAX_FAILURES: z.coerce.number().int().min(1).max(1_000).default(5),
  AUTH_LOGIN_EMAIL_IP_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  AUTH_REFRESH_IP_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(30),
  AUTH_REFRESH_IP_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  AUTH_ENDPOINT_IP_MAX_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(120),
  AUTH_ENDPOINT_IP_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
}).superRefine((value, context) => {
  if (
    (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')
    && value.API_COOKIE_SECURE === 'false'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['API_COOKIE_SECURE'],
      message: 'API_COOKIE_SECURE must not be false in staging or production',
    });
  }
  if (
    (value.NODE_ENV === 'staging' || value.NODE_ENV === 'production')
    && value.API_TRUST_PROXY === true
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['API_TRUST_PROXY'],
      message: 'API_TRUST_PROXY=true is not allowed in staging or production; use off, a hop count, or an IP/CIDR allowlist',
    });
  }
});

export const workerEnvSchema = baseEnvSchema
  .extend({
    WORKER_HOST: z.string().min(1).default('0.0.0.0'),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(3_600_000).default(5_000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    WORKER_CLAIM_LEASE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(300_000),
    WORKER_STALE_CLAIM_RELEASE_INTERVAL_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
    WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    WORKER_CLAIM_SCOPE: z.enum(['platform', 'tenant']).default('platform'),
    WORKER_CLAIM_TENANT_ID: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.WORKER_CLAIM_SCOPE === 'tenant' && (value.WORKER_CLAIM_TENANT_ID === undefined || value.WORKER_CLAIM_TENANT_ID === '')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_CLAIM_TENANT_ID'],
        message: 'WORKER_CLAIM_TENANT_ID is required when WORKER_CLAIM_SCOPE is tenant',
      });
    }
    if (value.WORKER_CLAIM_SCOPE === 'platform' && value.WORKER_CLAIM_TENANT_ID !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_CLAIM_TENANT_ID'],
        message: 'WORKER_CLAIM_TENANT_ID must not be set when WORKER_CLAIM_SCOPE is platform',
      });
    }
  });

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export interface LoadConfigOptions<T extends z.ZodType> {
  schema: T;
  service: string;
}

export function loadConfig<T extends z.ZodType>(options: LoadConfigOptions<T>): z.infer<T> {
  const result = options.schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n  ');
    console.error(`[${options.service}] Invalid environment configuration:\n  ${issues}`);
    process.exit(1);
  }
  return result.data;
}

export function loadDotenv(): void {
  const root = findMonorepoRoot(process.cwd());
  if (!root) return;
  for (const file of [resolve(root, '.env.local'), resolve(root, '.env')]) {
    if (existsSync(file)) loadEnvFile({ path: file });
  }
}

function findMonorepoRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    const pkgPath = resolve(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return current;
      } catch {
        continue;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
