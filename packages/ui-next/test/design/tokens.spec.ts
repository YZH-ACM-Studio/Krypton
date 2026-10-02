// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTokens,
  contrastRatio,
  DEFAULT_PARAMS,
  oklchToLinearSrgb,
  parseOklch,
  tokensToCss,
} from '../../src/design/tokens.ts';

const NEUTRAL_KEYS = [
  '--bg',
  '--surface',
  '--surface-sunken',
  '--surface-raised',
  '--surface-hover',
  '--surface-active',
  '--line-subtle',
  '--line',
  '--line-strong',
  '--fg',
  '--fg-muted',
  '--fg-subtle',
  '--fg-disabled',
  '--scrim',
] as const;

const RAMP_NAMES = ['brand', 'success', 'warning', 'danger', 'info', 'violet', 'orange'] as const;

const RAMP_KEYS = RAMP_NAMES.flatMap((name) => [
  `--${name}-solid`,
  `--${name}-solid-hover`,
  `--${name}-fg`,
  `--${name}-soft`,
  `--${name}-soft-hover`,
  `--${name}-line`,
  `--on-${name}`,
]);

const OTHER_KEYS = [
  '--ring',
  '--selection',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow-pop',
] as const;

const SHAPE_KEYS = [
  '--font-ui',
  '--r-sm',
  '--r-md',
  '--r-lg',
  '--r-xl',
  '--control-sm',
  '--control-md',
  '--control-lg',
  '--row-h',
  '--gap',
  '--fs-2xs',
  '--fs-xs',
  '--fs-sm',
  '--fs-md',
  '--fs-lg',
  '--fs-xl',
  '--fs-2xl',
  '--fs-3xl',
  '--dur-1',
  '--dur-2',
  '--dur-3',
  '--dur-4',
  '--motion-ease-out',
  '--motion-ease-in',
  '--motion-ease-standard',
] as const;

const COLOR_KEYS = [...NEUTRAL_KEYS, ...RAMP_KEYS, ...OTHER_KEYS];

function expectTokenKeys(tokens: Record<string, string>, keys: readonly string[]): void {
  for (const key of keys) {
    expect(tokens, key).to.have.property(key).that.is.a('string');
  }
}

function expectMinContrast(
  tokens: Record<string, string>,
  foreground: string,
  background: string,
  minimum: number,
): void {
  const foregroundValue = tokens[foreground];
  const backgroundValue = tokens[background];
  if (typeof foregroundValue !== 'string' || typeof backgroundValue !== 'string') {
    expect.fail(`${foreground} or ${background} is missing`);
  }
  const ratio = contrastRatio(foregroundValue, backgroundValue);
  expect(ratio, `${foreground} / ${background} = ${ratio}`).to.be.at.least(minimum);
}

function reducedMotionBlock(css: string): string {
  const marker = '@media (prefers-reduced-motion: reduce)';
  const start = css.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing ${marker}`);
  }
  const block = css.slice(start);
  const open = block.indexOf('{');
  if (open < 0) {
    throw new Error(`unclosed ${marker} block`);
  }
  let depth = 0;
  for (let index = open; index < block.length; index += 1) {
    const char = block[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return block.slice(0, index + 1);
    }
  }
  throw new Error(`unclosed ${marker} block`);
}

describe('design token generator', () => {
  it('uses the locked default design params', () => {
    expect(DEFAULT_PARAMS).to.deep.equal({
      brandHue: 268,
      brandChroma: 0.17,
      neutralHue: 268,
      neutralTint: 0.006,
      radius: 7,
      density: 'default',
      font: 'mona',
      fontSize: 14,
      motionScale: 1,
    });
  });

  it('keeps generated tokens.css identical to tokensToCss(DEFAULT_PARAMS)', () => {
    const tokensCssPath = resolve(import.meta.dirname, '../../src/design/tokens.css');
    expect(readFileSync(tokensCssPath, 'utf8')).to.equal(`${tokensToCss(DEFAULT_PARAMS)}\n`);
  });

  it('rewrites tokens.css from the default params when the generator script runs', () => {
    const tokensCssPath = resolve(import.meta.dirname, '../../src/design/tokens.css');
    const scriptPath = resolve(import.meta.dirname, '../../src/design/build-tokens.ts');
    const original = readFileSync(tokensCssPath, 'utf8');
    writeFileSync(tokensCssPath, '/* not generated */\n');
    try {
      const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
      expect(result.status, result.stderr ?? '').to.equal(0);
      expect(readFileSync(tokensCssPath, 'utf8')).to.equal(`${tokensToCss(DEFAULT_PARAMS)}\n`);
    } finally {
      writeFileSync(tokensCssPath, original);
    }
  });

  it('emits color tokens in both modes and shape tokens only in light', () => {
    const light = buildTokens(DEFAULT_PARAMS, 'light');
    expectTokenKeys(light, COLOR_KEYS);
    expectTokenKeys(light, SHAPE_KEYS);

    const dark = buildTokens(DEFAULT_PARAMS, 'dark');
    expectTokenKeys(dark, COLOR_KEYS);
    for (const key of SHAPE_KEYS) {
      expect(dark, key).to.not.have.property(key);
    }
  });

  it('does not emit the accent substring in generated css', () => {
    expect(tokensToCss(DEFAULT_PARAMS).includes('accent')).to.equal(false);
  });

  it('meets the locked contrast floors in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = buildTokens(DEFAULT_PARAMS, mode);
      expectMinContrast(tokens, '--fg', '--surface', 12);
      expectMinContrast(tokens, '--fg-muted', '--surface', 7);
      for (const background of ['--surface', '--bg', '--surface-sunken']) {
        expectMinContrast(tokens, '--fg-subtle', background, 4.5);
      }
      for (const name of RAMP_NAMES) {
        expectMinContrast(tokens, `--${name}-fg`, '--surface', 4.5);
        expectMinContrast(tokens, `--${name}-fg`, `--${name}-soft`, 4.5);
        expectMinContrast(tokens, `--on-${name}`, `--${name}-solid`, 4.5);
      }
    }
  });

  it('computes the white/black and identical-color contrast anchors', () => {
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).to.be.closeTo(21, 0.01);
    expect(contrastRatio('oklch(0.5 0 0)', 'oklch(0.5 0 0)')).to.equal(1);
  });

  it('ignores an oklch alpha channel when computing contrast', () => {
    expect(contrastRatio('oklch(1 0 0 / 0.5)', 'oklch(0 0 0)')).to.be.closeTo(21, 0.01);
  });

  it('clips linear sRGB channels into the unit interval', () => {
    const [red, green, blue] = oklchToLinearSrgb(0.7, 0.4, 30);
    expect(red).to.be.at.least(0);
    expect(red).to.be.at.most(1);
    expect(green).to.be.at.least(0);
    expect(green).to.be.at.most(1);
    expect(blue).to.be.at.least(0);
    expect(blue).to.be.at.most(1);
  });

  it('scales durations with motionScale, including a full stop', () => {
    const still = buildTokens({ ...DEFAULT_PARAMS, motionScale: 0 }, 'light');
    for (const key of ['--dur-1', '--dur-2', '--dur-3', '--dur-4']) {
      expect(still[key]).to.equal('0ms');
    }
    const doubled = buildTokens({ ...DEFAULT_PARAMS, motionScale: 2 }, 'light');
    expect(doubled['--dur-1']).to.equal('200ms');
    expect(doubled['--dur-2']).to.equal('320ms');
    expect(doubled['--dur-3']).to.equal('480ms');
    expect(doubled['--dur-4']).to.equal('720ms');
  });

  it('derives the radius 7 corner tokens', () => {
    const tokens = buildTokens({ ...DEFAULT_PARAMS, radius: 7 }, 'light');
    expect(tokens['--r-sm']).to.equal('5px');
    expect(tokens['--r-md']).to.equal('7px');
    expect(tokens['--r-lg']).to.equal('11px');
    expect(tokens['--r-xl']).to.equal('14px');
  });

  it('zeros duration tokens inside the reduced-motion media block', () => {
    const block = reducedMotionBlock(tokensToCss(DEFAULT_PARAMS));
    expect(block.startsWith('@media (prefers-reduced-motion: reduce)')).to.equal(true);
    expect(block.includes('--dur-1: 0ms')).to.equal(true);
  });

  it('parses oklch channels and rejects a non-oklch color', () => {
    expect(parseOklch('oklch(0.5 0.1 200 / 0.3)')).to.deep.equal({
      l: 0.5,
      c: 0.1,
      h: 200,
      alpha: 0.3,
    });
    expect(parseOklch('oklch(0.5 0.1 200)').alpha).to.equal(1);
    expect(() => parseOklch('red')).to.throw();
  });
});
