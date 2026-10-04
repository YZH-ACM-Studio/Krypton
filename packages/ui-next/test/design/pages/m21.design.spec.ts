// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const GROUPS = 'src/pages/userbind/teacher-groups.tsx';
const IMPORTER = 'src/components/userbind/roster-importer.tsx';
const ACTIONS = 'src/components/userbind/roster-admin-actions.tsx';
const LANE_FILES = [GROUPS, IMPORTER, ACTIONS] as const;

// legacy-intents T01–T04 没有这三个源文件的条目。

const HEADER_LABELS = ['行', '学号', '姓名', '状态'] as const;
const SCROLL_MOBILE = /mobile=(?:"scroll"|'scroll'|\{["']scroll["']\})/;
const DANGER_SOFT = /(?<![\w-])bg-danger-soft(?![\w/-])/;
const DANGER_FG = /(?<![\w-])text-danger-fg(?![\w/-])/;
const DANGER_SOFT_OPACITY = /(?<![\w-])bg-danger-soft\/\d+/;
const DANGER_FG_OPACITY = /(?<![\w-])text-danger-fg\/\d+/;
const STATUS_NOT_OK = /status\s*!==\s*['"]ok['"]/;
const STATUS_IS_OK = /status\s*===\s*['"]ok['"]\s*\?/;

interface Span {
  start: number;
  end: number;
}

interface ClassUse {
  tag: string;
  at: number;
  expression: string;
}

function skipNonCode(source: string, index: number): number {
  if (source.startsWith('//', index)) {
    const newline = source.indexOf('\n', index);
    return newline < 0 ? source.length : newline + 1;
  }
  if (source.startsWith('/*', index)) {
    const end = source.indexOf('*/', index + 2);
    return end < 0 ? source.length : end + 2;
  }
  const quote = source[index];
  if (quote === '"' || quote === "'" || quote === '`') return skipString(source, index);
  return index;
}

function skipString(source: string, index: number): number {
  const quote = source[index] ?? '';
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (quote === '`' && source.startsWith('${', cursor)) {
      const end = matchDelim(source, cursor + 1, '{', '}');
      if (end < 0) return source.length;
      cursor = end + 1;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function matchDelim(source: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let index = open; index < source.length;) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    const char = source[index];
    if (char === openCh) depth += 1;
    else if (char === closeCh) {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

function functionSpans(source: string): Span[] {
  const spans: Span[] = [];
  for (const match of source.matchAll(/\bfunction\b/g)) {
    const at = match.index ?? 0;
    const paren = source.indexOf('(', at);
    if (paren < 0) continue;
    const parenEnd = matchDelim(source, paren, '(', ')');
    if (parenEnd < 0) continue;
    const brace = source.indexOf('{', parenEnd);
    if (brace < 0) continue;
    const braceEnd = matchDelim(source, brace, '{', '}');
    if (braceEnd < 0) continue;
    spans.push({ start: at, end: braceEnd + 1 });
  }
  for (const match of source.matchAll(/=>\s*\{/g)) {
    const at = match.index ?? 0;
    const brace = source.indexOf('{', at);
    if (brace < 0) continue;
    const braceEnd = matchDelim(source, brace, '{', '}');
    if (braceEnd < 0) continue;
    spans.push({ start: at, end: braceEnd + 1 });
  }
  return spans;
}

function headerPositions(source: string, label: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(label, from);
    if (at < 0) break;
    const before = source[at - 1] ?? '';
    const after = source[at + label.length] ?? '';
    const opened = before === '>' || before === "'" || before === '"' || before === '`';
    const closed = after === '<' || after === "'" || after === '"' || after === '`';
    if (opened && closed) positions.push(at);
    from = at + label.length;
  }
  return positions;
}

function headerCluster(source: string): Span | null {
  const lists = HEADER_LABELS.map((label) => headerPositions(source, label));
  if (lists.some((list) => list.length === 0)) return null;
  let best: Span | null = null;
  const [lines, ids, names, states] = lists;
  for (const line of lines ?? []) {
    for (const id of ids ?? []) {
      for (const name of names ?? []) {
        for (const state of states ?? []) {
          const start = Math.min(line, id, name, state);
          const end = Math.max(line, id, name, state) + 2;
          if (end - start > 2000) continue;
          if (!best || end - start < best.end - best.start) best = { start, end };
        }
      }
    }
  }
  return best;
}

function previewSource(source: string): string {
  const cluster = headerCluster(source);
  if (!cluster) return '';
  const owners = functionSpans(source).filter((span) => span.start <= cluster.start && cluster.end <= span.end);
  owners.sort((left, right) => right.start - left.start);
  const owner = owners[0];
  if (!owner) return source.slice(Math.max(0, cluster.start - 1500), Math.min(source.length, cluster.end + 2500));
  return source.slice(owner.start, owner.end);
}

function tagNameBefore(source: string, index: number): string {
  const start = source.lastIndexOf('<', index);
  if (start < 0 || source[start + 1] === '/') return '';
  const between = source.slice(start, index);
  if (between.includes('>')) return '';
  return /^<([A-Za-z][\w.]*)/.exec(between)?.[1] ?? '';
}

function readClassExpression(source: string, index: number): { text: string; end: number } | null {
  const quote = source[index] ?? '';
  if (quote === '"' || quote === "'" || quote === '`') {
    const end = skipString(source, index);
    if (end <= index) return null;
    return { text: source.slice(index + 1, end - 1), end };
  }
  if (quote !== '{') return null;
  const end = matchDelim(source, index, '{', '}');
  if (end < 0) return null;
  return { text: source.slice(index + 1, end), end: end + 1 };
}

function classUses(source: string): ClassUse[] {
  const uses: ClassUse[] = [];
  let search = 0;
  while (search < source.length) {
    const at = source.indexOf('className=', search);
    if (at < 0) break;
    const value = readClassExpression(source, at + 'className='.length);
    if (!value) {
      search = at + 'className='.length;
      continue;
    }
    uses.push({ tag: tagNameBefore(source, at), at, expression: value.text });
    search = value.end;
  }
  return uses;
}

function topLevelColon(source: string): number {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let index = 0; index < source.length;) {
    const skipped = skipNonCode(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    const char = source[index];
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === ':' && paren === 0 && brace === 0 && bracket === 0) return index;
    index += 1;
  }
  return -1;
}

function falseBranchHasDangerSoft(expression: string): boolean {
  const match = STATUS_IS_OK.exec(expression);
  if (!match || match.index === undefined) return false;
  const after = expression.slice(match.index + match[0].length);
  const colon = topLevelColon(after);
  if (colon < 0) return false;
  const falseBranch = after.slice(colon + 1);
  return DANGER_SOFT.test(falseBranch) && !DANGER_SOFT_OPACITY.test(falseBranch);
}

interface RowHook {
  kind: 'class' | 'attr';
  name: string;
  value?: string;
}

function nearbyFailure(source: string, index: number): boolean {
  const window = source.slice(Math.max(0, index - 400), index);
  return STATUS_NOT_OK.test(window) || STATUS_IS_OK.test(window);
}

function trDangerVariantInners(expression: string): string[] {
  const inners: string[] = [];
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] !== '[') continue;
    const end = matchDelim(expression, index, '[', ']');
    if (end < 0) break;
    const inner = expression.slice(index + 1, end);
    const after = expression.slice(end + 1);
    if (inner.includes('tr') && /^:bg-danger-soft(?![\w/-])/.test(after)) inners.push(inner);
    index = end;
  }
  return inners;
}

function hooksOf(inner: string): RowHook[] {
  const hooks: RowHook[] = [];
  for (const match of inner.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const name = match[1];
    if (name) hooks.push({ kind: 'class', name });
  }
  for (const match of inner.matchAll(/\[([A-Za-z_:][\w:.-]*)(?:[~|^$*]?=(['"]?)([^'"\]]*)\2)?\]/g)) {
    const name = match[1];
    if (!name) continue;
    const value = match[3];
    hooks.push({
      kind: 'attr',
      name,
      value: value === undefined || value.length === 0 ? undefined : value,
    });
  }
  return hooks;
}

function failureBranches(region: string): string[] {
  const branches: string[] = [];
  for (const match of region.matchAll(/status\s*===\s*['"]ok['"]\s*\?/g)) {
    const after = region.slice((match.index ?? 0) + match[0].length);
    const colon = topLevelColon(after);
    if (colon < 0) continue;
    branches.push(after.slice(colon + 1, colon + 1 + 1200));
  }
  for (const match of region.matchAll(/status\s*!==\s*['"]ok['"]/g)) {
    const at = match.index ?? 0;
    branches.push(region.slice(Math.max(0, at - 250), at + 800));
  }
  return branches;
}

function classTokenLists(expression: string): string[][] {
  const quoted = [...expression.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
  const lists = quoted.map((literal) => literal.split(/\s+/).filter((token) => token.length > 0));
  if (quoted.length === 0) lists.push(expression.split(/\s+/).filter((token) => token.length > 0));
  return lists;
}

function hasClassToken(expression: string, name: string): boolean {
  return classTokenLists(expression).some((tokens) => tokens.includes(name));
}

function failureBranchHasClass(region: string, name: string): boolean {
  return failureBranches(region).some((branch) => (
    classUses(branch).some((use) => hasClassToken(use.expression, name))
  ));
}

function failureBranchHasAttr(region: string, name: string, value: string | undefined): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assigned = new RegExp(String.raw`(?:\b${escaped}\s*=|['"]${escaped}['"]\s*:)`);
  return failureBranches(region).some((branch) => {
    if (!assigned.test(branch)) return false;
    if (value === undefined) return true;
    const withValue = new RegExp(String.raw`['"]?${escaped}['"]?\s*[:=]\s*['"]?${value}(?![\w-])`);
    return withValue.test(branch);
  });
}

function hookApplies(region: string, hook: RowHook): boolean {
  if (hook.kind === 'class') return failureBranchHasClass(region, hook.name);
  return failureBranchHasAttr(region, hook.name, hook.value);
}

function hookLabel(hook: RowHook): string {
  if (hook.kind === 'class') return `class ${hook.name}`;
  if (hook.value === undefined) return hook.name;
  return `${hook.name}=${hook.value}`;
}

function selectorHookProblems(region: string): string[] {
  const problems: string[] = [];
  for (const use of classUses(region)) {
    for (const inner of trDangerVariantInners(use.expression)) {
      const hooks = hooksOf(inner);
      if (hooks.length === 0) {
        problems.push('整行 bg-danger-soft 的选择器没有指向校验失败行');
        continue;
      }
      for (const hook of hooks) {
        if (!hookApplies(region, hook)) {
          problems.push(`选择器要求失败行带有 ${hookLabel(hook)}，但失败分支没有`);
        }
      }
    }
  }
  return problems;
}

function selectorPaintsInvalidRow(region: string, expression: string): boolean {
  const inners = trDangerVariantInners(expression);
  if (inners.length === 0) return false;
  return inners.every((inner) => {
    const hooks = hooksOf(inner);
    return hooks.length > 0 && hooks.every((hook) => hookApplies(region, hook));
  });
}

function paintsFailedRow(source: string, use: ClassUse): boolean {
  if (DANGER_SOFT_OPACITY.test(use.expression) || !DANGER_SOFT.test(use.expression)) return false;
  if (use.tag === 'tr' || use.tag === 'TableRow') {
    return STATUS_NOT_OK.test(use.expression)
      || falseBranchHasDangerSoft(use.expression)
      || nearbyFailure(source, use.at);
  }
  return selectorPaintsInvalidRow(source, use.expression);
}

function isJsxChild(source: string, index: number): boolean {
  const start = source.lastIndexOf('<', index);
  if (start < 0) return false;
  const end = source.indexOf('>', start);
  return end >= 0 && end < index;
}

function ancestorOpenTags(source: string, index: number): string[] {
  const tags: string[] = [];
  let depth = 0;
  let cursor = index;
  while (cursor > 0) {
    const start = source.lastIndexOf('<', cursor - 1);
    if (start < 0) break;
    if (source.startsWith('</', start)) {
      depth += 1;
      cursor = start;
      continue;
    }
    const mark = source[start + 1] ?? '';
    if (mark === '!' || mark === '?') {
      cursor = start;
      continue;
    }
    const end = source.indexOf('>', start);
    if (end < 0) break;
    const tag = source.slice(start, end + 1);
    if (tag.endsWith('/>')) {
      cursor = start;
      continue;
    }
    if (depth === 0) tags.push(tag);
    else depth -= 1;
    cursor = start;
  }
  return tags;
}

function previewProblems(region: string): string[] {
  const problems: string[] = [];
  if (!failedRowUsesDangerSoft(region)) {
    problems.push('校验失败的整行要用 bg-danger-soft，不能改用 /60 这类透明度');
  }
  const reasons = [...region.matchAll(/\{(?:[A-Za-z_$][\w$]*\.)?reason\}/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0 && isJsxChild(region, index));
  if (reasons.length === 0) problems.push('预览表没有渲染校验失败的错误说明');
  for (const index of reasons) {
    const tags = ancestorOpenTags(region, index);
    const painted = tags.some((tag) => DANGER_FG.test(tag) && !DANGER_FG_OPACITY.test(tag));
    if (!painted) problems.push('错误说明文字要用 text-danger-fg，不能改用透明度变体');
  }
  if (DANGER_SOFT_OPACITY.test(region)) problems.push('失败行使用了 bg-danger-soft 的透明度变体');
  if (DANGER_FG_OPACITY.test(region)) problems.push('错误说明使用了 text-danger-fg 的透明度变体');
  problems.push(...selectorHookProblems(region));
  return problems;
}

function failedRowUsesDangerSoft(region: string): boolean {
  return classUses(region).some((use) => paintsFailedRow(region, use));
}

describe('m21 teacher user groups and roster import', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 teacher-groups.tsx', () => {
    expectPageStructure(GROUPS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('导入预览表用 DataTable mobile="scroll"', () => {
    const region = previewSource(readSource(IMPORTER));
    expect(region.length, '找不到列头为行、学号、姓名、状态的导入预览表').toBeGreaterThan(0);
    const scrolled = findOpenTags(region, 'DataTable').filter((tag) => SCROLL_MOBILE.test(tag.text));
    expect(scrolled.length, '导入预览表要用 DataTable mobile="scroll"').toBeGreaterThan(0);
  });

  it('校验失败的行整行用 bg-danger-soft，错误说明用 text-danger-fg', () => {
    const region = previewSource(readSource(IMPORTER));
    expect(region.length, '找不到列头为行、学号、姓名、状态的导入预览表').toBeGreaterThan(0);
    expect(previewProblems(region)).toEqual([]);
  });

  it('整行危险底选择器的钩子必须出现在失败分支，不能只写在选择器字符串里', () => {
    const broken = [
      'function Preview() {',
      '  return (',
      '    <ScrollArea className="[&_tr:has(.invalid)]:bg-danger-soft">',
      '      {status === \'ok\' ? (',
      '        <span>有效</span>',
      '      ) : (',
      '        <span className="text-danger-fg">{row.reason}</span>',
      '      )}',
      '    </ScrollArea>',
      '  );',
      '}',
    ].join('\n');
    expect(selectorHookProblems(broken)).toEqual([
      '选择器要求失败行带有 class invalid，但失败分支没有',
    ]);
  });
});
