import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';

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
});

export const workerEnvSchema = baseEnvSchema.extend({
  WORKER_HOST: z.string().min(1).default('0.0.0.0'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
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
