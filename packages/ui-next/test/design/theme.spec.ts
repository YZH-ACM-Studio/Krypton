// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

// Resolved when the test runs. A static import fails collection while src/lib/theme.ts is absent.
const themeLoaders = import.meta.glob('../../src/lib/theme.ts');

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeApi {
  THEME_BOOT_SCRIPT: string;
  THEME_STORAGE_KEY: string;
  applyTheme: (resolved: ResolvedTheme) => void;
  readThemePreference: (serverTheme?: string) => ThemePreference;
  resolveTheme: (pref: ThemePreference, systemDark: boolean) => ResolvedTheme;
  useThemePreference: (serverTheme?: string) => {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setPreference: (pref: ThemePreference) => void;
  };
  writeThemePreference: (pref: ThemePreference) => void;
}

function themeLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(themeLoaders)) {
    if (key.endsWith('src/lib/theme.ts')) {
      return load;
    }
  }
  return undefined;
}

function moduleField(moduleObject: object, key: string): unknown {
  if (!(key in moduleObject)) {
    return undefined;
  }
  return Reflect.get(moduleObject, key) as unknown;
}

function asThemeString(value: unknown, key: string): string {
  expect(typeof value, key).toBe('string');
  if (typeof value !== 'string') {
    throw new TypeError(`${key} must be a string`);
  }
  return value;
}

function asThemeFunction<T extends (...args: never[]) => unknown>(value: unknown, key: string): T {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as T;
}

async function loadTheme(): Promise<ThemeApi> {
  const load = themeLoader();
  expect(typeof load, 'src/lib/theme.ts').toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError('src/lib/theme.ts must exist');
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('theme module must be an object');
  }
  return {
    THEME_BOOT_SCRIPT: asThemeString(moduleField(imported, 'THEME_BOOT_SCRIPT'), 'THEME_BOOT_SCRIPT'),
    THEME_STORAGE_KEY: asThemeString(moduleField(imported, 'THEME_STORAGE_KEY'), 'THEME_STORAGE_KEY'),
    applyTheme: asThemeFunction<ThemeApi['applyTheme']>(moduleField(imported, 'applyTheme'), 'applyTheme'),
    readThemePreference: asThemeFunction<ThemeApi['readThemePreference']>(
      moduleField(imported, 'readThemePreference'),
      'readThemePreference',
    ),
    resolveTheme: asThemeFunction<ThemeApi['resolveTheme']>(moduleField(imported, 'resolveTheme'), 'resolveTheme'),
    useThemePreference: asThemeFunction<ThemeApi['useThemePreference']>(
      moduleField(imported, 'useThemePreference'),
      'useThemePreference',
    ),
    writeThemePreference: asThemeFunction<ThemeApi['writeThemePreference']>(
      moduleField(imported, 'writeThemePreference'),
      'writeThemePreference',
    ),
  };
}

type ChangeListener = (event: { matches: boolean }) => void;

interface MediaListenerOptions {
  once?: boolean;
}

interface SchemeMedia {
  matches: boolean;
  media: string;
  onchange: ChangeListener | null;
  addEventListener: (type: string, listener: ChangeListener, options?: MediaListenerOptions) => void;
  removeEventListener: (type: string, listener: ChangeListener) => void;
  addListener: (listener: ChangeListener) => void;
  removeListener: (listener: ChangeListener) => void;
  dispatchEvent: () => boolean;
}

function installColorScheme(initialMatches: boolean) {
  const listeners = new Map<ChangeListener, boolean>();
  let matches = initialMatches;
  let onchange: ChangeListener | null = null;
  const schemeList: SchemeMedia = {
    get matches() {
      return matches;
    },
    media: COLOR_SCHEME_QUERY,
    get onchange() {
      return onchange;
    },
    set onchange(listener: ChangeListener | null) {
      onchange = listener;
    },
    addEventListener(type: string, listener: ChangeListener, options?: MediaListenerOptions) {
      if (type === 'change') {
        listeners.set(listener, options?.once === true);
      }
    },
    removeEventListener(type: string, listener: ChangeListener) {
      if (type === 'change') {
        listeners.delete(listener);
      }
    },
    addListener(listener: ChangeListener) {
      listeners.set(listener, false);
    },
    removeListener(listener: ChangeListener) {
      listeners.delete(listener);
    },
    dispatchEvent() {
      return false;
    },
  };
  const matchMedia = vi.fn((query: string): SchemeMedia => {
    if (query === COLOR_SCHEME_QUERY) {
      return schemeList;
    }
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    };
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listenerCount() {
      return listeners.size + (onchange === null ? 0 : 1);
    },
    changeTo(next: boolean) {
      matches = next;
      const event = { matches };
      if (onchange !== null) {
        onchange(event);
      }
      for (const [listener, once] of [...listeners.entries()]) {
        if (once) {
          listeners.delete(listener);
        }
        listener(event);
      }
    },
  };
}

function stubBackgroundToken(value: string): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
    const declaration = {
      getPropertyValue(property: string): string {
        if (element !== document.documentElement || property !== '--bg') {
          return '';
        }
        return value;
      },
    };
    return declaration as CSSStyleDeclaration;
  });
}

function themeColorMeta(content: string): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = content;
  document.head.append(meta);
  return meta;
}

function runBootScript(script: string): void {
  // F06 acceptance executes the inlined boot string with the Function constructor.
  // eslint-disable-next-line no-new-func
  const execute = new Function(script) as () => void;
  execute();
}

function prepareBoot(stored: string | null, schemeMatches: boolean): void {
  document.documentElement.classList.remove('dark');
  if (stored === null) {
    localStorage.removeItem('krypton:theme');
  } else {
    localStorage.setItem('krypton:theme', stored);
  }
  installColorScheme(schemeMatches);
}

function bootAddsDark(script: string, stored: string | null, schemeMatches: boolean): boolean {
  prepareBoot(stored, schemeMatches);
  runBootScript(script);
  return document.documentElement.classList.contains('dark');
}

function inlineScriptsBeforeMarker(html: string): string[] {
  const markerAt = html.indexOf('<!--KRYPTON_HEAD-->');
  expect(markerAt).toBeGreaterThanOrEqual(0);
  const head = html.slice(0, markerAt);
  const scripts: string[] = [];
  const openTag = '<script>';
  const closeTag = '</script>';
  let cursor = 0;
  while (cursor < head.length) {
    const openAt = head.indexOf(openTag, cursor);
    if (openAt < 0) {
      break;
    }
    const bodyAt = openAt + openTag.length;
    const closeAt = head.indexOf(closeTag, bodyAt);
    expect(closeAt).toBeGreaterThanOrEqual(0);
    scripts.push(head.slice(bodyAt, closeAt));
    cursor = closeAt + closeTag.length;
  }
  return scripts;
}

function headBootAddsDark(html: string, stored: string | null, schemeMatches: boolean): boolean {
  prepareBoot(stored, schemeMatches);
  const scripts = inlineScriptsBeforeMarker(html);
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) {
    runBootScript(script);
  }
  return document.documentElement.classList.contains('dark');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.removeProperty('--bg');
  for (const node of document.head.querySelectorAll('meta[name="theme-color"]')) {
    node.remove();
  }
  Reflect.deleteProperty(window, '__KRYPTON_BOOTSTRAP__');
});

afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.style.removeProperty('--bg');
  for (const node of document.head.querySelectorAll('meta[name="theme-color"]')) {
    node.remove();
  }
  localStorage.clear();
  Reflect.deleteProperty(window, '__KRYPTON_BOOTSTRAP__');
});

describe('readThemePreference', () => {
  it('stores the preference under krypton:theme', async () => {
    const { THEME_STORAGE_KEY } = await loadTheme();
    expect(THEME_STORAGE_KEY).toBe('krypton:theme');
  });

  it('returns a stored light, dark, or system value unchanged', async () => {
    const { readThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'dark');
    expect(readThemePreference()).toBe('dark');
    expect(readThemePreference('light')).toBe('dark');

    localStorage.setItem('krypton:theme', 'system');
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference('dark')).toBe('system');

    localStorage.setItem('krypton:theme', 'light');
    expect(readThemePreference()).toBe('light');
    expect(readThemePreference('dark')).toBe('light');
  });

  it('falls back when the stored value is missing or not one of the three states', async () => {
    const { readThemePreference } = await loadTheme();
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference('light')).toBe('system');
    expect(readThemePreference('')).toBe('system');
    expect(readThemePreference('Dark')).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');

    localStorage.setItem('krypton:theme', 'blue');
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');

    localStorage.setItem('krypton:theme', '');
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');

    localStorage.setItem('krypton:theme', 'Dark');
    expect(readThemePreference()).toBe('system');

    localStorage.setItem('krypton:theme', 'dark ');
    expect(readThemePreference()).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');
  });

  it('uses the same fallback when localStorage.getItem throws', async () => {
    const { readThemePreference } = await loadTheme();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new TypeError('denied');
    });
    try {
      expect(readThemePreference()).toBe('system');
      expect(readThemePreference('light')).toBe('system');
      expect(readThemePreference('dark')).toBe('dark');
    } finally {
      getItem.mockRestore();
    }
  });
});

describe('resolveTheme', () => {
  it('follows the system only while the preference is system', async () => {
    const { resolveTheme } = await loadTheme();
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('toggles only the dark class on the document element', async () => {
    const { applyTheme } = await loadTheme();
    document.documentElement.className = 'sidebar-open';
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('sidebar-open')).toBe(true);

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('sidebar-open')).toBe(true);
  });

  it('sets an existing theme-color meta to the trimmed --bg token', async () => {
    const { applyTheme } = await loadTheme();
    stubBackgroundToken('  oklch(0.98 0.002 268)  ');
    const meta = themeColorMeta('#0f172a');
    applyTheme('dark');
    expect(meta.content).toBe('oklch(0.98 0.002 268)');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps the existing theme-color when --bg is empty', async () => {
    const { applyTheme } = await loadTheme();
    stubBackgroundToken('   ');
    const meta = themeColorMeta('#0f172a');
    applyTheme('light');
    expect(meta.content).toBe('#0f172a');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does not create a theme-color meta when the page has none', async () => {
    const { applyTheme } = await loadTheme();
    stubBackgroundToken('oklch(0.2 0 0)');
    applyTheme('dark');
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('updates theme-color from --bg when the resolved theme is light', async () => {
    const { applyTheme } = await loadTheme();
    stubBackgroundToken('oklch(0.99 0.001 268)');
    const meta = themeColorMeta('#111111');
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(meta.content).toBe('oklch(0.99 0.001 268)');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('writeThemePreference', () => {
  it('writes light, dark, and system under krypton:theme', async () => {
    const { THEME_STORAGE_KEY, writeThemePreference } = await loadTheme();
    writeThemePreference('dark');
    expect(localStorage.getItem('krypton:theme')).toBe('dark');
    writeThemePreference('light');
    expect(localStorage.getItem('krypton:theme')).toBe('light');
    writeThemePreference('system');
    expect(localStorage.getItem('krypton:theme')).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('swallows storage exceptions', async () => {
    const { writeThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'light');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new TypeError('quota');
    });
    try {
      expect(() => {
        writeThemePreference('dark');
      }).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('useThemePreference', () => {
  it('follows a system scheme change, then drops the listener when leaving system', async () => {
    const { useThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'system');
    const media = installColorScheme(false);
    const { result } = renderHook(() => useThemePreference());

    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(media.matchMedia).toHaveBeenCalledWith(COLOR_SCHEME_QUERY);
    expect(media.listenerCount()).toBeGreaterThan(0);

    act(() => {
      media.changeTo(true);
    });
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(media.listenerCount()).toBeGreaterThan(0);

    act(() => {
      result.current.setPreference('light');
    });
    expect(localStorage.getItem('krypton:theme')).toBe('light');
    expect(result.current.preference).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(media.listenerCount()).toBe(0);
  });

  it('keeps following later scheme changes while the preference stays system', async () => {
    const { useThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'system');
    const media = installColorScheme(true);
    const { result } = renderHook(() => useThemePreference());

    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => {
      media.changeTo(false);
    });
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(media.listenerCount()).toBeGreaterThan(0);

    act(() => {
      media.changeTo(true);
    });
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(media.listenerCount()).toBeGreaterThan(0);
  });

  it('does not subscribe when a stored light or dark preference wins over the server and the scheme', async () => {
    const { useThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'light');
    const lightMedia = installColorScheme(true);
    const light = renderHook(() => useThemePreference('dark'));
    expect(light.result.current.preference).toBe('light');
    expect(light.result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(lightMedia.listenerCount()).toBe(0);
    act(() => {
      lightMedia.changeTo(false);
    });
    expect(light.result.current.resolved).toBe('light');
    light.unmount();

    localStorage.setItem('krypton:theme', 'dark');
    const darkMedia = installColorScheme(false);
    const dark = renderHook(() => useThemePreference('light'));
    expect(dark.result.current.preference).toBe('dark');
    expect(dark.result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(darkMedia.listenerCount()).toBe(0);
    act(() => {
      darkMedia.changeTo(true);
    });
    expect(dark.result.current.resolved).toBe('dark');
    expect(darkMedia.listenerCount()).toBe(0);
  });

  it('starts a subscription when setPreference switches back to system', async () => {
    const { useThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'light');
    const media = installColorScheme(true);
    const { result } = renderHook(() => useThemePreference());
    expect(media.listenerCount()).toBe(0);

    act(() => {
      result.current.setPreference('system');
    });
    expect(localStorage.getItem('krypton:theme')).toBe('system');
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(media.listenerCount()).toBeGreaterThan(0);

    act(() => {
      result.current.setPreference('dark');
    });
    expect(localStorage.getItem('krypton:theme')).toBe('dark');
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(media.listenerCount()).toBe(0);
    act(() => {
      media.changeTo(false);
    });
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses the server theme only when storage has no preference', async () => {
    const { useThemePreference } = await loadTheme();
    const darkMedia = installColorScheme(false);
    const darkServer = renderHook(() => useThemePreference('dark'));
    expect(darkServer.result.current.preference).toBe('dark');
    expect(darkServer.result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(darkMedia.listenerCount()).toBe(0);
    darkServer.unmount();

    document.documentElement.classList.remove('dark');
    const lightMedia = installColorScheme(true);
    const lightServer = renderHook(() => useThemePreference('light'));
    expect(lightServer.result.current.preference).toBe('system');
    expect(lightServer.result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(lightMedia.listenerCount()).toBeGreaterThan(0);
  });

  it('uses the scheme at subscription time when switching back to system', async () => {
    const { useThemePreference } = await loadTheme();
    localStorage.setItem('krypton:theme', 'light');
    const media = installColorScheme(false);
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.resolved).toBe('light');
    expect(media.listenerCount()).toBe(0);

    act(() => {
      media.changeTo(true);
    });
    expect(result.current.resolved).toBe('light');

    act(() => {
      result.current.setPreference('system');
    });
    expect(localStorage.getItem('krypton:theme')).toBe('system');
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(media.listenerCount()).toBeGreaterThan(0);
  });

  it('applies the current system scheme on the first effect when preference starts as system', async () => {
    const { useThemePreference } = await loadTheme();
    installColorScheme(true);
    const applied: boolean[] = [];
    const originalToggle = DOMTokenList.prototype.toggle;
    const spy = vi.spyOn(DOMTokenList.prototype, 'toggle').mockImplementation(function toggleWithForce(
      this: DOMTokenList,
      token: string,
      force?: boolean,
    ): boolean {
      if (token === 'dark' && typeof force === 'boolean') {
        applied.push(force);
      }
      if (typeof force === 'boolean') {
        return originalToggle.call(this, token, force);
      }
      return originalToggle.call(this, token);
    });
    try {
      const { result } = renderHook(() => useThemePreference());
      expect(result.current.preference).toBe('system');
      expect(result.current.resolved).toBe('dark');
      expect(applied.length).toBeGreaterThan(0);
      expect(applied.every((value) => value === true)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('index.html', () => {
  it('inlines THEME_BOOT_SCRIPT in head before the KRYPTON_HEAD marker', async () => {
    const { THEME_BOOT_SCRIPT } = await loadTheme();
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    const headAt = html.indexOf('<head');
    const scriptAt = html.indexOf(`<script>${THEME_BOOT_SCRIPT}</script>`);
    const markerAt = html.indexOf('<!--KRYPTON_HEAD-->');
    expect(headAt).toBeGreaterThanOrEqual(0);
    expect(scriptAt).toBeGreaterThan(headAt);
    expect(markerAt).toBeGreaterThan(scriptAt);
  });

  it('keeps the original theme-color meta value', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    expect(html).toContain('content="#0f172a"');
  });

  it('executes every inline head script before KRYPTON_HEAD with the boot rules', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
    expect(headBootAddsDark(html, 'dark', false)).toBe(true);
    expect(headBootAddsDark(html, 'light', true)).toBe(false);
    expect(headBootAddsDark(html, null, true)).toBe(true);
    expect(headBootAddsDark(html, null, false)).toBe(false);
    expect(headBootAddsDark(html, 'system', false)).toBe(false);
    expect(headBootAddsDark(html, 'blue', true)).toBe(true);
  });
});

describe('theme boot script', () => {
  it('adds dark for a dark preference, leaves light alone, and otherwise follows the scheme', async () => {
    const { THEME_BOOT_SCRIPT } = await loadTheme();
    expect(THEME_BOOT_SCRIPT).not.toContain('__KRYPTON_BOOTSTRAP__');
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'dark', false)).toBe(true);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'light', true)).toBe(false);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, null, true)).toBe(true);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, null, false)).toBe(false);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'system', true)).toBe(true);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'system', false)).toBe(false);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'blue', true)).toBe(true);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'blue', false)).toBe(false);
  });

  it('clears a dark class already on the document element when the boot result is light', async () => {
    const { THEME_BOOT_SCRIPT } = await loadTheme();
    document.documentElement.classList.add('dark');
    localStorage.setItem('krypton:theme', 'light');
    installColorScheme(true);
    runBootScript(THEME_BOOT_SCRIPT);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    document.documentElement.classList.add('sidebar-open', 'dark');
    localStorage.removeItem('krypton:theme');
    installColorScheme(false);
    runBootScript(THEME_BOOT_SCRIPT);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('sidebar-open')).toBe(true);
  });

  it('does not read the bootstrap payload that is assigned later in the body', async () => {
    const { THEME_BOOT_SCRIPT } = await loadTheme();
    Reflect.set(window, '__KRYPTON_BOOTSTRAP__', { theme: 'dark' });
    expect(bootAddsDark(THEME_BOOT_SCRIPT, null, false)).toBe(false);
    expect(bootAddsDark(THEME_BOOT_SCRIPT, 'light', true)).toBe(false);
  });

  it('swallows localStorage and matchMedia failures', async () => {
    const { THEME_BOOT_SCRIPT } = await loadTheme();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new TypeError('denied');
    });
    try {
      expect(() => {
        runBootScript(THEME_BOOT_SCRIPT);
      }).not.toThrow();
    } finally {
      getItem.mockRestore();
    }

    localStorage.removeItem('krypton:theme');
    vi.stubGlobal('matchMedia', () => {
      throw new TypeError('no matchMedia');
    });
    expect(() => {
      runBootScript(THEME_BOOT_SCRIPT);
    }).not.toThrow();
  });
});
