import React, { useEffect, useState } from 'react';
import {
  readThemePreference,
  setThemePreference,
  type ThemeMode,
} from '../../theme/theme';

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemePreference(undefined));

  useEffect(() => {
    if (typeof window !== 'undefined') setMode(readThemePreference(window.localStorage));
  }, []);

  function toggle() {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    if (typeof window !== 'undefined') {
      setThemePreference(next, { root: document.documentElement });
    }
  }

  const isDark = mode === 'dark';

  return (
    <button
      aria-pressed={isDark}
      className="theme-toggle"
      onClick={toggle}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle__icon">
        {isDark ? '☀' : '☾'}
      </span>
      <span className="theme-toggle__label">
        {isDark ? 'Light' : 'Dark'}
      </span>
    </button>
  );
}
