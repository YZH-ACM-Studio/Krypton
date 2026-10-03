import * as React from 'react';
import { DEFAULT_PARAMS, type DesignParams, tokensToCss } from '@/design/tokens';

export type ThemePref = 'light' | 'dark' | 'system';

const PARAMS_KEY = 'kr-playground:params';
const THEME_KEY = 'kr-playground:theme';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...(fallback as object), ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Params + theme live in localStorage so the viewport iframes (same origin)
 * follow every tweak through the `storage` event.
 */
export function usePlaygroundState() {
  const [params, setParamsState] = React.useState<DesignParams>(() => read(PARAMS_KEY, DEFAULT_PARAMS));
  const [theme, setThemeState] = React.useState<ThemePref>(readTheme);

  const setParams = React.useCallback((patch: Partial<DesignParams> | ((p: DesignParams) => DesignParams)) => {
    setParamsState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      try {
        localStorage.setItem(PARAMS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const setTheme = React.useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }, []);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PARAMS_KEY) setParamsState(read(PARAMS_KEY, DEFAULT_PARAMS));
      if (e.key === THEME_KEY) setThemeState(readTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Inject generated tokens.
  React.useEffect(() => {
    let el = document.getElementById('kr-tokens') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'kr-tokens';
      document.head.appendChild(el);
    }
    el.textContent = tokensToCss(params);
  }, [params]);

  // Resolve theme preference to the `.dark` class.
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const reset = React.useCallback(() => setParams(DEFAULT_PARAMS), [setParams]);

  return { params, setParams, theme, setTheme, reset };
}
