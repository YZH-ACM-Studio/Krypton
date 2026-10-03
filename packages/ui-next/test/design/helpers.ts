import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scanOpenTags, scanSource } from '../../scripts/design-gate.mjs';

const packageRoot = resolve(import.meta.dirname, '../..');
const PAGE_WIDTHS = ['prose', 'form', 'wide', 'full'] as const;
const PAGE_WIDTH_SET: ReadonlySet<string> = new Set(PAGE_WIDTHS);

type PageWidth = (typeof PAGE_WIDTHS)[number];

export interface PageStructureSpec {
  widths: Array<PageWidth>;
  workspace: 'required' | 'forbidden' | 'allowed';
  minPageHeaders: number;
}

export function readSource(file: string): string {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

export function countMatches(source: string, pattern: RegExp): number {
  if (!pattern.global) {
    throw new TypeError('countMatches requires a RegExp with the g flag');
  }
  const expression = new RegExp(pattern.source, pattern.flags);
  let count = 0;
  for (let match = expression.exec(source); match !== null; match = expression.exec(source)) {
    count += 1;
    if (match[0].length === 0) {
      expression.lastIndex += 1;
    }
  }
  return count;
}

function assertPageStructureSpec(spec: PageStructureSpec): void {
  if (!Array.isArray(spec.widths)) {
    throw new TypeError('checkPageStructure widths must be an array');
  }
  if (spec.workspace !== 'required' && spec.workspace !== 'forbidden' && spec.workspace !== 'allowed') {
    throw new TypeError('checkPageStructure workspace is invalid');
  }
  if (!Number.isInteger(spec.minPageHeaders) || spec.minPageHeaders < 0) {
    throw new RangeError('checkPageStructure minPageHeaders must be an integer >= 0');
  }
}

function isPageWidth(value: string): value is PageWidth {
  return PAGE_WIDTH_SET.has(value);
}

function countTags(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

export function checkPageStructure(source: string, spec: PageStructureSpec): string[] {
  assertPageStructureSpec(spec);
  const text = source.replaceAll('\r\n', '\n');
  const problems: string[] = [];
  const pages = [...text.matchAll(/<Page(?=[\s>])([^>]*)>/g)];
  const widthCounts = new Map<PageWidth, number>();
  let missingWidth = 0;
  for (const page of pages) {
    const width = /\bwidth="(prose|form|wide|full)"/.exec(page[1] ?? '');
    const value = width?.[1];
    if (value === undefined || !isPageWidth(value)) {
      missingWidth += 1;
      continue;
    }
    widthCounts.set(value, (widthCounts.get(value) ?? 0) + 1);
  }
  if (missingWidth > 0) {
    problems.push(`缺少 width 的 <Page 出现 ${missingWidth} 次`);
  }
  if (spec.widths.length === 0) {
    if (pages.length > 0) {
      problems.push(`<Page 出现 ${pages.length} 次，允许的宽度列表为空`);
    }
  }
  for (const width of PAGE_WIDTHS) {
    const count = widthCounts.get(width) ?? 0;
    if (!spec.widths.includes(width) && count > 0) {
      problems.push(`未列出的宽度 ${width} 出现 ${count} 次`);
    }
  }
  const workspaceCount = countTags(text, /<Workspace(?=[\s>])/g);
  if (spec.workspace === 'required' && workspaceCount < 1) {
    problems.push(`<Workspace 出现 ${workspaceCount} 次，要求至少 1 次`);
  }
  if (spec.workspace === 'forbidden' && workspaceCount !== 0) {
    problems.push(`<Workspace 出现 ${workspaceCount} 次，要求恰好 0 次`);
  }
  const headerCount = countTags(text, /<PageHeader(?=[\s>])/g);
  if (headerCount < spec.minPageHeaders) {
    problems.push(`<PageHeader 出现 ${headerCount} 次，要求至少 ${spec.minPageHeaders} 次`);
  }
  const headingCount = countTags(text, /<h1(?=[\s>])/g);
  if (headingCount !== 0) {
    problems.push(`<h1 出现 ${headingCount} 次，要求恰好 0 次`);
  }
  return problems;
}

export function expectPageStructure(file: string, spec: PageStructureSpec): void {
  const problems = checkPageStructure(readSource(file), spec);
  if (problems.length > 0) {
    throw new Error(`${file}\n${problems.join('\n')}`);
  }
}

export function findOpenTags(source: string, tag: string): { line: number; text: string }[] {
  return scanOpenTags(source, tag);
}

export function checkExplicitButtonVariants(source: string): number[] {
  const lines: number[] = [];
  for (const tag of scanOpenTags(source, 'Button')) {
    if (!tag.text.includes('variant=')) {
      lines.push(tag.line);
    }
  }
  return lines;
}

export function expectGateClean(files: string[]): void {
  const problems: string[] = [];
  for (const file of files) {
    for (const item of scanSource(readSource(file), file)) {
      problems.push(`${item.file}:${item.line} ${item.rule} ${item.snippet.replaceAll(/\s+/g, ' ')}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

export function expectExplicitButtonVariants(files: string[]): void {
  const problems: string[] = [];
  for (const file of files) {
    for (const line of checkExplicitButtonVariants(readSource(file))) {
      problems.push(`${file}:${line} 缺少 variant=`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}
