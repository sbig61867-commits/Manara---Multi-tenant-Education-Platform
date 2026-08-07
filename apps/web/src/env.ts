export type WebEnvironmentMode = 'development' | 'test' | 'staging' | 'production';

export interface WebEnvironment {
  readonly apiBaseUrl: string | null;
}

export const WEB_PUBLIC_ENV_KEYS = ['VITE_API_BASE_URL'] as const;

function normalizeApiBaseUrl(raw: string, mode: WebEnvironmentMode): string {
  if (raw.includes('*')) {
    throw new Error('VITE_API_BASE_URL must not contain wildcards');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute URL origin');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL supports only HTTP(S) origins');
  }
  if ((mode === 'staging' || mode === 'production') && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use HTTPS in staging and production');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('VITE_API_BASE_URL must not contain credentials');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('VITE_API_BASE_URL must be an origin without a path, query, or fragment');
  }
  return url.origin;
}

export function resolveWebEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  mode: WebEnvironmentMode,
): WebEnvironment {
  const raw = env.VITE_API_BASE_URL?.trim() ?? '';
  if (raw === '') {
    if (mode === 'staging' || mode === 'production') {
      throw new Error('VITE_API_BASE_URL is required in staging and production');
    }
    return { apiBaseUrl: null };
  }
  return { apiBaseUrl: normalizeApiBaseUrl(raw, mode) };
}
