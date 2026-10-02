import { useCallback, useEffect, useState } from 'react';
import { readToken } from '@/lib/read-token';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'krypton:theme';

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

// Inlined in <head> before the body assigns window.__KRYPTON_BOOTSTRAP__.
// Keep it dependency-free: it must not read that payload or any module.
export const THEME_BOOT_SCRIPT = `(function(){try{var stored=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var dark=stored==='dark'||(stored!=='light'&&window.matchMedia(${JSON.stringify(COLOR_SCHEME_QUERY)}).matches);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function preferenceWithoutStorage(serverTheme: string | undefined): ThemePreference {
  return serverTheme === 'dark' ? 'dark' : 'system';
}

export function readThemePreference(serverTheme?: string): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) {
      return stored;
    }
  } catch {
    // Denied storage is the same as a missing preference.
  }
  return preferenceWithoutStorage(serverTheme);
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return pref;
}

export function applyTheme(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!(meta instanceof HTMLMetaElement)) {
    return;
  }
  const background = readToken('--bg');
  if (background === '') {
    return;
  }
  meta.content = background;
}

export function writeThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Quota or denied storage must not break the in-memory preference.
  }
}

function readSystemDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(COLOR_SCHEME_QUERY).matches;
}

export function useThemePreference(serverTheme?: string): {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (pref: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference(serverTheme));
  const [systemDark, setSystemDark] = useState(() => readSystemDark());
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (preference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const media = window.matchMedia(COLOR_SCHEME_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    writeThemePreference(pref);
    setPreferenceState(pref);
  }, []);

  return { preference, resolved, setPreference };
}
