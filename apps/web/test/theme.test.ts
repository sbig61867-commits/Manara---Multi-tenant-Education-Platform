import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyTheme,
  initializeTheme,
  normalizeThemeMode,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  synchronizeTheme,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from '../src/theme/theme.js';

function root() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle(token: string, force?: boolean) {
        if (force) classes.add(token);
        else classes.delete(token);
        return classes.has(token);
      },
    },
    dataset: {} as DOMStringMap,
    style: { colorScheme: '' },
  };
}

function storage(initial?: string, fail = false) {
  let value = initial ?? null;
  return {
    getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (fail) throw new Error('storage unavailable');
      return value;
    },
    setItem(key: string, next: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (fail) throw new Error('storage unavailable');
      value = next;
    },
    value: () => value,
  };
}

test('light, dark, and system modes resolve deterministically', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
});

test('invalid or unavailable stored preferences fail safely to system', () => {
  assert.equal(normalizeThemeMode('sepia'), 'system');
  assert.equal(readThemePreference(storage('sepia')), 'system');
  assert.equal(readThemePreference(storage(undefined, true)), 'system');
});

test('initialization applies explicit and system preferences to the root', () => {
  const explicitRoot = root();
  assert.deepEqual(
    initializeTheme({ root: explicitRoot, storage: storage('dark'), matchMedia: () => ({ matches: false }) }),
    { mode: 'dark', resolved: 'dark' },
  );
  assert.equal(explicitRoot.classes.has('dark'), true);
  assert.equal(explicitRoot.dataset.themeMode, 'dark');
  assert.equal(explicitRoot.style.colorScheme, 'dark');

  const systemRoot = root();
  assert.deepEqual(
    initializeTheme({ root: systemRoot, storage: storage('system'), matchMedia: () => ({ matches: true }) }),
    { mode: 'system', resolved: 'dark' },
  );
});

test('explicit preferences persist and still apply when storage fails', () => {
  const persisted = storage('system');
  const persistedRoot = root();
  assert.equal(
    setThemePreference('light', { root: persistedRoot, storage: persisted, matchMedia: () => ({ matches: true }) }),
    'light',
  );
  assert.equal(persisted.value(), 'light');
  assert.equal(persistedRoot.classes.has('dark'), false);

  const unavailableRoot = root();
  assert.doesNotThrow(() =>
    setThemePreference('dark', {
      root: unavailableRoot,
      storage: storage(undefined, true),
      matchMedia: () => ({ matches: false }),
    }),
  );
  assert.equal(unavailableRoot.classes.has('dark'), true);
});

test('system changes synchronize only through the current stored mode', () => {
  const current = storage('system');
  const target = root();
  let prefersDark = false;
  let listener: (() => void) | undefined;
  const query = {
    get matches() {
      return prefersDark;
    },
    addEventListener(_type: 'change', next: () => void) {
      listener = next;
    },
    removeEventListener(_type: 'change', next: () => void) {
      if (listener === next) listener = undefined;
    },
  };
  const dispose = synchronizeTheme({
    root: target,
    storage: current,
    matchMedia: (media) => {
      assert.equal(media, THEME_MEDIA_QUERY);
      return query;
    },
  });
  prefersDark = true;
  listener?.();
  assert.equal(target.classes.has('dark'), true);
  current.setItem(THEME_STORAGE_KEY, 'light' satisfies ThemeMode);
  prefersDark = false;
  listener?.();
  assert.equal(target.dataset.theme, 'light');
  dispose();
  assert.equal(listener, undefined);
});

test('theme application and pre-render initialization use the same contract', () => {
  const target = root();
  applyTheme(target, 'system', 'dark');
  assert.equal(target.dataset.theme, 'dark');
  assert.equal(target.dataset.themeMode, 'system');

  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  assert.match(html, /manara\.theme/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /classList\.toggle\('dark'/);
  assert.match(html, /data-theme-mode="system"/);
  assert.ok(html.indexOf('classList.toggle') < html.indexOf('<body>'), 'theme initializes before body rendering');
});

test('root CSS preserves visible focus, bidi isolation, skip links, and reduced motion', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/styles/index.css', import.meta.url)), 'utf8');
  assert.match(css, /\.skip-link:focus-visible/);
  assert.match(css, /unicode-bidi:\s*isolate/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
