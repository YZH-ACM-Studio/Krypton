// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/tasks/index.tsx',
  'src/components/task-graph.tsx',
] as const;

const PAGE = 'src/pages/tasks/index.tsx';
const GRAPH = 'src/components/task-graph.tsx';

const GRAPH_TOKENS = ['--surface', '--line', '--success-solid', '--brand-solid'] as const;

// PLAN 用简称。现有文案不改：完成=已完成，未开始=未认领，已过期=认领徽标「已截止」。
const STATUS_TONES = [
  { name: '完成', tone: 'success', label: /(?<!未)完成(?![\u4E00-\u9FFF])/ },
  { name: '进行中', tone: 'info', label: /(?<![\u4E00-\u9FFF])进行中(?![\u4E00-\u9FFF])/ },
  { name: '未开始', tone: 'neutral', label: /(?<![\u4E00-\u9FFF])(?:未开始|未认领)(?![\u4E00-\u9FFF])/ },
  { name: '已过期', tone: 'warning', label: /(?<![\u4E00-\u9FFF])(?:已过期|已截止)(?![\u4E00-\u9FFF])/ },
] as const;

const COLOR_LITERAL = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])|\b(?:rgba?|hsla?|oklch)\(/;

function taskCenterSource(source: string): string {
  const start = source.indexOf('export function TaskCenterPage');
  const end = source.indexOf('export function TaskMyPage');
  if (start < 0 || end <= start) return '';
  return source.slice(start, end);
}

function badgeBlocks(source: string): string[] {
  return [...source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
}

function hasTone(block: string, tone: string): boolean {
  return new RegExp(
    `\\btone\\s*=\\s*(?:["']${tone}["']|\\{\\s*["']${tone}["']\\s*\\}|\\{[^}]*["']${tone}["'][^}]*\\})`,
  ).test(block);
}

function colorLiteralsWithoutAllow(source: string): string[] {
  const lines = source.split('\n');
  const problems: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!COLOR_LITERAL.test(line)) continue;
    const previous = lines[index - 1] ?? '';
    if (line.includes('ds-allow DS003') || previous.includes('ds-allow DS003')) continue;
    problems.push(`第 ${index + 1} 行回退色缺少 ds-allow DS003`);
  }
  return problems;
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const paren = source.indexOf('(', start);
  if (paren < 0) return '';
  let depth = 0;
  let paramsEnd = -1;
  for (let index = paren; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  if (paramsEnd < 0) return '';
  const open = source.indexOf('{', paramsEnd);
  if (open < 0) return '';
  depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return '';
}

function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '');
}

function tokenBindingNames(source: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  const add = (token: string, name: string) => {
    const list = names.get(token) ?? [];
    if (!list.includes(name)) list.push(name);
    names.set(token, list);
  };
  const patterns = [
    /([A-Za-z_$][\w$]*)\s*:\s*readToken\(\s*['"](--[A-Za-z0-9-]+)['"]/g,
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*readToken\(\s*['"](--[A-Za-z0-9-]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      add(match[2] ?? '', match[1] ?? '');
    }
  }
  return names;
}

function mentionsName(expression: string, name: string): boolean {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(expression);
}

function referencesToken(expression: string, token: string, names: readonly string[]): boolean {
  if (expression.includes(`'${token}'`) || expression.includes(`"${token}"`)) return true;
  return names.some((name) => mentionsName(expression, name));
}

function assignmentOf(scope: string, name: string): string | null {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:const|let)\\s+${escaped}\\s*=\\s*([\\s\\S]*?);`).exec(scope);
  return match?.[1] ?? null;
}

function unwrapExpression(scope: string, expression: string): string {
  let current = expression.trim();
  const seen = new Set<string>();
  for (let depth = 0; depth < 4; depth += 1) {
    if (!/^[A-Za-z_$][\w$]*$/.test(current) || seen.has(current)) return current;
    seen.add(current);
    const assigned = assignmentOf(scope, current);
    if (assigned === null) return current;
    current = assigned.trim();
  }
  return current;
}

function styleExpression(styleBody: string, scope: string, key: string): string | null {
  const explicit = new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*([^,}\\n]+)`).exec(styleBody);
  if (explicit?.[1]) return unwrapExpression(scope, explicit[1]);
  if (!new RegExp(`(?:^|[,{])\\s*${key}\\s*(?:,|}|$)`).test(styleBody)) return null;
  const assigned = assignmentOf(scope, key);
  return assigned === null ? null : unwrapExpression(scope, assigned);
}

function tokenWiringProblems(source: string): string[] {
  const problems: string[] = [];
  const names = tokenBindingNames(source);
  const node = withoutComments(functionBody(source, 'TaskGraphNodeComponent'));
  const edge = withoutComments(functionBody(source, 'buildEdgeStyle'));
  if (node === '') problems.push('缺少 TaskGraphNodeComponent');
  if (edge === '') problems.push('缺少 buildEdgeStyle');
  const style = /style=\{\{([\s\S]*?)\}\}/.exec(node);
  const background = style ? styleExpression(style[1] ?? '', node, 'background') : null;
  const border = style ? styleExpression(style[1] ?? '', node, 'borderColor') : null;
  const painted = `${background ?? ''}\n${border ?? ''}`;
  if (background === null || !referencesToken(background, '--surface', names.get('--surface') ?? [])) {
    problems.push('节点底 background 没有接 readToken(--surface) 的返回值');
  }
  if (border === null || !referencesToken(border, '--line', names.get('--line') ?? [])) {
    problems.push('节点边框 borderColor 没有接 readToken(--line) 的返回值');
  }
  if (!referencesToken(painted, '--success-solid', names.get('--success-solid') ?? [])) {
    problems.push('完成色没有接到节点 style');
  }
  if (!referencesToken(painted, '--brand-solid', names.get('--brand-solid') ?? [])) {
    problems.push('当前色没有接到节点 style');
  }
  const strokes = [...edge.matchAll(/\bstroke\s*:\s*([^,}\n]+)/g)].map((match) => (match[1] ?? '').trim());
  if (strokes.length === 0) problems.push('buildEdgeStyle 的 stroke 没有接 readToken 的返回值');
  const joined = strokes.join('\n');
  for (const token of ['--line', '--success-solid', '--brand-solid'] as const) {
    if (!referencesToken(joined, token, names.get(token) ?? [])) {
      problems.push(`连线 stroke 没有接 readToken('${token}') 的返回值`);
    }
  }
  for (const stroke of strokes) {
    const bound = GRAPH_TOKENS.some((token) => referencesToken(stroke, token, names.get(token) ?? []));
    if (!bound) problems.push(`连线 stroke 不是 token 返回值：${stroke}`);
  }
  return problems;
}

describe('s16 task center and task graph', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 tasks/index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 3,
    });
  });

  it('公开任务网格不含 auto-rows-fr', () => {
    const center = taskCenterSource(readSource(PAGE));
    expect(center.length).toBeGreaterThan(0);
    expect(center).not.toContain('auto-rows-fr');
  });

  it('公开任务卡不含 invisible 简介占位', () => {
    const center = taskCenterSource(readSource(PAGE));
    expect(center.length).toBeGreaterThan(0);
    expect(center).not.toContain('invisible');
    expect(center).not.toContain("!task.description && 'invisible'");
  });

  it('公开任务卡带 h-full transition-[box-shadow,opacity]', () => {
    const center = taskCenterSource(readSource(PAGE));
    expect(center.length).toBeGreaterThan(0);
    expect(center).toContain('h-full transition-[box-shadow,opacity]');
  });

  it('公开任务卡 CardContent 带 flex h-full flex-col', () => {
    const center = taskCenterSource(readSource(PAGE));
    expect(center.length).toBeGreaterThan(0);
    expect(center).toMatch(/<CardContent\b[^>]+flex h-full flex-col/);
  });

  it('公开任务卡主操作带 mt-auto pt-1', () => {
    const center = taskCenterSource(readSource(PAGE));
    expect(center.length).toBeGreaterThan(0);
    expect(center).toMatch(/className="[^"]*mt-auto pt-1[^"]*"[\s\S]*?<Button\b/);
  });

  it('删除 StatusPill，状态改用 Badge tone', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bStatusPill\b/);
    const blocks = badgeBlocks(src);
    for (const status of STATUS_TONES) {
      const matched = blocks.filter((block) => status.label.test(block));
      expect(matched.length, status.name).toBeGreaterThan(0);
      for (const block of matched) {
        expect(hasTone(block, status.tone), `${status.name} → ${status.tone}`).toBe(true);
      }
    }
  });

  it('任务图节点和连线改读颜色 token', () => {
    const src = readSource(GRAPH);
    const problems: string[] = [];
    if (!/import\s*\{[^}]*\breadToken\b[^}]*\}\s*from\s*['"]@\/lib\/read-token['"]/.test(src)) {
      problems.push('未从 @/lib/read-token 导入 readToken');
    }
    for (const token of GRAPH_TOKENS) {
      if (!new RegExp(`readToken\\(\\s*['"]${token}['"]`).test(src)) {
        problems.push(`缺少 readToken('${token}')`);
      }
    }
    problems.push(...colorLiteralsWithoutAllow(src));
    problems.push(...tokenWiringProblems(src));
    expect(problems).toEqual([]);
  });

  it('只调用 readToken 而没有接到节点和连线时不算改读 token', () => {
    const detached = [
      "import { readToken } from '@/lib/read-token';",
      'function graphColors() {',
      '  return {',
      "    surface: readToken('--surface', '#ffffff'),",
      "    line: readToken('--line', '#94a3b8'),",
      "    success: readToken('--success-solid', '#10b981'),",
      "    brand: readToken('--brand-solid', '#6366f1'),",
      '  };',
      '}',
      'function TaskGraphNodeComponent() {',
      '  graphColors();',
      '  return <div style={{}} />;',
      '}',
      'function buildEdgeStyle() {',
      '  return { strokeWidth: 2 };',
      '}',
    ].join('\n');
    const problems = tokenWiringProblems(detached);
    expect(problems.some((item) => item.includes('background'))).toBe(true);
    expect(problems.some((item) => item.includes('borderColor'))).toBe(true);
    expect(problems.some((item) => item.includes('stroke'))).toBe(true);
  });
});
