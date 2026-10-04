// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Scoreboard } from '../../src/playground/sections/oj';
import { countMatches } from './helpers';

const packageRoot = resolve(import.meta.dirname, '../..');
const playgroundRoot = resolve(packageRoot, 'src/playground');
const tscBin = resolve(packageRoot, '../../node_modules/.bin/tsc');

const UI_MODULES = [
  'button',
  'badge',
  'display',
  'verdict',
  'input',
  'select',
  'checkbox',
  'switch',
  'radio-group',
  'mini-tabs',
  'form',
  'dialog',
  'sheet',
  'toast',
  'tooltip',
  'menu',
  'page-tabs',
  'breadcrumb',
  'pagination',
  'panel',
  'alert',
  'empty-state',
  'data-table',
  'page',
] as const;

function playgroundFiles(extension: RegExp): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (extension.test(entry.name)) {
        found.push(fullPath);
      }
    }
  };
  visit(playgroundRoot);
  return found;
}

function repoPath(file: string): string {
  return relative(packageRoot, file).split('\\').join('/');
}

function readPlayground(relativePath: string): string {
  return readFileSync(resolve(playgroundRoot, relativePath), 'utf8');
}

function importsUiModule(source: string, moduleName: string): boolean {
  const pattern = new RegExp(
    `(?:from\\s+|import\\s*\\(\\s*|import\\s+)['"]@/components/ui/${moduleName}['"]`,
  );
  return pattern.test(source);
}

function firstImportArgument(css: string): string {
  const start = css.indexOf('@import');
  if (start < 0) {
    return '';
  }
  const after = css.slice(start + '@import'.length);
  const end = after.indexOf(';');
  if (end < 0) {
    return '';
  }
  return after.slice(0, end).trim();
}

function tagContaining(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) {
    return '';
  }
  const start = source.lastIndexOf('<', at);
  const end = source.indexOf('>', at);
  if (start < 0 || end < 0) {
    return '';
  }
  return source.slice(start, end + 1);
}

function forwardsChosenValue(expression: string, setter: string): boolean {
  if (expression.trim() === setter) {
    return true;
  }
  const forwarded = /^\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\(\s*\1\s*\)$/.exec(expression.trim());
  return forwarded !== null && forwarded[2] === setter;
}

function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  if (start < 0) {
    return '';
  }
  const next = source.indexOf('\nexport function ', start + 1);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}

function sliceBalanced(source: string, openIndex: number, openChar: string, closeChar: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      i = newline < 0 ? source.length : newline;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }
  return '';
}

function classTokens(openTag: string): string[] {
  const at = openTag.indexOf('className');
  if (at < 0) {
    return [];
  }
  const eq = openTag.indexOf('=', at);
  if (eq < 0) {
    return [];
  }
  let i = eq + 1;
  while (openTag[i] === ' ' || openTag[i] === '\n') {
    i += 1;
  }
  const quote = openTag[i];
  let raw = '';
  if (quote === '"' || quote === "'") {
    const end = openTag.indexOf(quote, i + 1);
    raw = end < 0 ? '' : openTag.slice(i + 1, end);
  } else if (quote === '{') {
    const inner = sliceBalanced(openTag, i, '{', '}');
    raw = [...inner.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1] ?? '').join(' ');
  }
  return raw.split(/\s+/).filter((token) => token.length > 0);
}

interface JsxEl {
  tokens: string[];
  children: JsxEl[];
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  let braces = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      braces += 1;
    } else if (ch === '}') {
      braces = Math.max(0, braces - 1);
    } else if (ch === '>' && braces === 0) {
      return i;
    }
  }
  return -1;
}

function dialogBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('<Dialog', from);
    if (at < 0) {
      break;
    }
    const boundary = source[at + '<Dialog'.length] ?? '';
    if (!/[\s>]/.test(boundary)) {
      from = at + '<Dialog'.length;
    } else {
      const close = source.indexOf('</Dialog>', at);
      if (close < 0) {
        break;
      }
      blocks.push(source.slice(at, close + '</Dialog>'.length));
      from = close + '</Dialog>'.length;
    }
  }
  return blocks;
}

function openTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const needle = `<${name}`;
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    const boundary = source[at + needle.length] ?? '';
    if (!/[\s/>]/.test(boundary)) {
      from = at + needle.length;
    } else {
      const end = findTagEnd(source, at);
      if (end < 0) {
        break;
      }
      tags.push(source.slice(at, end + 1));
      from = end + 1;
    }
  }
  return tags;
}

function jsxProp(openTag: string, prop: string): string {
  const match = new RegExp(`\\b${prop}\\s*=\\s*`).exec(openTag);
  if (match === null) {
    return '';
  }
  const start = match.index + match[0].length;
  const opener = openTag[start];
  if (opener === '{') {
    return sliceBalanced(openTag, start, '{', '}').trim();
  }
  if (opener === '"' || opener === "'") {
    const end = openTag.indexOf(opener, start + 1);
    return end < 0 ? '' : openTag.slice(start + 1, end);
  }
  return '';
}

function sliceUntilClose(source: string, from: number, name: string): string {
  const close = `</${name}>`;
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const nextClose = source.indexOf(close, i);
    if (nextClose < 0) {
      return source.slice(from);
    }
    const nextOpen = source.indexOf(`<${name}`, i);
    const opens = nextOpen >= 0 && nextOpen < nextClose && new RegExp(`^<${name}(?=[\\s/>])`).test(source.slice(nextOpen));
    if (opens) {
      depth += 1;
      i = nextOpen + name.length + 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return source.slice(from, nextClose);
      }
      i = nextClose + close.length;
    }
  }
  return '';
}

function parseElements(source: string): JsxEl[] {
  const elements: JsxEl[] = [];
  let i = 0;
  while (i < source.length) {
    const next = source.indexOf('<', i);
    if (next < 0) {
      break;
    }
    const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(next))?.[1];
    if (name === undefined) {
      i = next + 1;
    } else {
      const openEnd = findTagEnd(source, next);
      if (openEnd < 0) {
        break;
      }
      const open = source.slice(next, openEnd + 1);
      const el: JsxEl = { tokens: classTokens(open), children: [] };
      if (/\/\s*>$/.test(open)) {
        i = openEnd + 1;
      } else {
        const inner = sliceUntilClose(source, openEnd + 1, name);
        el.children = parseElements(inner);
        i = openEnd + 1 + inner.length + `</${name}>`.length;
      }
      elements.push(el);
    }
  }
  return elements;
}

function localJsx(source: string, name: string): string {
  const marker = `const ${name} =`;
  const at = source.indexOf(marker);
  if (at < 0) {
    return '';
  }
  const paren = source.indexOf('(', at + marker.length);
  if (paren < 0 || paren > at + marker.length + 8) {
    return '';
  }
  return sliceBalanced(source, paren, '(', ')');
}

function inlineLocalJsx(fnSource: string, fragment: string): string {
  return fragment.replace(/\{([A-Za-z_$][\w$]*)\}/g, (whole, name: string) => {
    const inner = localJsx(fnSource, name);
    return inner.length > 0 ? inner : whole;
  });
}

function lgSplit(fnSource: string): string {
  const binding = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useMediaQuery\(\s*['"]\(min-width:\s*1024px\)['"]\s*\)/.exec(fnSource);
  const name = binding?.[1];
  if (name === undefined) {
    return '';
  }
  const marker = `{${name} ?`;
  const at = fnSource.indexOf(marker);
  if (at < 0) {
    return '';
  }
  const paren = fnSource.indexOf('(', at + marker.length);
  if (paren < 0 || paren > at + marker.length + 8) {
    return '';
  }
  return sliceBalanced(fnSource, paren, '(', ')');
}

function findSplit(elements: JsxEl[]): JsxEl | null {
  for (const el of elements) {
    if (el.tokens.includes('grid-cols-2') || el.tokens.includes('lg:grid-cols-2')) {
      return el;
    }
    const nested = findSplit(el.children);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function isScrollport(el: JsxEl): boolean {
  const scrolls = el.tokens.includes('overflow-y-auto') || el.tokens.includes('overflow-auto');
  return scrolls && el.tokens.includes('min-h-0');
}

function hasScrollport(el: JsxEl): boolean {
  if (isScrollport(el)) {
    return true;
  }
  return el.children.some(hasScrollport);
}

function columnScrolls(el: JsxEl): boolean {
  if (isScrollport(el)) {
    return true;
  }
  const clips = el.tokens.includes('overflow-hidden') || el.tokens.includes('overflow-y-hidden');
  return el.tokens.includes('min-h-0') && clips && el.children.some(hasScrollport);
}

describe('playground renders real components', () => {
  it('removes the kit directory and the local token module', () => {
    expect(existsSync(resolve(playgroundRoot, 'kit')), 'src/playground/kit').toBe(false);
    expect(existsSync(resolve(playgroundRoot, 'tokens.ts')), 'src/playground/tokens.ts').toBe(false);
  });

  it('does not import the deleted kit from any playground tsx file', () => {
    const offenders = playgroundFiles(/\.tsx$/).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes("from './kit") || source.includes("from '../kit");
    }).map(repoPath);
    expect(offenders).toEqual([]);
  });

  it('imports real ui modules, including one of page-tabs or data-table from main', () => {
    const main = readPlayground('main.tsx');
    const entryHasCatalog = importsUiModule(main, 'page-tabs') || importsUiModule(main, 'data-table');
    expect(entryHasCatalog, 'src/playground/main.tsx').toBe(true);

    const combined = playgroundFiles(/\.(?:ts|tsx)$/)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const missing = UI_MODULES.filter((moduleName) => !importsUiModule(combined, moduleName));
    expect(missing).toEqual([]);
  });

  it("imports '../styles.css' as the first playground css import", () => {
    expect(firstImportArgument(readPlayground('playground.css'))).toBe("'../styles.css'");
  });

  it('typechecks with no errors in playground files', () => {
    expect(existsSync(tscBin), tscBin).toBe(true);
    const result = spawnSync(tscBin, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(typeof result.status).toBe('number');
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const playgroundErrors = output.split('\n').filter((line) => line.startsWith('src/playground/'));
    expect(playgroundErrors).toEqual([]);
  }, 180_000);

  it('states the §7.1 verdict rule and does not fade scoreboard text', () => {
    const source = readPlayground('sections/oj.tsx');
    const problems: string[] = [];
    if (source.includes('部分分 蓝')) {
      problems.push('contains 部分分 蓝');
    }
    if (!source.includes('scoreTone')) {
      problems.push('missing scoreTone');
    }
    const opacityLines = source.split('\n').flatMap((line, index) => (
      /\bopacity-\d/.test(line) ? [`${index + 1}: ${line.trim()}`] : []
    ));
    if (opacityLines.length > 0) {
      problems.push(`matches /\\bopacity-\\d/: ${opacityLines.join(' | ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('writes an explicit width on every Page open tag and drops the problem-column max width', () => {
    const missingWidth = playgroundFiles(/\.tsx$/).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/<Page(?=[\s>])[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => !tag.includes('width="'))
        .map((tag) => `${repoPath(file)}: ${tag}`);
    });
    const pages = readPlayground('demos/pages.tsx');
    const problems = [...missingWidth];
    if (pages.includes('max-w-[46rem]')) {
      problems.push('demos/pages.tsx contains max-w-[46rem]');
    }
    expect(problems).toEqual([]);
  });

  it('does not uppercase Chinese group labels', () => {
    const offenders = playgroundFiles(/\.tsx$/).flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
      if (/[\u4E00-\u9FFF]/.test(line) && /\buppercase\b/.test(line)) {
        return [`${repoPath(file)}:${index + 1}: ${line.trim()}`];
      }
      return [];
    }));
    const phrases: string[] = [];
    if (readPlayground('demos/pages.tsx').includes('uppercase tracking-wider')) {
      phrases.push('demos/pages.tsx contains uppercase tracking-wider');
    }
    if (readPlayground('main.tsx').includes('uppercase tracking-wider')) {
      phrases.push('main.tsx contains uppercase tracking-wider');
    }
    expect({ offenders, phrases }).toEqual({ offenders: [], phrases: [] });
  });

  it('mounts ToastProvider and DialogHost from the playground entry', () => {
    const main = readPlayground('main.tsx');
    expect(main).toContain('ToastProvider');
    expect(main).toContain('DialogHost');
  });

  it('wraps the root in MotionConfig, then ToastProvider, then DialogHost', () => {
    const main = readPlayground('main.tsx');
    const motion = main.indexOf('<MotionConfig');
    const reduced = main.indexOf('reducedMotion="user"');
    const toastOpen = main.indexOf('<ToastProvider');
    const dialog = main.indexOf('<DialogHost');
    const toastClose = main.indexOf('</ToastProvider>');
    const motionClose = main.indexOf('</MotionConfig>');
    const problems: string[] = [];
    if (motion < 0 || reduced < motion) {
      problems.push('MotionConfig reducedMotion="user" is missing');
    }
    if (motion < 0 || motion >= toastOpen || toastOpen >= dialog || dialog >= toastClose || toastClose >= motionClose) {
      problems.push('expected MotionConfig to wrap ToastProvider to wrap DialogHost');
    }
    const providers = [...main.matchAll(/<([A-Z][A-Za-z0-9]*Provider)\b/g)].map((match) => match[1]);
    if (providers.length !== 1 || providers[0] !== 'ToastProvider') {
      problems.push(`unexpected providers: ${providers.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('injects the live tuner params through tokensToCss', () => {
    const state = readPlayground('state.ts');
    expect(state).toContain("from '@/design/tokens'");
    expect(state).toMatch(/\.textContent\s*=\s*tokensToCss\(params\)/);
  });

  it('keeps the problem-bank difficulty select and scoreboard scope tabs controlled', () => {
    const pages = readPlayground('demos/pages.tsx');
    const difficulty = tagContaining(pages, 'ariaLabel="难度"');
    const scope = tagContaining(pages, 'aria-label="榜单范围"');
    const difficultyHandler = /onValueChange=\{([^}]*)\}/.exec(difficulty);
    const scopeHandler = /onValueChange=\{([^}]*)\}/.exec(scope);
    expect(difficulty.startsWith('<SimpleSelect'), difficulty).toBe(true);
    expect(difficulty).toContain('value={difficulty}');
    expect(pages).toContain('const [difficulty, setDifficulty] = React.useState(');
    expect(forwardsChosenValue(difficultyHandler?.[1] ?? '', 'setDifficulty')).toBe(true);
    expect(scope.startsWith('<MiniTabs'), scope).toBe(true);
    expect(scope).toContain('value={scope}');
    expect(pages).toContain('const [scope, setScope] = React.useState(');
    expect(forwardsChosenValue(scopeHandler?.[1] ?? '', 'setScope')).toBe(true);
  });

  it('uses the specified page width for each full-page demo', () => {
    const pages = readPlayground('demos/pages.tsx');
    expect(exportedFunction(pages, 'ProblemsDemo')).toContain('<Page width="wide">');
    expect(exportedFunction(pages, 'ProblemDemo')).toContain('<Page width="prose">');
    expect(exportedFunction(pages, 'ScoreboardDemo')).toContain('<Page width="full">');
    expect(exportedFunction(pages, 'SettingsDemo')).toContain('<Page width="form">');
  });

  it('scrolls each lg problem-demo column on its own', () => {
    const fnSource = exportedFunction(readPlayground('demos/pages.tsx'), 'ProblemDemo');
    const splitSource = lgSplit(fnSource);
    const split = findSplit(parseElements(inlineLocalJsx(fnSource, splitSource)));
    const problems: string[] = [];
    if (split === null) {
      problems.push('lg branch has no 50/50 grid, so the statement grows the page');
    } else {
      if (!split.tokens.includes('min-h-0')) {
        problems.push(`lg grid is missing min-h-0 (${split.tokens.join(' ')})`);
      }
      if (!split.tokens.includes('h-full') && !split.tokens.includes('h-dvh') && !split.tokens.includes('flex-1')) {
        problems.push(`lg grid is not height-bounded (${split.tokens.join(' ')})`);
      }
      if (split.children.length !== 2) {
        problems.push(`lg grid has ${split.children.length} columns`);
      }
      split.children.forEach((column, index) => {
        if (!columnScrolls(column)) {
          problems.push(`column ${index} does not scroll on its own (${column.tokens.join(' ') || 'no class'})`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('colors partial scores as Accepted rather than a separate status', () => {
    const source = readPlayground('sections/oj.tsx');
    const scored = [...source.matchAll(/\{\s*status:\s*(\d+)\s*,\s*score:\s*\d+\s*\}/g)];
    expect(scored.length).toBeGreaterThan(0);
    const statuses = scored.map((match) => match[1]);
    expect(statuses).toEqual(statuses.map(() => '1'));
  });

  it('locks the verdict sample to the §7.1 status codes', () => {
    const source = readPlayground('sections/oj.tsx');
    const statuses = [...source.matchAll(/\{\s*status:\s*(\d+)\b/g)].flatMap((match) => {
      const raw = match[1];
      return raw === undefined ? [] : [Number(raw)];
    });
    // AC, WA, FE, TLE, MLE, OLE, RE, CE, partial AC, SE, waiting, judging, canceled.
    // §7.1 has no separate PE code; WA/PE share the WA row.
    expect(statuses).toEqual([1, 2, 31, 3, 4, 5, 6, 7, 1, 8, 0, 20, 9]);
  });

  it('points every link pagination at the problems demo', () => {
    const tags = playgroundFiles(/\.tsx$/).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/<Pagination\b[^>]*>/g)].map((match) => `${repoPath(file)}: ${match[0]}`);
    });
    expect(tags.length).toBeGreaterThan(0);
    const wrong = tags.filter((tag) => !tag.includes('baseUrl="?demo=problems"'));
    expect(wrong).toEqual([]);
  });

  it('does not letter-space Chinese group labels', () => {
    const offenders = playgroundFiles(/\.tsx$/).flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
      if (/[\u4E00-\u9FFF]/.test(line) && /\btracking-wider\b/.test(line)) {
        return [`${repoPath(file)}:${index + 1}: ${line.trim()}`];
      }
      return [];
    }));
    expect(offenders).toEqual([]);
  });

  it('keeps the playground slider class and the four comparison faces', () => {
    const css = readPlayground('playground.css');
    expect(css).toContain('.kr-slider');
    const missing = ['Inter Variable', 'Instrument Sans Variable', 'IBM Plex Sans Variable', 'Onest Variable']
      .filter((family) => !css.includes(`font-family: '${family}'`));
    expect(missing).toEqual([]);
  });

  it('keeps verdict scores gray and demonstrates scoreTone on 0, 60, and 100', () => {
    const source = readPlayground('sections/oj.tsx');
    const problems: string[] = [];
    if (!source.includes('Verdict 内的分数为灰色')) {
      problems.push('missing Verdict 内的分数为灰色');
    }
    if (source.includes('分数按 scoreTone 着色')) {
      problems.push('contains 分数按 scoreTone 着色');
    }
    const calls = countMatches(source, /\bscoreTone\(/g);
    if (calls < 3) {
      problems.push(`scoreTone( count is ${calls}, expected >= 3`);
    }
    expect(problems).toEqual([]);
  });

  it('reads the problems demo pagination page from the address bar', () => {
    const pages = readPlayground('demos/pages.tsx');
    const problems: string[] = [];
    if (!pages.includes('new URLSearchParams(')) {
      problems.push('missing new URLSearchParams(');
    }
    if (/current=\{1\}/.test(pages)) {
      problems.push('matches /current={1}/');
    }
    expect(problems).toEqual([]);
  });

  it('does not freeze AvatarFallback at text-sm', () => {
    const offenders = playgroundFiles(/\.tsx$/).flatMap((file) => openTags(readFileSync(file, 'utf8'), 'AvatarFallback').flatMap((tag) => (
      /\btext-sm\b/.test(tag) ? [`${repoPath(file)}: ${tag.replace(/\s+/g, ' ')}`] : []
    )));
    expect(offenders).toEqual([]);
  });

  it('paints scores 0, 60, and 100 with the scoreTone classes', () => {
    const source = readPlayground('sections/oj.tsx');
    expect(source).toContain("danger: 'text-danger-fg'");
    expect(source).toContain("warning: 'text-warning-fg'");
    expect(source).toContain("success: 'text-success-fg'");
    for (const score of [0, 60, 100]) {
      expect(source).toContain(`cn('tabular font-semibold', TONE_TEXT[scoreTone(${score})])`);
      expect(source).toContain(`>${score}</span>`);
    }
  });

  it('scales AvatarFallback text with xs, sm, md, and lg', () => {
    const personPath = resolve(playgroundRoot, 'person.tsx');
    expect(existsSync(personPath), 'src/playground/person.tsx').toBe(true);
    const source = readFileSync(personPath, 'utf8');
    const text = (size: string): string => {
      const found = new RegExp(`\\b${size}:\\s*\\{[^}]*\\btext:\\s*'([^']*)'`).exec(source);
      return found?.[1] ?? '';
    };
    expect(text('xs')).toBe('text-2xs');
    expect(text('sm')).toBe('text-2xs');
    expect(text('md')).toBe('text-xs');
    expect(text('lg')).toBe('text-md');
    expect(source).toMatch(/const\s+spec\s*=\s*SIZE\[size\]/);
    const fallbacks = openTags(source, 'AvatarFallback');
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const tag of fallbacks) {
      const className = jsxProp(tag, 'className');
      expect(className).toMatch(/\bspec\.text\b/);
      expect(className).not.toMatch(/\btext-sm\b/);
    }
  });

  it('reads problems pagination from the page query and defaults to 1', () => {
    const pages = readPlayground('demos/pages.tsx');
    const query = "Number(new URLSearchParams(window.location.search).get('page')) || 1";
    expect(pages).toContain(query);
    const demo = exportedFunction(pages, 'ProblemsDemo');
    const binding = /const\s+([A-Za-z_$][\w$]*)\s*=\s*Number\(\s*new\s+URLSearchParams\(\s*window\.location\.search\s*\)\.get\(\s*'page'\s*\)\s*\)\s*\|\|\s*1/.exec(demo);
    const bound = binding?.[1] ?? '';
    const tags = openTags(demo, 'Pagination');
    expect(tags.length).toBeGreaterThan(0);
    const compact = (value: string): string => value.replace(/\s+/g, '');
    for (const tag of tags) {
      const current = jsxProp(tag, 'current');
      const usesQuery = compact(current) === compact(query) || (bound.length > 0 && current === bound);
      expect(usesQuery, tag).toBe(true);
    }
  });

  it('keeps scoreboard cell secondary text at text-2xs', () => {
    const source = readPlayground('sections/oj.tsx');
    const secondary = /const secondary = cn\(([^)]*)\)/.exec(source)?.[1] ?? '';
    expect(secondary).toContain("'text-2xs'");
  });

  it('stacks the scoreboard rank and team columns above the scrolling cells', () => {
    const html = renderToStaticMarkup(createElement(Scoreboard, {}));
    const tbody = html.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
    const rows = tbody.split(/<tr\b/).slice(1).map((row) => {
      const cells: string[] = [];
      for (const match of row.matchAll(/<td\b([^>]*)>/g)) {
        cells.push(match[1] ?? '');
      }
      return cells;
    });
    const problems: string[] = [];
    if (rows.length === 0) {
      problems.push('scoreboard rendered no body rows');
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cells = rows[rowIndex] ?? [];
      if (cells.length < 3) {
        problems.push(`row ${rowIndex} has ${cells.length} cells`);
        continue;
      }
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        const className = /\bclass="([^"]*)"/.exec(cells[cellIndex] ?? '')?.[1] ?? '';
        const tokens = className.split(/\s+/).filter((token) => token.length > 0);
        const pinned = cellIndex < 2;
        const stacked = tokens.includes('sticky') && tokens.includes('z-10') && tokens.includes('bg-surface');
        const covers = tokens.includes('sticky') || tokens.some((token) => /^z-\d+$/.test(token));
        if (pinned && !stacked) {
          problems.push(`row ${rowIndex} column ${cellIndex} is not stacked above the scroll (${className || 'no class'})`);
        } else if (!pinned && covers) {
          problems.push(`row ${rowIndex} column ${cellIndex} covers the pinned columns (${className})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('styles the Chinese group labels as subtle semibold xs', () => {
    const admin = readPlayground('demos/pages.tsx').split('\n').find((line) => line.includes('>管理<')) ?? '';
    const catalog = readPlayground('main.tsx').split('\n').find((line) => line.includes('整页示例')) ?? '';
    expect(admin).toContain('text-xs font-semibold text-fg-subtle');
    expect(catalog).toContain('text-2xs font-semibold text-fg-subtle');
  });

  it('composes every sheet with SheetContent, SheetHeader, SheetTitle, and SheetBody', () => {
    const parts = ['<SheetContent', '<SheetHeader', '<SheetTitle', '<SheetBody'] as const;
    const missing = playgroundFiles(/\.tsx$/).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('<Sheet')) {
        return [];
      }
      const absent = parts.filter((part) => !source.includes(part));
      return absent.length === 0 ? [] : [`${repoPath(file)} missing ${absent.join(', ')}`];
    });
    expect(missing).toEqual([]);
  });

  it('passes each verdict sample its own status into Verdict', () => {
    const source = readPlayground('sections/oj.tsx');
    expect(source).toContain('<Verdict status={row.status}');
  });

  it('quotes the §7.1 verdict rule in full', () => {
    const source = readPlayground('sections/oj.tsx');
    expect(source).toContain('AC 绿；WA/PE/FE 红；TLE/MLE/OLE 琥珀；RE 紫；CE 橙；评测中蓝 + 旋转；等待/取消/SE 灰。Verdict 内的分数为灰色；需要表达得分高低时，单独用 scoreTone 着色。');
  });

  it('renders scoreTone samples in the order 0, 60, then 100', () => {
    const source = readPlayground('sections/oj.tsx');
    const at = (score: number): number => source.indexOf(`TONE_TEXT[scoreTone(${score})]`);
    const zero = at(0);
    const sixty = at(60);
    const hundred = at(100);
    expect(zero).toBeGreaterThanOrEqual(0);
    expect(sixty).toBeGreaterThan(zero);
    expect(hundred).toBeGreaterThan(sixty);
  });

  it('points comparison faces at the bundled woff2 files', () => {
    const css = readPlayground('playground.css');
    const missing = ['inter.woff2', 'instrument-sans.woff2', 'ibm-plex-sans.woff2', 'onest.woff2'].filter((file) => (
      !css.includes(`url('./fonts/${file}')`) || !existsSync(resolve(playgroundRoot, 'fonts', file))
    ));
    expect(missing).toEqual([]);
  });

  it('keeps the playground document entry on the playground root', () => {
    const html = readFileSync(resolve(packageRoot, 'playground.html'), 'utf8');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/src/playground/main.tsx"></script>');
  });

  it('gives every dialog the normative title, description, and footer', () => {
    const required = ['<DialogContent', '<DialogHeader', '<DialogTitle', '<DialogDescription', '<DialogFooter'] as const;
    const blocks = playgroundFiles(/\.tsx$/).flatMap((file) => dialogBlocks(readFileSync(file, 'utf8')).map((block) => ({
      file: repoPath(file),
      block,
    })));
    expect(blocks.length).toBeGreaterThan(0);
    const missing = blocks.flatMap(({ file, block }) => {
      const absent = required.filter((part) => !block.includes(part));
      return absent.length === 0 ? [] : [`${file} missing ${absent.join(', ')}`];
    });
    expect(missing).toEqual([]);
  });

  it('lets saved tuner params override the defaults that tokensToCss injects', () => {
    const state = readPlayground('state.ts');
    expect(state).toMatch(/\{\s*\.\.\.\(fallback as object\),\s*\.\.\.JSON\.parse\(raw\)\s*\}/);
  });
});
