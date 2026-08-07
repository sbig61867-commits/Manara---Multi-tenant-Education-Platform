export const THEME_STORAGE_KEY = 'manara.theme';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const THEME_MODES = ['light', 'dark', 'system'] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ThemeClassList {
  toggle(token: string, force?: boolean): boolean;
}

interface ThemeRoot {
  readonly classList: ThemeClassList;
  readonly dataset: DOMStringMap;
  readonly style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
}

type MatchMedia = (query: string) => ThemeMediaQuery;

export interface ThemeOptions {
  readonly root: ThemeRoot;
  readonly storage?: ThemeStorage;
  readonly matchMedia?: MatchMedia;
}

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function readThemePreference(storage: ThemeStorage | undefined): ThemeMode {
  try {
    return normalizeThemeMode(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

function systemPrefersDark(matchMedia: MatchMedia | undefined): boolean {
  try {
    return matchMedia?.(THEME_MEDIA_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

export function applyTheme(root: ThemeRoot, mode: ThemeMode, resolved: ResolvedTheme): void {
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
}

export function initializeTheme(options: ThemeOptions): { mode: ThemeMode; resolved: ResolvedTheme } {
  const mode = readThemePreference(options.storage);
  const resolved = resolveTheme(mode, systemPrefersDark(options.matchMedia));
  applyTheme(options.root, mode, resolved);
  return { mode, resolved };
}

export function setThemePreference(mode: ThemeMode, options: ThemeOptions): ResolvedTheme {
  try {
    options.storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // The current document can still honor the preference when storage is unavailable.
  }
  const resolved = resolveTheme(mode, systemPrefersDark(options.matchMedia));
  applyTheme(options.root, mode, resolved);
  return resolved;
}

export function synchronizeTheme(options: ThemeOptions): () => void {
  initializeTheme(options);
  let mediaQuery: ThemeMediaQuery | undefined;
  try {
    mediaQuery = options.matchMedia?.(THEME_MEDIA_QUERY);
  } catch {
    return () => undefined;
  }
  const synchronize = () => {
    const mode = readThemePreference(options.storage);
    applyTheme(options.root, mode, resolveTheme(mode, mediaQuery?.matches ?? false));
  };
  mediaQuery?.addEventListener?.('change', synchronize);
  return () => mediaQuery?.removeEventListener?.('change', synchronize);
}
