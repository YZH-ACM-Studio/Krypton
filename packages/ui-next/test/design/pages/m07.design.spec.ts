// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const FILE = 'src/pages/contest-manage.tsx';

// 六个仍在使用的导出页面各一层壳。壳写在导出函数自身上，后面的文件内辅助函数不再套 Page。
const PAGES = [
  ['ContestManagePage', 'wide', ['比赛管理']],
  ['ContestProblemListPage', 'wide', ['比赛题目']],
  ['ContestUserPage', 'wide', ['考生名单', '参赛选手']],
  ['ContestBalloonPage', 'full', ['气球分发']],
  ['ContestClarificationPage', 'wide', ['答疑管理']],
  ['ContestPrintPage', 'wide', ['打印服务']],
] as const;

const STATUS_TONE = [
  ['pass', 'success'],
  ['fail', 'danger'],
  ['progress', 'info'],
] as const;

function source(): string {
  return readSource(FILE);
}

function countOpen(text: string, tag: string): number {
  return [...text.matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g'))].length;
}

function exportRegion(text: string, name: string): string {
  const marker = `export function ${name}`;
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const rest = text.slice(start);
  const next = rest.slice(marker.length).search(/\nexport function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function ownFunction(text: string, name: string): string {
  const marker = `export function ${name}`;
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const rest = text.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function skipStartTag(text: string, open: number): { end: number; selfClosing: boolean } {
  let quote: string | null = null;
  let depth = 0;
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === '>' && depth === 0) {
      return { end: i + 1, selfClosing: text.charAt(i - 1) === '/' };
    }
  }
  return { end: text.length, selfClosing: false };
}

function readJsxAttr(tag: string, name: string): string | null {
  const start = tag.search(new RegExp(`\\b${name}\\s*=`));
  if (start < 0) return null;
  let i = tag.indexOf('=', start) + 1;
  while (tag.charAt(i) === ' ' || tag.charAt(i) === '\n' || tag.charAt(i) === '\t') i += 1;
  const char = tag.charAt(i);
  if (char === '"' || char === "'") {
    const end = tag.indexOf(char, i + 1);
    return end < 0 ? null : tag.slice(i + 1, end);
  }
  if (char !== '{') return null;
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < tag.length; j += 1) {
    const current = tag.charAt(j);
    if (quote) {
      if (current === '\\') {
        j += 1;
        continue;
      }
      if (current === quote) quote = null;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return tag.slice(i + 1, j);
    }
  }
  return null;
}

function tagAt(text: string, name: string, from: number): number {
  const needle = `<${name}`;
  let at = from;
  while (at < text.length) {
    const found = text.indexOf(needle, at);
    if (found < 0) return -1;
    const next = text.charAt(found + needle.length);
    if (next === '' || /[\s>/]/.test(next)) return found;
    at = found + needle.length;
  }
  return -1;
}

function badgeBlocks(text: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < text.length) {
    const at = tagAt(text, 'Badge', from);
    if (at < 0) break;
    const start = skipStartTag(text, at);
    if (start.selfClosing) {
      blocks.push(text.slice(at, start.end));
      from = start.end;
      continue;
    }
    const close = text.indexOf('</Badge>', start.end);
    if (close < 0) break;
    blocks.push(text.slice(at, close + '</Badge>'.length));
    from = close + '</Badge>'.length;
  }
  return blocks;
}

function openTags(text: string, tag: string): string[] {
  const tags: string[] = [];
  const needle = `<${tag}`;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    const next = text.charAt(at + needle.length);
    if (next !== '' && !/[\s>/]/.test(next)) {
      from = at + needle.length;
      continue;
    }
    const start = skipStartTag(text, at);
    tags.push(text.slice(at, start.end));
    from = start.end;
  }
  return tags;
}

function balanced(text: string, open: number, left: string, right: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (text.startsWith(left, i)) depth += 1;
    if (text.startsWith(right, i)) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + right.length);
    }
  }
  return text.slice(open);
}

function statementEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char === ';' && depth === 0) return i + 1;
  }
  return text.length;
}

function callableText(text: string, name: string): string {
  const fn = new RegExp(`function\\s+${name}\\s*\\(`).exec(text);
  const arrow = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_]\\w*)\\s*=>`).exec(text);
  const start = fn?.index ?? arrow?.index ?? -1;
  if (start < 0) return '';
  if (arrow && arrow.index === start) {
    const arrowAt = text.indexOf('=>', start);
    let after = arrowAt + 2;
    while (text.charAt(after) === ' ' || text.charAt(after) === '\n') after += 1;
    if (text.charAt(after) !== '{') return text.slice(start, statementEnd(text, after));
    return text.slice(start, after + balanced(text, after, '{', '}').length);
  }
  const brace = text.indexOf('{', start);
  if (brace < 0) return '';
  return text.slice(start, brace + balanced(text, brace, '{', '}').length);
}

function withObjectLiterals(text: string, expression: string): string {
  let extra = expression;
  const names = new Set([...expression.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((match) => match[1] ?? ''));
  for (const name of names) {
    if (name === '') continue;
    const decl = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\{`).exec(text);
    if (decl?.index === undefined) continue;
    const brace = text.indexOf('{', decl.index);
    if (brace < 0) continue;
    extra += `\n${balanced(text, brace, '{', '}')}`;
  }
  return extra;
}

function bindingStatement(text: string, name: string): string {
  const decl = new RegExp(`(?:const|let)\\s+${name}\\s*=`).exec(text);
  if (decl?.index === undefined) return '';
  return text.slice(decl.index, statementEnd(text, decl.index));
}

function expandTone(text: string, expression: string): string {
  let expanded = expression.trim();
  const seen = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    const root = /^[A-Za-z_]\w*$/.exec(expanded.split('\n')[0] ?? '');
    if (root && !seen.has(root[0])) {
      seen.add(root[0]);
      const binding = bindingStatement(text, root[0]);
      if (binding !== '') {
        expanded += `\n${binding}`;
        grew = true;
      }
    }
    for (const match of expanded.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const name = match[1] ?? '';
      if (name === '' || seen.has(`fn:${name}`)) continue;
      seen.add(`fn:${name}`);
      const body = callableText(text, name);
      if (body === '') continue;
      expanded += `\n${withObjectLiterals(text, body)}`;
      grew = true;
    }
  }
  return withObjectLiterals(text, expanded);
}

function isStatusBadge(tag: string): boolean {
  const flat = tag.replaceAll(/\s+/g, '');
  return flat.includes('title={status.title}')
    || flat.includes('title={status?.title')
    || flat.includes('title={practiceStatus.title}')
    || flat.includes('尚未补题');
}

function hasQuoted(text: string, value: string): boolean {
  return text.includes(`'${value}'`) || text.includes(`"${value}"`);
}

// 色码到 tone 必须落在该字面量之后、下一个状态码之前，避免 pass 的窗口吞进 fail 的 success。
function mapsCodeToTone(text: string, code: string, tone: string): boolean {
  const others = STATUS_TONE.map(([item]) => item).filter((item) => item !== code);
  const nextCode = new RegExp(`['"](?:${others.join('|')})['"]`);
  for (const match of text.matchAll(new RegExp(`['"]${code}['"]`, 'g'))) {
    const at = (match.index ?? 0) + match[0].length;
    const after = text.slice(at, at + 800);
    const boundary = nextCode.exec(after);
    const slice = boundary ? after.slice(0, boundary.index) : after;
    if (hasQuoted(slice, tone)) return true;
  }
  return false;
}

function expectStatusTone(text: string, label: string): void {
  for (const [code, tone] of STATUS_TONE) {
    expect(mapsCodeToTone(text, code, tone), `${label} ${code} → ${tone}`).toBe(true);
  }
  expect(hasQuoted(text, 'neutral'), `${label} 默认 neutral`).toBe(true);
  expect(text, label).not.toMatch(/\b(?:emerald|rose|sky|green|amber|red|blue)-\d/);
}

describe('m07 contest management', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('页面结构 contest-manage.tsx', () => {
    expectPageStructure(FILE, {
      widths: ['wide', 'full'],
      workspace: 'forbidden',
      minPageHeaders: 6,
    });
  });

  it('六个导出页面使用规定宽度且各有一个 PageHeader', () => {
    const text = source();
    expect(countOpen(text, 'Page')).toBe(PAGES.length);
    expect(countOpen(text, 'PageHeader')).toBe(PAGES.length);
    for (const [name, width, headings] of PAGES) {
      const region = exportRegion(text, name);
      const own = ownFunction(text, name);
      expect(region.length, name).toBeGreaterThan(0);
      expect(own.length, name).toBeGreaterThan(0);
      const pages = [...own.matchAll(/<Page(?=[\s>])([^>]*)>/g)];
      expect(pages.length, name).toBe(1);
      expect(pages[0]?.[1] ?? '', name).toMatch(new RegExp(`\\bwidth="${width}"`));
      expect(countOpen(own, 'PageHeader'), name).toBe(1);
      expect(countOpen(region, 'Page'), name).toBe(1);
      expect(countOpen(region, 'PageHeader'), name).toBe(1);
      for (const heading of headings) expect(region, `${name} ${heading}`).toContain(heading);
    }
  });

  it('删除 badgeClass，题目状态改为返回 tone 并用 Badge tone', () => {
    const text = source();
    const problems = exportRegion(text, 'ContestProblemListPage');
    expect(text).not.toMatch(/\bbadgeClass\b/);
    const badges = openTags(problems, 'Badge').filter(isStatusBadge);
    expect(badges.length).toBe(4);
    for (const tag of badges) {
      expect(tag).not.toMatch(/\bbadgeClass\b|\bstatusClass\b|\bpracticeStatusClass\b/);
      expect(tag).not.toMatch(/\b(?:emerald|rose|sky|green|amber|red|blue)-\d/);
      const tone = readJsxAttr(tag, 'tone');
      expect(tone, '题目状态 Badge 要写 tone').not.toBeNull();
      expectStatusTone(expandTone(text, tone ?? ''), '题目状态');
    }
  });

  it('气球已送达和选手参赛中状态 Badge 写 tone', () => {
    const blocks = badgeBlocks(source());
    const missing = ['已送达', '参赛中'].filter((label) => {
      const block = blocks.find((item) => item.includes(label));
      return block === undefined || readJsxAttr(block, 'tone') === null;
    });
    expect(missing).toEqual([]);
  });
});
