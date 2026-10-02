// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREAKPOINTS, useBreakpoint, useMediaQuery } from '../../src/components/ui/media.ts';
import { EASE_IN, EASE_OUT, EASE_STANDARD, MOTION, useMotionTokens } from '../../src/components/ui/motion.ts';
import { readToken } from '../../src/lib/read-token.ts';

type ChangeListener = (event: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<ChangeListener>();
  let matches = initialMatches;
  const removeEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === 'change') {
      listeners.delete(listener);
    }
  });
  const addEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === 'change') {
      listeners.add(listener);
    }
  });
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener,
    removeEventListener,
    dispatchEvent: vi.fn(() => false),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    removeEventListener,
    changeTo(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) {
        listener({ matches: next });
      }
    },
  };
}

// jsdom's document getter is non-configurable, so the no-document path runs in plain Node.
function readTokenWithoutDocument(): { fallback: string; empty: string } {
  const readTokenModule = resolve(import.meta.dirname, '../../src/lib/read-token.ts');
  const script = [
    `import { readToken } from ${JSON.stringify(readTokenModule)};`,
    "if (typeof document !== 'undefined') throw new TypeError('document was defined');",
    "const fallback = readToken('--bg', 'fb');",
    "const empty = readToken('--bg');",
    'process.stdout.write(JSON.stringify({ fallback, empty }));',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new TypeError(result.stderr || `node exited ${String(result.status)}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError(`unexpected readToken output: ${result.stdout}`);
  }
  const fallback = 'fallback' in parsed ? parsed.fallback : undefined;
  const empty = 'empty' in parsed ? parsed.empty : undefined;
  if (typeof fallback !== 'string' || typeof empty !== 'string') {
    throw new TypeError(`unexpected readToken output: ${result.stdout}`);
  }
  return { fallback, empty };
}

afterEach(() => {
  document.documentElement.style.removeProperty('--x-test');
  document.body.style.removeProperty('--x-test');
});

describe('motion tokens', () => {
  it('copies the §6.1 durations, easings, and spring onto MOTION', () => {
    expect(EASE_OUT).toEqual([0.16, 1, 0.3, 1]);
    expect(EASE_IN).toEqual([0.55, 0, 1, 0.45]);
    expect(EASE_STANDARD).toEqual([0.2, 0, 0, 1]);
    expect(MOTION.enter).toEqual({ duration: 0.24, ease: [0.16, 1, 0.3, 1] });
    expect(MOTION.exit.duration).toBe(0.16);
    expect(MOTION.exit.ease).toEqual([0.55, 0, 1, 0.45]);
    expect(MOTION.state.ease).toEqual([0.2, 0, 0, 1]);
    expect(MOTION.state.duration).toBe(0.16);
    expect(MOTION.spring).toEqual({ type: 'spring', stiffness: 560, damping: 42, mass: 0.7 });
  });

  it('returns the same MOTION object from useMotionTokens', () => {
    const { result } = renderHook(() => useMotionTokens());
    expect(result.current).toBe(MOTION);
  });

  it('freezes MOTION and its inner transition objects', () => {
    expect(Object.isFrozen(MOTION) && Object.isFrozen(MOTION.enter)).toBe(true);
    expect(Object.isFrozen(MOTION.exit)).toBe(true);
    expect(Object.isFrozen(MOTION.state)).toBe(true);
    expect(Object.isFrozen(MOTION.spring)).toBe(true);
  });
});

describe('media queries', () => {
  it('lists the five width breakpoints', () => {
    expect(BREAKPOINTS).toEqual({
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '3xl': 1920,
    });
  });

  it('follows a matchMedia change and removes the listener on unmount', () => {
    const media = installMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));

    expect(result.current).toBe(false);

    act(() => {
      media.changeTo(true);
    });
    expect(result.current).toBe(true);

    media.removeEventListener.mockClear();
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('asks matchMedia for the lg breakpoint', () => {
    const media = installMatchMedia(false);
    renderHook(() => useBreakpoint('lg'));
    expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });

  it('returns false without throwing when matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const query = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(query.result.current).toBe(false);
    const breakpoint = renderHook(() => useBreakpoint('md'));
    expect(breakpoint.result.current).toBe(false);
  });
});

describe('readToken', () => {
  it('trims a custom property and falls back when it is missing', () => {
    document.documentElement.style.setProperty('--x-test', ' 12px ');
    expect(readToken('--x-test')).toBe('12px');
    expect(readToken('--missing', 'fb')).toBe('fb');
    expect(readToken('--missing')).toBe('');
  });

  it('returns the fallback when document does not exist', () => {
    const result = readTokenWithoutDocument();
    expect(result.fallback).toBe('fb');
    expect(result.empty).toBe('');
  });
});

type ListenOptions = boolean | { once?: boolean };

function installTrackingMatchMedia(initialMatches: boolean) {
  const listeners = new Set<ChangeListener>();
  const onceListeners = new Set<ChangeListener>();
  let matches = initialMatches;
  const addEventListener = vi.fn((
    type: string,
    listener: ChangeListener,
    options?: ListenOptions,
  ) => {
    if (type !== 'change') {
      return;
    }
    listeners.add(listener);
    if (typeof options === 'object' && options !== null && options.once === true) {
      onceListeners.add(listener);
    }
  });
  const removeEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type !== 'change') {
      return;
    }
    listeners.delete(listener);
    onceListeners.delete(listener);
  });
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener,
    removeEventListener,
    dispatchEvent: vi.fn(() => false),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    listenerCount() {
      return listeners.size;
    },
    setCurrent(next: boolean) {
      matches = next;
    },
    changeTo(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) {
        listener({ matches: next });
        if (onceListeners.has(listener)) {
          listeners.delete(listener);
          onceListeners.delete(listener);
        }
      }
    },
  };
}

function stubComputedToken(value: string): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
    const getPropertyValue = (property: string): string => {
      if (element !== document.documentElement || property !== '--x-test') {
        return '';
      }
      return value;
    };
    return { getPropertyValue } as CSSStyleDeclaration;
  });
}

function QueryText({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return createElement('span', null, matches ? 'yes' : 'no');
}

function mediaWithoutWindow(): string {
  const mediaModule = resolve(import.meta.dirname, '../../src/components/ui/media.ts');
  const script = [
    "import { createElement } from 'react';",
    "import { renderToString } from 'react-dom/server';",
    `import { useBreakpoint, useMediaQuery } from ${JSON.stringify(mediaModule)};`,
    "if (typeof window !== 'undefined') throw new TypeError('window was defined');",
    'function Probe() {',
    "  const query = useMediaQuery('(min-width: 1024px)');",
    "  const breakpoint = useBreakpoint('sm');",
    "  return createElement('span', null, String(query) + '|' + String(breakpoint));",
    '}',
    'process.stdout.write(renderToString(createElement(Probe)));',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new TypeError(result.stderr || `node exited ${String(result.status)}`);
  }
  return result.stdout;
}

describe('motion token immutability', () => {
  it('freezes nested ease tuples so a caller cannot rewrite a shared curve', () => {
    expect(Object.isFrozen(MOTION.enter.ease)).toBe(true);
    expect(Object.isFrozen(MOTION.exit.ease)).toBe(true);
    expect(Object.isFrozen(MOTION.state.ease)).toBe(true);
  });
});

describe('media query subscriptions', () => {
  it('reports the initial match before effects run', () => {
    installMatchMedia(true);
    const html = renderToString(createElement(QueryText, { query: '(min-width: 1280px)' }));
    expect(html).toContain('yes');
  });

  it('re-reads matches when the query changes, without a change event', () => {
    const media = installTrackingMatchMedia(false);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: '(min-width: 640px)' } },
    );
    expect(result.current).toBe(false);
    media.setCurrent(true);
    rerender({ query: '(min-width: 768px)' });
    expect(result.current).toBe(true);
  });

  it('keeps following later changes instead of only the first one', () => {
    const media = installTrackingMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    act(() => {
      media.changeTo(true);
    });
    expect(result.current).toBe(true);
    act(() => {
      media.changeTo(false);
    });
    expect(result.current).toBe(false);
  });

  it('removes the same change listener it subscribed', () => {
    const media = installTrackingMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('asks matchMedia for a min-width query at every breakpoint', () => {
    const cases: Array<[keyof typeof BREAKPOINTS, string]> = [
      ['sm', '(min-width: 640px)'],
      ['md', '(min-width: 768px)'],
      ['lg', '(min-width: 1024px)'],
      ['xl', '(min-width: 1280px)'],
      ['3xl', '(min-width: 1920px)'],
    ];
    for (const [bp, query] of cases) {
      const media = installMatchMedia(false);
      renderHook(() => useBreakpoint(bp));
      expect(media.matchMedia).toHaveBeenCalledWith(query);
    }
  });

  it('returns false on the server when window is missing', () => {
    expect(mediaWithoutWindow()).toContain('false|false');
  });
});

describe('readToken resolution', () => {
  it('reads the document element even when body sets another value', () => {
    document.documentElement.style.setProperty('--x-test', '12px');
    document.body.style.setProperty('--x-test', '99px');
    expect(readToken('--x-test')).toBe('12px');
  });

  it('keeps a present value when a fallback was also passed', () => {
    document.documentElement.style.setProperty('--x-test', '12px');
    expect(readToken('--x-test', 'fb')).toBe('12px');
  });

  it('trims the computed value before treating it as missing', () => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    try {
      stubComputedToken('  12px  ');
      expect(readToken('--x-test')).toBe('12px');
      stubComputedToken('   ');
      expect(readToken('--x-test', 'fb')).toBe('fb');
    } finally {
      spy.mockRestore();
    }
  });
});
