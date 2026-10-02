import { useEffect, useState } from 'react';

export const BREAKPOINTS = Object.freeze({
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '3xl': 1920,
} as const);

function matchMediaOf(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(query);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMediaOf(query)?.matches ?? false);

  useEffect(() => {
    const media = matchMediaOf(query);
    if (!media) {
      return undefined;
    }
    const onChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}

export function useBreakpoint(bp: keyof typeof BREAKPOINTS): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`);
}
