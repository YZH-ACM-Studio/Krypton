// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scoreTone } from '../../../src/components/ui/verdict';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap';
import { ContestScoreboardPage } from '../../../src/pages/contests';

const FILE = 'src/pages/contests.tsx';
const packageRoot = resolve(import.meta.dirname, '../../..');

/** OI 封榜格：封榜前分数在前，封榜后的新提交是服务端下发的 color:orange +n。 */
const PRE_FREEZE_SCORES = [
  { score: 60, pending: 1, column: 3 },
  { score: 100, pending: 2, column: 4 },
  { score: 0, pending: 1, column: 5 },
] as const;

interface ScoreCell {
  type: string;
  value?: string | number;
  raw?: string | number;
  score?: number;
  scorePercentage?: number;
}

function frozenValue(score: number, pending: number): string {
  return `${score}<span style="color:orange">+${pending}</span>`;
}

function bootstrap(pageData: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      contests: '/contest',
      contestDetail: '/contest/__TID__',
      homework: '/homework',
      homeworkDetail: '/homework/__TID__',
      problemDetail: '/p/__PID__',
      recordDetail: '/record/__RID__',
      userDetail: '/user/__UID__',
      records: '/record',
      discussionNode: '/discuss/__TYPE__/__NAME__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'contest_scoreboard.html', data: pageData },
  };
}

function frozenBoard(): Record<string, unknown> {
  const header: ScoreCell[] = [
    { type: 'rank', value: '#' },
    { type: 'user', value: '用户' },
    { type: 'total_score', value: '总分' },
    ...PRE_FREEZE_SCORES.map((item, index) => ({
      type: 'problem',
      value: String.fromCharCode(65 + index),
      raw: 101 + index,
    })),
  ];
  const row: ScoreCell[] = [
    { type: 'rank', value: '1' },
    { type: 'user', value: 'student', raw: 7 },
    { type: 'total_score', value: 160, score: 160, scorePercentage: 53 },
    ...PRE_FREEZE_SCORES.map((item, index) => ({
      type: 'record',
      value: frozenValue(item.score, item.pending),
      score: item.score,
      scorePercentage: item.score,
      raw: `rid-${index}`,
    })),
  ];
  return {
    tdoc: {
      docId: 'contest-oi',
      title: 'OI 封榜',
      rule: 'oi',
      lockAt: '2026-10-04T01:00:00.000Z',
      unlocked: false,
    },
    currentUserId: 7,
    examMode: { enabled: true },
    rows: [header, row],
    pdict: {},
    udict: {},
  };
}

function renderBoard(): HTMLElement {
  return render(createElement(
    BootstrapProvider,
    { bootstrap: bootstrap(frozenBoard()) },
    createElement(ContestScoreboardPage),
  )).container;
}

function currentRow(container: HTMLElement): HTMLTableRowElement {
  const row = container.querySelector('tbody tr[aria-current="true"]');
  expect(row).toBeInstanceOf(HTMLTableRowElement);
  if (!(row instanceof HTMLTableRowElement)) {
    throw new TypeError('current scoreboard row missing');
  }
  return row;
}

function bodyCells(container: HTMLElement): HTMLTableCellElement[] {
  return [...currentRow(container).querySelectorAll('td')];
}

type Mode = 'code' | 'sq' | 'dq' | 'tmpl' | 'line' | 'block';

interface BraceSpan {
  start: number;
  end: number;
}

function braceSpans(source: string): BraceSpan[] {
  const spans: BraceSpan[] = [];
  const braces: number[] = [];
  const modes: Mode[] = ['code'];
  const interp: boolean[] = [];
  const mode = () => modes[modes.length - 1] ?? 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    const next = source[i + 1];
    const current = mode();
    if (current === 'line') {
      if (ch === '\n') modes.pop();
      continue;
    }
    if (current === 'block') {
      if (ch === '*' && next === '/') {
        modes.pop();
        i += 1;
      }
      continue;
    }
    if (current === 'sq' || current === 'dq') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if ((current === 'sq' && ch === "'") || (current === 'dq' && ch === '"')) modes.pop();
      continue;
    }
    if (current === 'tmpl') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '`') {
        modes.pop();
        continue;
      }
      if (ch === '$' && next === '{') {
        braces.push(i + 1);
        interp.push(true);
        modes.push('code');
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      modes.push('line');
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      modes.push('block');
      i += 1;
      continue;
    }
    if (ch === "'") {
      modes.push('sq');
      continue;
    }
    if (ch === '"') {
      modes.push('dq');
      continue;
    }
    if (ch === '`') {
      modes.push('tmpl');
      continue;
    }
    if (ch === '{') {
      braces.push(i);
      interp.push(false);
      continue;
    }
    if (ch === '}') {
      const start = braces.pop();
      const wasInterp = interp.pop();
      if (start !== undefined) spans.push({ start, end: i });
      if (wasInterp) modes.pop();
    }
  }
  return spans;
}

function markerIndexes(source: string): number[] {
  const found: number[] = [];
  const modes: Mode[] = ['code'];
  const mode = () => modes[modes.length - 1] ?? 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    const next = source[i + 1];
    const current = mode();
    if (current === 'line') {
      if (ch === '\n') modes.pop();
      continue;
    }
    if (current === 'block') {
      if (ch === '*' && next === '/') {
        modes.pop();
        i += 1;
      }
      continue;
    }
    if (current === 'sq' || current === 'dq' || current === 'tmpl') {
      if (source.startsWith('场比赛', i)) found.push(i);
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (current === 'tmpl' && ch === '$' && next === '{') {
        modes.push('code');
        i += 1;
        continue;
      }
      if ((current === 'sq' && ch === "'") || (current === 'dq' && ch === '"') || (current === 'tmpl' && ch === '`')) {
        modes.pop();
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      modes.push('line');
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      modes.push('block');
      i += 1;
      continue;
    }
    if (ch === "'") {
      modes.push('sq');
      continue;
    }
    if (ch === '"') {
      modes.push('dq');
      continue;
    }
    if (ch === '`') {
      modes.push('tmpl');
      continue;
    }
    if (ch === '}' && modes.length > 1) modes.pop();
    if (source.startsWith('场比赛', i)) found.push(i);
  }
  return found;
}

function unwrapParens(expr: string): string {
  let value = expr.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let closes = false;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      if (value[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          closes = i === value.length - 1;
          break;
        }
      }
    }
    if (!closes) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isMultiPageCondition(expr: string): boolean {
  const text = unwrapParens(expr);
  if (text.startsWith('!')) return isSinglePageCondition(text.slice(1));
  return /^tpcount\s*>\s*1$/.test(text);
}

function isSinglePageCondition(expr: string): boolean {
  const text = unwrapParens(expr);
  if (text.startsWith('!')) return isMultiPageCondition(text.slice(1));
  return /^tpcount\s*<=\s*1$/.test(text);
}

function keywordBefore(source: string, openParen: number): string {
  let end = openParen - 1;
  while (end >= 0 && /\s/.test(source[end] ?? '')) end -= 1;
  let start = end;
  while (start >= 0 && /[\w$]/.test(source[start] ?? '')) start -= 1;
  return source.slice(start + 1, end + 1);
}

function matchParenBackward(source: string, closeAt: number): number {
  let depth = 0;
  for (let i = closeAt; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `{` 若是 `if (tpcount …)` 的函数体，返回该条件是否放行「场比赛」。 */
function ifBraceVerdict(source: string, braceAt: number): boolean | null {
  let cursor = braceAt - 1;
  while (cursor >= 0 && /\s/.test(source[cursor] ?? '')) cursor -= 1;
  if (source[cursor] !== ')') return null;
  const open = matchParenBackward(source, cursor);
  if (open < 0 || keywordBefore(source, open) !== 'if') return null;
  const cond = source.slice(open + 1, cursor);
  if (isSinglePageCondition(cond)) return true;
  if (isMultiPageCondition(cond)) return false;
  return null;
}

interface Ternary {
  condStart: number;
  question: number;
  colon: number;
  end: number;
}

interface IfStmt {
  cond: string;
  bodyStart: number;
  bodyEnd: number;
}

function depth0(paren: number, brace: number, bracket: number): boolean {
  return paren === 0 && brace === 0 && bracket === 0;
}

function bodyExits(body: string): boolean {
  const text = body.trim();
  if (/^(?:return|throw)\b/.test(text)) return true;
  return /^\{\s*(?:return|throw)\b[^;]*;\s*\}$/.test(text);
}

function regionVerdict(region: string, markerAt: number): boolean | null {
  const modes: Mode[] = ['code'];
  const interp: boolean[] = [];
  const mode = () => modes[modes.length - 1] ?? 'code';
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let exprStart = 0;
  const ternaries: Ternary[] = [];
  const openTernary: Ternary[] = [];
  const ands: number[] = [];
  const semis: number[] = [-1];
  const ifs: IfStmt[] = [];
  const finishTernaries = (end: number) => {
    while (openTernary.length > 0 && (openTernary[openTernary.length - 1]?.colon ?? -1) >= 0) {
      const done = openTernary.pop();
      if (done) done.end = end;
    }
  };

  for (let i = 0; i < region.length; i += 1) {
    const ch = region[i] ?? '';
    const next = region[i + 1];
    const current = mode();
    if (current === 'line') {
      if (ch === '\n') modes.pop();
      continue;
    }
    if (current === 'block') {
      if (ch === '*' && next === '/') {
        modes.pop();
        i += 1;
      }
      continue;
    }
    if (current === 'sq' || current === 'dq') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if ((current === 'sq' && ch === "'") || (current === 'dq' && ch === '"')) modes.pop();
      continue;
    }
    if (current === 'tmpl') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '`') {
        modes.pop();
        continue;
      }
      if (ch === '$' && next === '{') {
        brace += 1;
        interp.push(true);
        modes.push('code');
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      modes.push('line');
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      modes.push('block');
      i += 1;
      continue;
    }
    if (ch === "'") {
      modes.push('sq');
      continue;
    }
    if (ch === '"') {
      modes.push('dq');
      continue;
    }
    if (ch === '`') {
      modes.push('tmpl');
      continue;
    }
    const flat = depth0(paren, brace, bracket);
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '{') {
      brace += 1;
      interp.push(false);
    } else if (ch === '}') {
      brace -= 1;
      if (interp.pop()) modes.pop();
    } else if (flat && ch === '?' && next !== '.' && next !== '?') {
      openTernary.push({ condStart: exprStart, question: i, colon: -1, end: region.length });
      exprStart = i + 1;
    } else if (flat && ch === ':') {
      while (openTernary.length > 0 && (openTernary[openTernary.length - 1]?.colon ?? -1) >= 0) {
        const done = openTernary.pop();
        if (done) done.end = i;
      }
      const pending = openTernary[openTernary.length - 1];
      if (pending && pending.colon < 0) {
        pending.colon = i;
        ternaries.push(pending);
        exprStart = i + 1;
      }
    } else if (flat && ch === '&' && next === '&') {
      ands.push(i);
      i += 1;
    } else if (flat && ch === ';') {
      finishTernaries(i);
      semis.push(i);
      exprStart = i + 1;
    } else if (flat && region.startsWith('if', i) && !/[\w$]/.test(region[i - 1] ?? '') && !/[\w$]/.test(region[i + 2] ?? '')) {
      const parsed = readIf(region, i);
      if (parsed) {
        ifs.push(parsed.stmt);
        i = parsed.next - 1;
      }
    }
  }
  finishTernaries(region.length);

  let showed: boolean | null = null;
  const decide = (next: boolean) => {
    if (!next) showed = false;
    else if (showed === null) showed = true;
  };
  for (const ternary of ternaries) {
    if (markerAt <= ternary.question || markerAt >= ternary.end || ternary.colon < 0) continue;
    const cond = region.slice(ternary.condStart, ternary.question);
    const inTrue = markerAt < ternary.colon;
    if (inTrue && isSinglePageCondition(cond)) decide(true);
    else if (!inTrue && isMultiPageCondition(cond)) decide(true);
    else if (inTrue && isMultiPageCondition(cond)) decide(false);
    else if (!inTrue && isSinglePageCondition(cond)) decide(false);
  }
  if (showed === false) return false;
  const stmtStart = semis.filter((index) => index < markerAt).at(-1) ?? -1;
  const stmtEnd = semis.find((index) => index > markerAt) ?? region.length;
  const gates = ands.filter((index) => index > stmtStart && index < markerAt && index < stmtEnd);
  if (gates.length > 0) {
    const left = region.slice(stmtStart + 1, gates[gates.length - 1]);
    const conjuncts = splitDepth0And(left);
    if (conjuncts.some((part) => isMultiPageCondition(part))) decide(false);
    else if (conjuncts.some((part) => isSinglePageCondition(part))) decide(true);
  }
  if (showed === false) return false;
  for (const stmt of ifs) {
    const cond = stmt.cond;
    const contains = markerAt >= stmt.bodyStart && markerAt < stmt.bodyEnd;
    const exitsEarly = stmt.bodyEnd <= markerAt && bodyExits(region.slice(stmt.bodyStart, stmt.bodyEnd));
    if (contains && isSinglePageCondition(cond)) decide(true);
    else if (contains && isMultiPageCondition(cond)) decide(false);
    else if (exitsEarly && isMultiPageCondition(cond)) decide(true);
    else if (exitsEarly && isSinglePageCondition(cond)) decide(false);
  }
  return showed;
}

function splitDepth0And(expr: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (depth0(paren, brace, bracket) && ch === '&' && expr[i + 1] === '&') {
      parts.push(expr.slice(start, i));
      start = i + 2;
      i += 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function readIf(region: string, at: number): { stmt: IfStmt; next: number } | null {
  let i = at + 2;
  while (/\s/.test(region[i] ?? '')) i += 1;
  if (region[i] !== '(') return null;
  let paren = 0;
  const condStart = i + 1;
  for (; i < region.length; i += 1) {
    if (region[i] === '(') paren += 1;
    else if (region[i] === ')') {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  const cond = region.slice(condStart, i);
  i += 1;
  while (/\s/.test(region[i] ?? '')) i += 1;
  const bodyStart = i;
  if (region[i] === '{') {
    let brace = 0;
    for (; i < region.length; i += 1) {
      if (region[i] === '{') brace += 1;
      else if (region[i] === '}') {
        brace -= 1;
        if (brace === 0) {
          i += 1;
          break;
        }
      }
    }
  } else {
    while (i < region.length && region[i] !== ';') i += 1;
    if (region[i] === ';') i += 1;
  }
  return { stmt: { cond, bodyStart, bodyEnd: i }, next: i };
}

function markerGuarded(source: string, markerAt: number): boolean {
  const spans = braceSpans(source).filter((span) => markerAt > span.start && markerAt < span.end);
  spans.sort((left, right) => (left.end - left.start) - (right.end - right.start));
  for (const span of spans) {
    const braced = ifBraceVerdict(source, span.start);
    if (braced !== null) return braced;
    const verdict = regionVerdict(source.slice(span.start + 1, span.end), markerAt - (span.start + 1));
    if (verdict !== null) return verdict;
  }
  return false;
}

function contestCountExcerpt(source: string, markerAt: number): string {
  const spans = braceSpans(source).filter((span) => markerAt > span.start && markerAt < span.end);
  spans.sort((left, right) => (left.end - left.start) - (right.end - right.start));
  const span = spans[0];
  const text = span ? source.slice(span.start, span.end + 1) : source.slice(Math.max(0, markerAt - 80), markerAt + 12);
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

describe('p04 contest scoreboard freeze, sticky row, contest count', () => {
  it('封榜前有分数的格子 class 含对应 text-{tone}-fg，不含 bg-info-soft', () => {
    const cells = bodyCells(renderBoard());
    for (const item of PRE_FREEZE_SCORES) {
      const cell = cells[item.column];
      expect(cell, `score ${item.score}`).toBeInstanceOf(HTMLTableCellElement);
      const className = cell?.getAttribute('class') ?? '';
      const tone = scoreTone(item.score);
      expect(cell?.textContent ?? '', className).toContain(String(item.score));
      expect(className, className).toContain(`text-${tone}-fg`);
      expect(className, className).not.toContain('bg-info-soft');
    }
  });

  it('当前行的 sticky 单元格 class 含 bg-brand-soft 且不含 bg-brand-soft/', () => {
    const sticky = [...currentRow(renderBoard()).querySelectorAll('td')].filter((cell) => cell.classList.contains('sticky'));
    expect(sticky.length).toBeGreaterThan(0);
    for (const cell of sticky) {
      const className = cell.getAttribute('class') ?? '';
      expect(className, className).toContain('bg-brand-soft');
      expect(className, className).not.toContain('bg-brand-soft/');
    }
  });

  it('「场比赛」只在 tpcount <= 1（或 tpcount > 1 的否定分支）中渲染', () => {
    const source = readFileSync(resolve(packageRoot, FILE), 'utf8');
    const indexes = markerIndexes(source);
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(markerGuarded(source, index), contestCountExcerpt(source, index)).toBe(true);
    }
  });

  it('设计门禁对本 lane 文件为零违规', () => {
    let status = 0;
    try {
      execFileSync(process.execPath, ['scripts/design-gate.mjs', '--file', FILE], {
        cwd: packageRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
        status = error.status;
      } else {
        throw error;
      }
    }
    expect(status).toBe(0);
  });
});
