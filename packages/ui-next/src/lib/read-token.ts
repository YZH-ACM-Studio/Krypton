export function readToken(name: `--${string}`, fallback?: string): string {
  if (typeof document === 'undefined') {
    return fallback ?? '';
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value === '') {
    return fallback ?? '';
  }
  return value;
}
