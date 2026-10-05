// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/vigil/index.tsx';
const LANE_FILES = [PAGE] as const;

// legacy-intents T01–T04 没有源文件 src/pages/vigil/index.tsx 的条目。
const STUDENT_CARD = '@/pages/vigil/student-card';
const DISPLAY_STAT = '@/components/ui/display';
const PANEL = '@/components/ui/panel';

const OVERVIEW_STAT_LABELS = ['在线客户端', '进行中会话', '待审批', '今日事件'] as const;
const DETAIL_STAT_LABELS = ['已连接', '异常', '离线', '已结束', '待审批', '总人数'] as const;
const WALL_GRID = ['grid', 'gap-3', 'sm:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4', '3xl:grid-cols-6'] as const;
const WALL_GRID_FORBIDDEN = ['grid-cols-2', 'md:grid-cols-3', '2xl:grid-cols-5'] as const;
const EXAM_CARD_HREF = /\/admin\/vigil\/exams\/\$\{encodeURIComponent\(group\.examId\)\}/;

const SKIP_CLASS_IDENTS = new Set(['cn', 'className', 'true', 'false', 'undefined', 'null']);

function importsLocalBinding(source: string, local: string, specifier: string): boolean {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] !== specifier) continue;
    const names = (match[1] ?? '').split(',').map((part) => {
      const cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
      if (cleaned.length === 0) return '';
      const alias = cleaned.split(/\s+as\s+/);
      return (alias.length > 1 ? alias[1] : alias[0])?.trim() ?? '';
    });
    if (names.includes(local)) return true;
  }
  return false;
}

function quotedPieces(expression: string): string[] {
  return [...expression.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1] ?? '');
}

function initializerOf(source: string, ident: string): string {
  const match = new RegExp(`(?:const|let)\\s+${ident}\\b[^\\n=]*=\\s*([^;\\n]+)`).exec(source);
  return match?.[1]?.trim() ?? '';
}

function classText(source: string, expression: string): string {
  const pieces = quotedPieces(expression);
  const idents = [...expression.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0] ?? '');
  for (const ident of idents) {
    if (SKIP_CLASS_IDENTS.has(ident)) continue;
    const init = initializerOf(source, ident);
    if (init.length > 0) pieces.push(...quotedPieces(init));
  }
  return pieces.join(' ');
}

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

/** 学生卡前面最近的、带 grid 的 class。常量与 cn() 都展开成最终 class 文本。 */
function studentWallGrid(source: string): string {
  const at = source.indexOf('<StudentCard');
  if (at < 0) return '';
  const window = source.slice(Math.max(0, at - 2500), at);
  const values: string[] = [];
  for (const match of window.matchAll(/className=(?:"([^"]*)"|'([^']*)'|\{([^}]+)\})/g)) {
    if (match[1] !== undefined) values.push(match[1]);
    else if (match[2] !== undefined) values.push(match[2]);
    else values.push(classText(source, match[3] ?? ''));
  }
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index] ?? '';
    if (classTokens(value).includes('grid')) return value;
  }
  return '';
}

function missingTokens(value: string, tokens: readonly string[]): string[] {
  const parts = classTokens(value);
  const missing: string[] = [];
  let from = 0;
  for (const token of tokens) {
    const found = parts.indexOf(token, from);
    if (found < 0) missing.push(token);
    else from = found + 1;
  }
  return missing;
}

/** 注释里的标签字符串不算；只留下能被扫描到的源码。 */
function withoutComments(source: string): string {
  let out = '';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (quote.length > 0) {
      out += char;
      if (char === '\\') {
        out += next;
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function statLabel(tag: string): string {
  const match = /label=(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? match?.[5] ?? '';
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function statLabelCounts(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of findOpenTags(withoutComments(source), 'Stat')) {
    const label = statLabel(tag.text);
    if (label.length === 0) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

describe('e09 vigil proctoring overview and exam detail', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 vigil/index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
    const src = readSource(PAGE);
    expect(src.includes('<Page ') || src.includes('<Page>')).toBe(false);
    expect(src).not.toMatch(/<Workspace(?=[\s>])/);
    let overviewTitles = 0;
    for (const match of src.matchAll(/反作弊总览/g)) {
      if (match[0]) overviewTitles += 1;
    }
    expect(overviewTitles).toBeGreaterThanOrEqual(2);
    expect(src).toContain('反作弊 · ');
  });

  it('局部 Stat 与 CompactStat 改为 display 的 Stat', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bfunction Stat\s*\(/);
    expect(src).not.toMatch(/\bconst Stat\b/);
    expect(src).not.toMatch(/\bfunction CompactStat\b/);
    expect(src).not.toMatch(/\bconst CompactStat\b/);
    expect(src).not.toMatch(/<CompactStat\b/);
    expect(importsLocalBinding(src, 'Stat', DISPLAY_STAT)).toBe(true);
    const overviewMissing = OVERVIEW_STAT_LABELS.filter((label) => (statLabelCounts(functionBody(src, 'VigilLiveOverviewPage')).get(label) ?? 0) < 1);
    const detailMissing = DETAIL_STAT_LABELS.filter((label) => (statLabelCounts(functionBody(src, 'AdminVigilExamDetailPage')).get(label) ?? 0) < 1);
    expect({ overviewMissing, detailMissing }).toEqual({ overviewMissing: [], detailMissing: [] });
  });

  it('把 ExamCard 改为 Panel', () => {
    const src = readSource(PAGE);
    const card = functionBody(src, 'ExamGroupLink');
    expect(src).not.toMatch(/\bfunction ExamCard\b/);
    expect(src).not.toMatch(/<ExamCard\b/);
    expect(importsLocalBinding(src, 'Panel', PANEL)).toBe(true);
    expect(findOpenTags(card, 'Panel').length).toBeGreaterThan(0);
    expect(card).toMatch(EXAM_CARD_HREF);
  });

  it('保持 StatusPill 的导入名', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bfunction StatusPill\b/);
    expect(src).not.toMatch(/\bStatusPill\s+as\s+/);
    expect(src).not.toMatch(/\bas\s+StatusPill\b/);
    expect(importsLocalBinding(src, 'StudentCard', STUDENT_CARD)).toBe(true);
    const referenced = /\bStatusPill\b/.test(src);
    const imported = importsLocalBinding(src, 'StatusPill', STUDENT_CARD);
    expect(referenced && !imported).toBe(false);
  });

  it('监考墙卡片栅格', () => {
    const wall = studentWallGrid(readSource(PAGE));
    const parts = classTokens(wall);
    expect(missingTokens(wall, WALL_GRID), wall).toEqual([]);
    const forbidden = WALL_GRID_FORBIDDEN.filter((token) => parts.includes(token));
    expect(forbidden, wall).toEqual([]);
  });

  it('删除本文件挂的 ToastProvider', () => {
    const src = readSource(PAGE);
    expect(src.includes('ToastProvider')).toBe(false);
  });
});
