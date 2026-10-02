/**
 * Krypton design tokens — the single generator.
 *
 * Every colour, radius, size and duration in the system is derived from the
 * handful of `DesignParams` below. The playground tunes the params live; the
 * final values are exported as static CSS (`tokensToCss`) and committed.
 *
 * Colour space is OKLCH so that a hue change keeps perceived lightness — a
 * yellow accent and a blue accent at the same L read as equally heavy.
 */

export type Density = 'compact' | 'default' | 'comfortable';

export const FONTS = {
  mona: { label: 'Mona Sans', stack: "'Mona Sans Variable'" },
  inter: { label: 'Inter', stack: "'Inter Variable'" },
  instrument: { label: 'Instrument Sans', stack: "'Instrument Sans Variable'" },
  plex: { label: 'IBM Plex Sans', stack: "'IBM Plex Sans Variable'" },
  onest: { label: 'Onest', stack: "'Onest Variable'" },
  system: { label: '系统字体', stack: 'system-ui' },
} as const;
export type FontKey = keyof typeof FONTS;

export interface DesignParams {
  /** Accent hue, 0–360. */
  brandHue: number;
  /** Accent chroma, ~0.08 (muted) – 0.24 (vivid). */
  brandChroma: number;
  /** Hue the neutrals lean towards. */
  neutralHue: number;
  /** How much the neutrals lean, 0 (pure grey) – 0.03 (clearly tinted). */
  neutralTint: number;
  /** Base control radius in px. */
  radius: number;
  density: Density;
  /** Latin UI face; CJK always falls through to the platform face. */
  font: FontKey;
  /** Body font size in px. */
  fontSize: number;
  /** Multiplier on every duration; 0 disables motion. */
  motionScale: number;
}

export const DEFAULT_PARAMS: DesignParams = {
  brandHue: 268,
  brandChroma: 0.17,
  neutralHue: 268,
  neutralTint: 0.006,
  radius: 7,
  density: 'default',
  font: 'mona',
  fontSize: 14,
  motionScale: 1,
};

export const TONES = ['success', 'warning', 'danger', 'info', 'violet', 'orange'] as const;
export type Tone = (typeof TONES)[number];

/** Fixed semantic hues/chromas. Not user-tunable: meaning must not drift. */
const TONE_SPEC: Record<Tone, { h: number; c: number }> = {
  success: { h: 152, c: 0.15 },
  warning: { h: 75, c: 0.15 },
  danger: { h: 25, c: 0.19 },
  info: { h: 235, c: 0.13 },
  violet: { h: 300, c: 0.16 },
  orange: { h: 48, c: 0.16 },
};

type Mode = 'light' | 'dark';
type TokenMap = Record<string, string>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function ok(l: number, c: number, h: number, a?: number): string {
  const base = `${r3(l)} ${r3(c)} ${Math.round(h)}`;
  return a === undefined ? `oklch(${base})` : `oklch(${base} / ${a})`;
}

function neutrals(p: DesignParams, mode: Mode): TokenMap {
  const h = p.neutralHue;
  const t = p.neutralTint;
  if (mode === 'light') {
    return {
      '--bg': ok(0.982, t * 0.8, h),
      '--surface': ok(1, 0, h),
      '--surface-sunken': ok(0.97, t, h),
      '--surface-raised': ok(1, 0, h),
      '--surface-hover': ok(0.962, t * 1.2, h),
      '--surface-active': ok(0.942, t * 1.4, h),
      '--line-subtle': ok(0.944, t, h),
      '--line': ok(0.915, t * 1.2, h),
      '--line-strong': ok(0.865, t * 1.4, h),
      '--fg': ok(0.205, t * 2.5, h),
      '--fg-muted': ok(0.45, t * 2.5, h),
      '--fg-subtle': ok(0.54, t * 2, h),
      '--fg-disabled': ok(0.74, t * 1.5, h),
      '--scrim': ok(0.2, t * 2, h, 0.32),
    };
  }
  return {
    '--bg': ok(0.148, t * 1.4, h),
    '--surface': ok(0.178, t * 1.6, h),
    '--surface-sunken': ok(0.158, t * 1.4, h),
    '--surface-raised': ok(0.215, t * 1.8, h),
    '--surface-hover': ok(0.222, t * 1.8, h),
    '--surface-active': ok(0.252, t * 2, h),
    '--line-subtle': ok(0.218, t * 1.6, h),
    '--line': ok(0.262, t * 1.8, h),
    '--line-strong': ok(0.33, t * 2, h),
    '--fg': ok(0.962, t * 0.8, h),
    '--fg-muted': ok(0.74, t * 1.4, h),
    '--fg-subtle': ok(0.6, t * 1.6, h),
    '--fg-disabled': ok(0.45, t * 1.6, h),
    '--scrim': ok(0.08, t, h, 0.6),
  };
}

/** One coloured ramp: solid fill, readable text, soft wash, outline. */
function ramp(name: string, h: number, c: number, mode: Mode, darkOnSolid = false): TokenMap {
  if (mode === 'light') {
    return {
      [`--${name}-solid`]: ok(darkOnSolid ? 0.78 : 0.53, c, h),
      [`--${name}-solid-hover`]: ok(darkOnSolid ? 0.73 : 0.48, c, h),
      [`--${name}-fg`]: ok(darkOnSolid ? 0.5 : 0.5, c * 0.95, h),
      [`--${name}-soft`]: ok(0.962, c * 0.16, h),
      [`--${name}-soft-hover`]: ok(0.935, c * 0.24, h),
      [`--${name}-line`]: ok(0.86, c * 0.42, h),
      [`--on-${name}`]: darkOnSolid ? ok(0.22, c * 0.4, h) : ok(1, 0, 0),
    };
  }
  return {
    [`--${name}-solid`]: ok(darkOnSolid ? 0.8 : 0.54, c, h),
    [`--${name}-solid-hover`]: ok(darkOnSolid ? 0.85 : 0.59, c, h),
    [`--${name}-fg`]: ok(0.78, c * 0.8, h),
    [`--${name}-soft`]: ok(0.255, c * 0.3, h),
    [`--${name}-soft-hover`]: ok(0.29, c * 0.38, h),
    [`--${name}-line`]: ok(0.4, c * 0.5, h),
    [`--on-${name}`]: darkOnSolid ? ok(0.2, c * 0.4, h) : ok(1, 0, 0),
  };
}

function colors(p: DesignParams, mode: Mode): TokenMap {
  const out: TokenMap = { ...neutrals(p, mode), ...ramp('brand', p.brandHue, p.brandChroma, mode) };
  for (const tone of TONES) {
    const spec = TONE_SPEC[tone];
    Object.assign(out, ramp(tone, spec.h, spec.c, mode, tone === 'warning'));
  }
  out['--ring'] = ok(mode === 'light' ? 0.6 : 0.7, p.brandChroma, p.brandHue, 0.55);
  out['--selection'] = ok(mode === 'light' ? 0.88 : 0.4, p.brandChroma * 0.5, p.brandHue, 0.6);
  const chartL = mode === 'light' ? 0.6 : 0.7;
  const chartHues = [p.brandHue, 152, 235, 75, 300, 25];
  chartHues.forEach((h, i) => {
    out[`--chart-${i + 1}`] = ok(chartL, i === 0 ? p.brandChroma : 0.15, h);
  });
  const sh = p.neutralHue;
  if (mode === 'light') {
    out['--shadow-xs'] = `0 1px 2px ${ok(0.2, 0.02, sh, 0.06)}`;
    out['--shadow-sm'] = `0 1px 3px ${ok(0.2, 0.02, sh, 0.08)}, 0 1px 2px -1px ${ok(0.2, 0.02, sh, 0.06)}`;
    out['--shadow-pop'] = `0 0 0 1px ${ok(0.2, 0.02, sh, 0.06)}, 0 4px 8px -4px ${ok(0.2, 0.02, sh, 0.08)}, 0 16px 32px -8px ${ok(0.2, 0.02, sh, 0.16)}`;
  } else {
    out['--shadow-xs'] = `0 1px 2px ${ok(0, 0, 0, 0.4)}`;
    out['--shadow-sm'] = `inset 0 1px 0 ${ok(1, 0, 0, 0.03)}, 0 1px 3px ${ok(0, 0, 0, 0.4)}`;
    out['--shadow-pop'] = `inset 0 1px 0 ${ok(1, 0, 0, 0.05)}, 0 0 0 1px ${ok(0, 0, 0, 0.5)}, 0 16px 40px -8px ${ok(0, 0, 0, 0.65)}`;
  }
  return out;
}

const DENSITY: Record<Density, { sm: number; md: number; lg: number; row: number; gap: number }> = {
  compact: { sm: 26, md: 30, lg: 36, row: 34, gap: 12 },
  default: { sm: 28, md: 34, lg: 40, row: 40, gap: 16 },
  comfortable: { sm: 32, md: 38, lg: 44, row: 48, gap: 20 },
};

function shape(p: DesignParams): TokenMap {
  const r = p.radius;
  const d = DENSITY[p.density];
  const fs = p.fontSize;
  const ms = (n: number) => `${Math.round(n * p.motionScale)}ms`;
  return {
    '--font-ui': FONTS[p.font].stack,
    '--r-sm': `${Math.max(2, Math.round(r * 0.66))}px`,
    '--r-md': `${r}px`,
    '--r-lg': `${Math.round(r * 1.5)}px`,
    '--r-xl': `${Math.round(r * 2)}px`,
    '--control-sm': `${d.sm}px`,
    '--control-md': `${d.md}px`,
    '--control-lg': `${d.lg}px`,
    '--row-h': `${d.row}px`,
    '--gap': `${d.gap}px`,
    '--fs-2xs': `${fs - 3}px`,
    '--fs-xs': `${fs - 2}px`,
    '--fs-sm': `${fs - 1}px`,
    '--fs-md': `${fs}px`,
    '--fs-lg': `${fs + 2}px`,
    '--fs-xl': `${fs + 6}px`,
    '--fs-2xl': `${fs + 10}px`,
    '--fs-3xl': `${fs + 16}px`,
    '--dur-1': ms(100),
    '--dur-2': ms(160),
    '--dur-3': ms(240),
    '--dur-4': ms(360),
    '--motion-ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
    '--motion-ease-in': 'cubic-bezier(0.55, 0, 1, 0.45)',
    '--motion-ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  };
}

export function buildTokens(p: DesignParams, mode: Mode): TokenMap {
  return mode === 'light' ? { ...shape(p), ...colors(p, mode) } : colors(p, mode);
}

function block(selector: string, map: TokenMap): string {
  const body = Object.entries(map)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

export function tokensToCss(p: DesignParams): string {
  return [
    `/* krypton tokens — generated from ${JSON.stringify(p)} */`,
    block(':root', { 'color-scheme': 'light', ...buildTokens(p, 'light') }),
    block('.dark', { 'color-scheme': 'dark', ...buildTokens(p, 'dark') }),
    '@media (prefers-reduced-motion: reduce) {\n  :root { --dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; --dur-4: 0ms; }\n}',
  ].join('\n\n');
}

const OKLCH_PATTERN = /^oklch\(\s*([+-]?(?:\d+\.\d+|\d+|\.\d+))\s+([+-]?(?:\d+\.\d+|\d+|\.\d+))\s+([+-]?(?:\d+\.\d+|\d+|\.\d+))(?:\s*\/\s*([+-]?(?:\d+\.\d+|\d+|\.\d+)))?\s*\)$/;

/** Parse a generated `oklch(L C H)` or `oklch(L C H / A)` token. Anything else throws. */
export function parseOklch(value: string): { l: number; c: number; h: number; alpha: number } {
  const match = OKLCH_PATTERN.exec(value);
  if (!match) {
    throw new Error(`expected an oklch() color, got ${JSON.stringify(value)}`);
  }
  const l = Number(match[1]);
  const c = Number(match[2]);
  const h = Number(match[3]);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h) || !Number.isFinite(alpha)) {
    throw new TypeError(`expected finite oklch channels, got ${JSON.stringify(value)}`);
  }
  return { l, c, h, alpha };
}

function clipUnit(channel: number): number {
  return Math.min(1, Math.max(0, channel));
}

/**
 * Björn Ottosson OKLab → linear sRGB.
 * `a = C·cos(h)`, `b = C·sin(h)`, then l′/m′/s′, cube, then the LMS→sRGB matrix.
 * Each returned channel is clipped to [0, 1]. These values are already linear.
 */
export function oklchToLinearSrgb(l: number, c: number, h: number): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lCone = l + 0.3963377774 * a + 0.2158037573 * b;
  const mCone = l - 0.1055613458 * a - 0.0638541728 * b;
  const sCone = l - 0.0894841775 * a - 1.2914855480 * b;
  const lCube = lCone * lCone * lCone;
  const mCube = mCone * mCone * mCone;
  const sCube = sCone * sCone * sCone;
  const red = 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const green = -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const blue = -0.0041960863 * lCube - 0.7034186147 * mCube + 1.7076147010 * sCube;
  return [clipUnit(red), clipUnit(green), clipUnit(blue)];
}

function relativeLuminance(oklch: string): number {
  const { l, c, h } = parseOklch(oklch);
  const [red, green, blue] = oklchToLinearSrgb(l, c, h);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast of two `oklch(L C H)` colors. Alpha is ignored; no gamma decode. */
export function contrastRatio(a: string, b: string): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}
