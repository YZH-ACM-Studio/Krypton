// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

function skipQuoted(text: string, index: number): number {
  const quote = text[index] ?? '';
  let i = index + 1;
  if (quote === '`') {
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '$' && text[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < text.length && depth > 0) {
          const ch = text[i] ?? '';
          if (ch === "'" || ch === '"' || ch === '`') {
            i = skipQuoted(text, i);
            continue;
          }
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
          i += 1;
        }
        continue;
      }
      if (text[i] === '`') return i + 1;
      i += 1;
    }
    return i;
  }
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function readReturnEnd(text: string, returnAt: number): number {
  let i = returnAt + 'return'.length;
  while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
  if (text[i] !== '(') {
    const end = text.indexOf(';', i);
    return end === -1 ? text.length : end;
  }
  let depth = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** Text of the AppShell branch that decides teach_paper_print.html, including its return. */
function teachPaperPrintBranch(appShell: string): string {
  const at = appShell.search(/['"]teach_paper_print\.html['"]/);
  if (at < 0) return '';
  const returns: number[] = [];
  for (const match of appShell.matchAll(/\breturn\b/g)) {
    if (match.index !== undefined) returns.push(match.index);
  }
  const after = returns.find((pos) => pos > at);
  const before = returns.findLast((pos) => pos < at);
  const regions: string[] = [];
  if (after !== undefined) regions.push(appShell.slice(at, readReturnEnd(appShell, after)));
  if (before !== undefined) {
    const end = readReturnEnd(appShell, before);
    if (end > at) regions.push(appShell.slice(before, end));
  }
  return regions.find((region) => /PageResolver/.test(region)) ?? regions[0] ?? '';
}

/** Shells that skip DefaultAppShell before this lane adds teach_paper_print.html. */
const EXISTING_STANDALONE_TEMPLATES = [
  'exam_mode_home.html',
  'exam_contest.html',
  'exam_paper.html',
  'contest_workspace.html',
  'set_workspace.html',
] as const;

describe('teach paper print registration', () => {
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const router = source('packages/ui-next/src/router.tsx');

  it('maps teach_paper_print.html to TeachPaperPrintPage', () => {
    const pageMap = sliceBetween(resolver, 'const PAGE_MAP', 'export function PageResolver');
    expect(pageMap).to.match(/'teach_paper_print\.html':\s*TeachPaperPrintPage\b/);
    expect(
      resolver,
      'resolver must import TeachPaperPrintPage from @/pages/teach/paper-print',
    ).to.match(/import\s*\{[^}]*\bTeachPaperPrintPage\b[^}]*\}\s*from\s*['"]@\/pages\/teach\/paper-print['"]/);
  });

  it('includes teach_paper_print.html in STANDALONE_TEMPLATES with the existing shells', () => {
    const standalone = router.match(/const STANDALONE_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(standalone).to.include('teach_paper_print.html');
    for (const template of EXISTING_STANDALONE_TEMPLATES) {
      expect(standalone, template).to.include(template);
    }
    const appShell = sliceBetween(router, 'function AppShell()', 'function DefaultAppShell()');
    expect(appShell).to.include('STANDALONE_TEMPLATES.has');
    expect(appShell).to.include('<PageResolver />');
    // #root is height:100% + overflow:hidden. The bare standalone return clips a long paper and its printout.
    const printBranch = teachPaperPrintBranch(appShell);
    expect(
      printBranch,
      'teach_paper_print.html branch must wrap the page in h-full or h-dvh',
    ).to.match(/(?<![\w-])(?:h-full|h-dvh)(?![\w-])/);
    expect(printBranch, 'teach_paper_print.html branch must use overflow-auto').to.match(/(?<![\w-])overflow-auto(?![\w-])/);
    expect(printBranch, 'print scroller must still render the page').to.include('PageResolver');
    const printAt = printBranch.search(/@media\s+print\b/);
    const printCss = printAt < 0 ? '' : printBranch.slice(printAt);
    expect(printCss, 'print branch @media print must name html').to.include('html');
    expect(printCss, 'print branch @media print must name body').to.include('body');
    expect(printCss, 'print branch @media print must name #root').to.include('#root');
    expect(printCss, 'print branch must set height:auto').to.match(/height:\s*auto\b/);
    expect(printCss, 'print branch must set overflow:visible').to.match(/overflow:\s*visible\b/);
  });
});
