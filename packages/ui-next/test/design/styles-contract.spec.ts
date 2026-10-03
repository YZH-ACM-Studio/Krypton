// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '../..');
const stylesPath = resolve(packageRoot, 'src/styles.css');
const cssDir = resolve(packageRoot, 'src');

const COLOR_LITERAL = /hsla?\(|rgba?\(|#[0-9a-fA-F]{3,8}\b|radial-gradient|backdrop-filter/g;

const NEW_COLOR_NAMES = [
  'bg',
  'surface',
  'surface-sunken',
  'surface-raised',
  'surface-hover',
  'surface-active',
  'line-subtle',
  'line',
  'line-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'fg-disabled',
  'scrim',
  'ring',
  'brand',
  'brand-hover',
  'brand-fg',
  'brand-soft',
  'brand-soft-hover',
  'brand-line',
  'on-brand',
];

const TONE_NAMES = ['success', 'warning', 'danger', 'info', 'violet', 'orange'];

const LEGACY_COLOR_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['--color-background', 'var(--bg)'],
  ['--color-foreground', 'var(--fg)'],
  ['--color-card', 'var(--surface)'],
  ['--color-card-foreground', 'var(--fg)'],
  ['--color-popover', 'var(--surface-raised)'],
  ['--color-popover-foreground', 'var(--fg)'],
  ['--color-primary', 'var(--brand-solid)'],
  ['--color-primary-foreground', 'var(--on-brand)'],
  ['--color-secondary', 'var(--surface-active)'],
  ['--color-secondary-foreground', 'var(--fg)'],
  ['--color-muted', 'var(--surface-sunken)'],
  ['--color-muted-foreground', 'var(--fg-muted)'],
  ['--color-accent', 'var(--surface-hover)'],
  ['--color-accent-foreground', 'var(--fg)'],
  ['--color-destructive', 'var(--danger-solid)'],
  ['--color-destructive-foreground', 'var(--on-danger)'],
  ['--color-border', 'var(--line)'],
  ['--color-input', 'var(--line-strong)'],
  ['--color-sidebar', 'var(--surface-sunken)'],
  ['--color-sidebar-background', 'var(--surface-sunken)'],
  ['--color-sidebar-foreground', 'var(--fg)'],
  ['--color-sidebar-primary', 'var(--brand-solid)'],
  ['--color-sidebar-primary-foreground', 'var(--on-brand)'],
  ['--color-sidebar-accent', 'var(--surface-active)'],
  ['--color-sidebar-accent-foreground', 'var(--fg)'],
  ['--color-sidebar-border', 'var(--line)'],
  ['--color-sidebar-ring', 'var(--ring)'],
];

const KEYFRAMES = ['kr-spin', 'kr-pulse-dot', 'kr-shimmer', 'kr-pop-in', 'kr-pop-out'];

const LATIN_UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const UI_FONT_SANS =
  "--font-sans: var(--font-ui), 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', system-ui, sans-serif;";

const RAW_LEGACY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['--background', 'var(--bg)'],
  ['--foreground', 'var(--fg)'],
  ['--card', 'var(--surface)'],
  ['--card-foreground', 'var(--fg)'],
  ['--popover', 'var(--surface-raised)'],
  ['--popover-foreground', 'var(--fg)'],
  ['--primary', 'var(--brand-solid)'],
  ['--primary-foreground', 'var(--on-brand)'],
  ['--secondary', 'var(--surface-active)'],
  ['--secondary-foreground', 'var(--fg)'],
  ['--muted', 'var(--surface-sunken)'],
  ['--muted-foreground', 'var(--fg-muted)'],
  ['--accent', 'var(--surface-hover)'],
  ['--accent-foreground', 'var(--fg)'],
  ['--destructive', 'var(--danger-solid)'],
  ['--destructive-foreground', 'var(--on-danger)'],
  ['--border', 'var(--line)'],
  ['--input', 'var(--line-strong)'],
  ['--radius', 'var(--r-md)'],
  ['--sidebar-background', 'var(--surface-sunken)'],
  ['--sidebar-foreground', 'var(--fg)'],
  ['--sidebar-primary', 'var(--brand-solid)'],
  ['--sidebar-primary-foreground', 'var(--on-brand)'],
  ['--sidebar-accent', 'var(--surface-active)'],
  ['--sidebar-accent-foreground', 'var(--fg)'],
  ['--sidebar-border', 'var(--line)'],
  ['--sidebar-ring', 'var(--ring)'],
];

const HLJS_RULES: ReadonlyArray<readonly [string, string]> = [
  ['.hljs', 'color: var(--fg)'],
  ['.hljs', 'background: transparent'],
  ['.hljs-keyword', 'color: var(--brand-fg)'],
  ['.hljs-selector-tag', 'color: var(--brand-fg)'],
  ['.hljs-built_in', 'color: var(--brand-fg)'],
  ['.hljs-string', 'color: var(--success-fg)'],
  ['.hljs-addition', 'color: var(--success-fg)'],
  ['.hljs-regexp', 'color: var(--success-fg)'],
  ['.hljs-number', 'color: var(--orange-fg)'],
  ['.hljs-literal', 'color: var(--orange-fg)'],
  ['.hljs-title', 'color: var(--info-fg)'],
  ['.hljs-section', 'color: var(--info-fg)'],
  ['.hljs-function .hljs-title', 'color: var(--info-fg)'],
  ['.hljs-type', 'color: var(--violet-fg)'],
  ['.hljs-name', 'color: var(--violet-fg)'],
  ['.hljs-class .hljs-title', 'color: var(--violet-fg)'],
  ['.hljs-attr', 'color: var(--warning-fg)'],
  ['.hljs-attribute', 'color: var(--warning-fg)'],
  ['.hljs-variable', 'color: var(--warning-fg)'],
  ['.hljs-template-variable', 'color: var(--warning-fg)'],
  ['.hljs-comment', 'color: var(--fg-subtle)'],
  ['.hljs-quote', 'color: var(--fg-subtle)'],
  ['.hljs-meta', 'color: var(--fg-muted)'],
  ['.hljs-deletion', 'color: var(--danger-fg)'],
  ['.hljs-emphasis', 'font-style: italic'],
  ['.hljs-strong', 'font-weight: 600'],
];

const ANTI_AI_MARKER = [
  '.anti-ai-copy-marker {',
  '  display: inline;',
  '  inline-size: 0;',
  '  block-size: 0;',
  '  overflow: hidden;',
  '  font-size: 0;',
  '  line-height: 0;',
  '  pointer-events: none;',
  '  user-select: none;',
  '}',
].join('\n');

const ANTI_AI_PRINT = ['@media print {', '  .anti-ai-copy-marker {', '    display: none !important;', '  }', '}'].join('\n');

interface CssBlock {
  header: string;
  body: string;
  start: number;
  end: number;
}

function readStyles(): string {
  return readFileSync(stylesPath, 'utf8');
}

function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeHeader(header: string): string {
  return stripComments(header).replaceAll(/\s+/g, ' ').trim();
}

function endOfString(source: string, start: number): number {
  const quote = source.charAt(start);
  let index = start + 1;
  while (index < source.length) {
    if (source.charAt(index) === '\\') {
      index += 2;
    } else if (source.charAt(index) === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return source.length;
}

function findOpen(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === '/' && source.charAt(index + 1) === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      index = endOfString(source, index);
    } else if (char === '{') {
      return index;
    } else {
      index += 1;
    }
  }
  return -1;
}

function matchClose(source: string, open: number): number {
  let depth = 1;
  let index = open + 1;
  while (index < source.length && depth > 0) {
    const char = source.charAt(index);
    if (char === '/' && source.charAt(index + 1) === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      index = endOfString(source, index);
    } else if (char === '{') {
      depth += 1;
      index += 1;
    } else if (char === '}') {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index - 1;
      }
    } else {
      index += 1;
    }
  }
  return -1;
}

function collectBlocks(source: string, base: number, out: CssBlock[]): void {
  let cursor = 0;
  while (cursor < source.length) {
    const open = findOpen(source, cursor);
    if (open < 0) {
      return;
    }
    const close = matchClose(source, open);
    if (close < 0) {
      return;
    }
    const body = source.slice(open + 1, close);
    out.push({
      header: source.slice(cursor, open),
      body,
      start: base + open,
      end: base + close + 1,
    });
    collectBlocks(body, base + open + 1, out);
    cursor = close + 1;
  }
}

function allBlocks(source: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  collectBlocks(source, 0, blocks);
  return blocks;
}

function declarationMap(body: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const stripped = stripComments(body);
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+)/g;
  for (let match = re.exec(stripped); match !== null; match = re.exec(stripped)) {
    const name = match[1];
    const raw = match[2];
    if (name === undefined || raw === undefined) {
      continue;
    }
    const values = map.get(name) ?? [];
    values.push(raw.trim());
    map.set(name, values);
  }
  return map;
}

function themeInlineDeclarations(blocks: readonly CssBlock[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const block of blocks) {
    if (normalizeHeader(block.header) !== '@theme inline') {
      continue;
    }
    const found = declarationMap(block.body);
    for (const [name, values] of found) {
      const existing = map.get(name) ?? [];
      existing.push(...values);
      map.set(name, existing);
    }
  }
  return map;
}

function newColorNames(): string[] {
  const names = [...NEW_COLOR_NAMES];
  for (const tone of TONE_NAMES) {
    names.push(tone, `${tone}-fg`, `${tone}-soft`, `${tone}-line`);
  }
  return names;
}

function missingVarColors(map: Map<string, string[]>, names: readonly string[]): string[] {
  const missing: string[] = [];
  for (const name of names) {
    const values = map.get(`--color-${name}`);
    const mapped = values?.some((value) => value.startsWith('var(')) ?? false;
    if (!mapped) {
      missing.push(`--color-${name}`);
    }
  }
  return missing;
}

function aliasMismatches(map: Map<string, string[]>, aliases: ReadonlyArray<readonly [string, string]>): string[] {
  const mismatches: string[] = [];
  for (const [name, expected] of aliases) {
    const values = map.get(name);
    if (values === undefined || values.length === 0) {
      mismatches.push(`${name} missing`);
    } else {
      for (const value of values) {
        if (value !== expected) {
          mismatches.push(`${name} = ${value}`);
        }
      }
    }
  }
  return mismatches;
}

function selectorList(header: string): string[] {
  return normalizeHeader(header)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function fontUrls(body: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s]+))\s*\)/g;
  for (let match = re.exec(body); match !== null; match = re.exec(body)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw !== undefined && raw.length > 0) {
      urls.push(raw);
    }
  }
  return urls;
}

function expectFontFace(blocks: readonly CssBlock[], family: string): void {
  const needle = `font-family: '${family}'`;
  const faces = blocks.filter((block) => normalizeHeader(block.header) === '@font-face' && block.body.includes(needle));
  expect(faces.length, needle).toBeGreaterThan(0);
  const urls = faces.flatMap((face) => fontUrls(face.body));
  expect(urls.length, needle).toBeGreaterThan(0);
  for (const rawUrl of urls) {
    const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? rawUrl;
    const file = resolve(cssDir, pathOnly);
    expect(existsSync(file), `${needle} -> ${rawUrl}`).toBe(true);
  }
}

function fontFaceBodies(blocks: readonly CssBlock[], family: string): string {
  const needle = `font-family: '${family}'`;
  const faces = blocks.filter((block) => normalizeHeader(block.header) === '@font-face' && block.body.includes(needle));
  expect(faces.length, needle).toBeGreaterThan(0);
  return faces.map((face) => face.body).join('\n');
}

function sameBytes(actual: string, source: string): void {
  expect(readFileSync(resolve(packageRoot, actual)).equals(readFileSync(resolve(packageRoot, source)))).toBe(true);
}

describe('global stylesheet contract', () => {
  it('imports the design tokens stylesheet and drops highlight.js', () => {
    const css = readStyles();
    expect(css).toContain("@import './design/tokens.css'");
    expect(css.includes('highlight.js/styles/github.css')).toBe(false);
  });

  it('bans raw color literals outside the skeleton gradient', () => {
    const css = readStyles();
    const hits = css.match(COLOR_LITERAL) ?? [];
    expect(hits.length, hits.slice(0, 6).join(' | ')).toBe(0);

    const blocks = allBlocks(css);
    const ranges = blocks
      .filter((block) => normalizeHeader(block.header) === '@utility skeleton')
      .map((block) => ({ start: block.start, end: block.end }));
    const outside: number[] = [];
    let from = 0;
    while (from < css.length) {
      const index = css.indexOf('linear-gradient', from);
      if (index < 0) {
        break;
      }
      const inside = ranges.some((range) => index >= range.start && index < range.end);
      if (!inside) {
        outside.push(index);
      }
      from = index + 'linear-gradient'.length;
    }
    expect(outside).toEqual([]);
  });

  it('declares Mona Sans and JetBrains Mono faces whose files exist', () => {
    const blocks = allBlocks(readStyles());
    expectFontFace(blocks, 'Mona Sans Variable');
    expectFontFace(blocks, 'JetBrains Mono Variable');
  });

  it('does not mention Inter', () => {
    expect(readStyles().includes('Inter')).toBe(false);
  });

  it('maps the new color names inside @theme inline', () => {
    const blocks = allBlocks(readStyles());
    const themeBlocks = blocks.filter((block) => normalizeHeader(block.header) === '@theme inline');
    expect(themeBlocks.length).toBeGreaterThan(0);
    expect(missingVarColors(themeInlineDeclarations(blocks), newColorNames())).toEqual([]);
  });

  it('keeps the legacy @theme inline color aliases verbatim', () => {
    const map = themeInlineDeclarations(allBlocks(readStyles()));
    expect(aliasMismatches(map, LEGACY_COLOR_ALIASES)).toEqual([]);
  });

  it('aliases raw custom properties without aliasing --ring', () => {
    const roots = allBlocks(readStyles()).filter((block) => normalizeHeader(block.header).replaceAll(/\s*,\s*/g, ',') === ':root,.dark');
    expect(roots.length).toBeGreaterThan(0);
    const body = roots.map((block) => block.body).join('\n');
    expect(body).toContain('--primary: var(--brand-solid)');
    expect(body).toContain('--muted-foreground: var(--fg-muted)');
    expect(body).toContain('--accent: var(--surface-hover)');
    expect(declarationMap(body).has('--ring')).toBe(false);
  });

  it('exposes the text, radius, shadow, breakpoint, and short-variant hooks', () => {
    const css = readStyles();
    expect(css).toContain('--text-md: var(--fs-md)');
    expect(css).toContain('--radius-md: var(--r-md)');
    expect(css).toContain('--shadow-pop: var(--shadow-pop)');
    expect(css).toContain('--breakpoint-3xl: 120rem');
    expect(css).toContain('@custom-variant short');
  });

  it('uses the global scrollbar and drops .krypton-scrollbar', () => {
    const css = readStyles();
    expect(css).toContain('::-webkit-scrollbar-thumb');
    expect(css).toContain('@utility scrollbar-none');
    expect(css.includes('.krypton-scrollbar')).toBe(false);
  });

  it('keeps the motion keyframes and drops the course rise animation', () => {
    const css = readStyles();
    for (const name of KEYFRAMES) {
      expect(css).toMatch(new RegExp(`@keyframes ${name}\\b`));
    }
    expect(css).not.toMatch(/@keyframes\s+krypton-course-rise\b/);
    expect(css).not.toMatch(/animation(?:-name)?\s*:[^;]*\bkrypton-course-rise\b/);
  });

  it('does not draw a border under .krypton-prose h1', () => {
    const h1Blocks = allBlocks(readStyles()).filter((block) => selectorList(block.header).includes('.krypton-prose h1'));
    expect(h1Blocks.length).toBeGreaterThan(0);
    for (const block of h1Blocks) {
      expect(block.body.includes('border-bottom'), normalizeHeader(block.header)).toBe(false);
    }
  });

  it('keeps the anti-ai copy marker rules verbatim', () => {
    const css = readStyles();
    expect(css).toContain(ANTI_AI_MARKER);
    expect(css).toContain(ANTI_AI_PRINT);
  });

  it('ships the Mona Sans license and removes the Inter license', () => {
    expect(existsSync(resolve(packageRoot, 'src/assets/fonts/OFL-Inter.txt'))).toBe(false);
    expect(existsSync(resolve(packageRoot, 'src/assets/fonts/OFL-MonaSans.txt'))).toBe(true);
  });

  it('defines the dark ancestor variant', () => {
    expect(readStyles()).toContain('@custom-variant dark (&:is(.dark *));');
  });

  it('copies the playground font-display, weight range, and unicode-range', () => {
    const blocks = allBlocks(readStyles());
    const mona = fontFaceBodies(blocks, 'Mona Sans Variable');
    expect(mona).toContain('font-display: swap');
    expect(mona).toContain('font-weight: 100 900');
    expect(mona).toContain(LATIN_UNICODE_RANGE);
    const mono = fontFaceBodies(blocks, 'JetBrains Mono Variable');
    expect(mono).toContain('font-display: swap');
    expect(mono).toContain('font-weight: 100 800');
    expect(mono).toContain(LATIN_UNICODE_RANGE);
  });

  it('sets the UI sans stack to the font token plus the system CJK faces', () => {
    expect(readStyles()).toContain(UI_FONT_SANS);
  });

  it('aliases every legacy custom property to the specified token', () => {
    const roots = allBlocks(readStyles()).filter((block) => normalizeHeader(block.header).replaceAll(/\s*,\s*/g, ',') === ':root,.dark');
    expect(roots.length).toBeGreaterThan(0);
    const map = declarationMap(roots.map((block) => block.body).join('\n'));
    expect(aliasMismatches(map, RAW_LEGACY_ALIASES)).toEqual([]);
  });

  it('keeps the app shell from scrolling with the document', () => {
    const shells = allBlocks(readStyles()).filter((block) => {
      const selectors = selectorList(block.header);
      return selectors.includes('html') && selectors.includes('body') && selectors.includes('#root');
    });
    expect(shells.length).toBeGreaterThan(0);
    for (const block of shells) {
      expect(block.body).toContain('height: 100%');
      expect(block.body).toContain('overflow: hidden');
    }
  });

  it('paints the page body with the background and foreground tokens', () => {
    const bodies = allBlocks(readStyles()).filter((block) => normalizeHeader(block.header) === 'body');
    expect(bodies.length).toBeGreaterThan(0);
    for (const block of bodies) {
      expect(block.body).toContain('background: var(--bg)');
      expect(block.body).toContain('color: var(--fg)');
    }
  });

  it('disables the skeleton animation when motion is reduced', () => {
    const queries = allBlocks(readStyles()).filter((block) => normalizeHeader(block.header).includes('prefers-reduced-motion'));
    expect(queries.length).toBeGreaterThan(0);
    for (const block of queries) {
      expect(block.body).toMatch(/\.skeleton\s*\{[^}]*animation:\s*none/);
    }
  });

  it('does not draw a border under .krypton-prose h2', () => {
    const h2Blocks = allBlocks(readStyles()).filter((block) => selectorList(block.header).includes('.krypton-prose h2'));
    expect(h2Blocks.length).toBeGreaterThan(0);
    for (const block of h2Blocks) {
      expect(block.body.includes('border-bottom'), normalizeHeader(block.header)).toBe(false);
    }
  });

  it('does not shadow images inside .krypton-prose', () => {
    const images = allBlocks(readStyles()).filter((block) => selectorList(block.header).includes('.krypton-prose img'));
    expect(images.length).toBeGreaterThan(0);
    for (const block of images) {
      expect(block.body.includes('box-shadow'), normalizeHeader(block.header)).toBe(false);
    }
  });

  it('neutralizes course panels and heroes without a dark override', () => {
    const blocks = allBlocks(readStyles());
    const panels = blocks.filter((block) => selectorList(block.header).includes('.krypton-course-panel'));
    expect(panels.length).toBeGreaterThan(0);
    for (const block of panels) {
      expect(selectorList(block.header)).toContain('.krypton-course-hero');
      expect(block.body).toContain('border: 1px solid var(--line)');
      expect(block.body).toContain('background: var(--surface)');
      expect(block.body).toContain('box-shadow: var(--shadow-xs)');
      expect(block.body).toContain('border-radius: var(--r-lg)');
    }
    const darkPanels = blocks.filter((block) => {
      const header = normalizeHeader(block.header);
      return header.includes('.dark') && header.includes('.krypton-course-panel');
    });
    expect(darkPanels).toEqual([]);
  });

  it('removes generated course grain and spotlight', () => {
    const grains = allBlocks(readStyles()).filter((block) => selectorList(block.header).includes('.krypton-course-grain::after'));
    expect(grains.length).toBeGreaterThan(0);
    for (const block of grains) {
      expect(selectorList(block.header)).toContain('.krypton-course-spotlight::before');
      expect(block.body).toContain('content: none');
    }
  });

  it('keeps course hover on the line and surface without moving the card', () => {
    const hovers = allBlocks(readStyles()).filter((block) => selectorList(block.header).includes('.krypton-course-lift:hover'));
    expect(hovers.length).toBeGreaterThan(0);
    for (const block of hovers) {
      expect(selectorList(block.header)).toContain('.krypton-course-row:hover');
      expect(block.body).toContain('border-color: var(--line-strong)');
      expect(block.body).toContain('background: var(--surface-hover)');
      expect(block.body.includes('transform'), normalizeHeader(block.header)).toBe(false);
    }
  });

  it('colors highlight.js tokens with theme tokens in both modes', () => {
    const blocks = allBlocks(readStyles());
    for (const [selector, snippet] of HLJS_RULES) {
      const found = blocks.filter((block) => selectorList(block.header).includes(selector));
      expect(found.length, selector).toBeGreaterThan(0);
      for (const block of found) {
        expect(normalizeHeader(block.header).includes('.dark'), selector).toBe(false);
        expect(block.body, `${selector} ${snippet}`).toContain(snippet);
      }
    }
  });

  it('copies the Mona Sans font bytes from the playground file', () => {
    sameBytes('src/assets/fonts/mona-sans-latin-wght.woff2', 'src/playground/fonts/mona-sans.woff2');
  });

  it('copies the Mona Sans license bytes from the playground file', () => {
    sameBytes('src/assets/fonts/OFL-MonaSans.txt', 'src/playground/fonts/OFL-MonaSans.txt');
  });
});
