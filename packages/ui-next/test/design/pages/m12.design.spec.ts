// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const EDITOR = 'src/pages/problem-config-editor.tsx';
const WRAPPER = 'src/pages/problem-config-page-wrapper.tsx';
const LANE_FILES = [EDITOR, WRAPPER] as const;

/** legacy-intents-T02：配置页保存区在窄屏纵向排列，sm 起横向且不被压缩。 */
const SAVE_REGION = ['flex', 'shrink-0', 'flex-col', 'gap-3', 'sm:flex-row'] as const;

/** legacy-intents-T02：保存按钮组可换行，sm 起靠右。 */
const SAVE_ACTIONS = ['flex', 'flex-wrap', 'items-center', 'gap-2', 'sm:ml-auto'] as const;

const TITLE_TOKENS = ['truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
const STAT_LABELS = ['输入', '输出', '其他'] as const;

function classListHas(value: string, tokens: readonly string[]): boolean {
  const parts = value.split(/\s+/).filter((part) => part.length > 0);
  return tokens.every((token) => parts.includes(token));
}

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  let quote = '';
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote.length > 0) {
      if (char === '\\' && quote !== "'") {
        index += 1;
        continue;
      }
      if (char === quote) {
        values.push(source.slice(start, index));
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      start = index + 1;
    }
  }
  return values;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote.length > 0) {
      if (char === '\\' && quote !== "'") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function classNameValues(source: string): string[] {
  const values: string[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('className', from);
    if (at < 0) {
      break;
    }
    const equals = /^\s*=\s*/.exec(source.slice(at + 'className'.length));
    if (equals === null) {
      from = at + 'className'.length;
      continue;
    }
    const valueStart = at + 'className'.length + equals[0].length;
    const quote = source[valueStart] ?? '';
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, valueStart + 1);
      if (end < 0) {
        break;
      }
      values.push(source.slice(valueStart + 1, end));
      from = end + 1;
      continue;
    }
    if (quote === '{') {
      const end = matchingBrace(source, valueStart);
      if (end < 0) {
        break;
      }
      values.push(...stringLiterals(source.slice(valueStart + 1, end)));
      from = end + 1;
      continue;
    }
    from = valueStart + 1;
  }
  return values;
}

function hasJoinedClasses(source: string, tokens: readonly string[]): boolean {
  return classNameValues(source).some((value) => classListHas(value, tokens));
}

function importsBinding(source: string, binding: string, specifier: string): boolean {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] !== specifier) {
      continue;
    }
    const names = (match[1] ?? '').split(',').map((part) => {
      const cleaned = part.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
      return cleaned.split(/\s+as\s+/)[0]?.trim() ?? '';
    });
    if (names.includes(binding)) {
      return true;
    }
  }
  return false;
}

function editorBody(source: string): string {
  const marker = 'export function ProblemConfigEditor';
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\nfunction [A-Za-z]/);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function firstReturnedJsxTag(body: string): string {
  const match = /return\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*<([A-Za-z][\w.]*)/.exec(body);
  return match?.[1] ?? '';
}

function toolbarBlock(source: string, openText: string): string {
  const at = source.indexOf(openText);
  if (at < 0) {
    return '';
  }
  const close = source.indexOf('</Toolbar>', at + openText.length);
  return close < 0 ? '' : source.slice(at, close);
}

function statHasLabel(tag: string, label: string): boolean {
  return tag.includes(`label="${label}"`)
    || tag.includes(`label={'${label}'}`)
    || tag.includes(`label={"${label}"}`);
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote.length > 0) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** 只认测试点列表映射出的卡片，不把 BasicConfigStrip 等处的 Panel 算进来。 */
function subtaskCardTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/(?<![\w.])subtasks\.map\s*\(/g)) {
    const open = source.indexOf('(', match.index ?? 0);
    const close = matchingParen(source, open);
    if (close < 0) {
      continue;
    }
    const tag = /<([A-Z][A-Za-z0-9]*)\b/.exec(source.slice(open + 1, close));
    if (tag?.[1] !== undefined) {
      tags.push(tag[1]);
    }
  }
  return tags;
}

function subtaskCardUsesPanel(source: string, tag: string): boolean {
  if (tag === 'Panel') {
    return true;
  }
  return findOpenTags(functionBody(source, tag), 'Panel').length > 0;
}

const DRAG_HANDLE_TITLES = ['拖动以分配', '拖动用例'] as const;

function callText(source: string, name: string): string {
  const at = source.indexOf(`${name}(`);
  if (at < 0) {
    return '';
  }
  const close = matchingParen(source, at + name.length);
  return close < 0 ? '' : source.slice(at, close + 1);
}

function dragHandleTags(source: string, title: string): { name: string; text: string }[] {
  const found: { name: string; text: string }[] = [];
  for (const name of ['button', 'Button', 'span', 'div']) {
    for (const tag of findOpenTags(source, name)) {
      const named = tag.text.includes(`title="${title}"`)
        || tag.text.includes(`aria-label="${title}"`)
        || tag.text.includes(`aria-label={'${title}'}`)
        || tag.text.includes(`aria-label={"${title}"}`);
      if (named) {
        found.push({ name, text: tag.text });
      }
    }
  }
  return found;
}

function hasDragHandleName(text: string, title: string): boolean {
  return text.includes(`aria-label="${title}"`)
    || text.includes(`aria-label={'${title}'}`)
    || text.includes(`aria-label={"${title}"}`);
}

/** 拖动手柄必须是按钮，或同时写明 role、tabIndex=0，并且把键盘事件交给 listeners。 */
function isKeyboardDragHandle(name: string, text: string): boolean {
  const button = name === 'button' || name === 'Button';
  const role = /role=(?:"button"|'button'|\{["']button["']\})/.test(text);
  const tab = /tabIndex=(?:\{0\}|"0"|'0')/.test(text);
  const keys = text.includes('onKeyDown') || text.includes('...listeners');
  return (button || (role && tab)) && keys;
}

describe('m12 problem config editor', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-config-editor.tsx', () => {
    expectPageStructure(EDITOR, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('工作区根元素是 Workspace', () => {
    const body = editorBody(readSource(EDITOR));
    expect(body.length).toBeGreaterThan(0);
    expect(firstReturnedJsxTag(body)).toBe('Workspace');
  });

  it('保存区在窄屏纵向排列，sm 起改为横向且不被压缩', () => {
    expect(hasJoinedClasses(readSource(EDITOR), SAVE_REGION)).toBe(true);
  });

  it('保存按钮组可换行，sm 起靠右', () => {
    expect(hasJoinedClasses(readSource(EDITOR), SAVE_ACTIONS)).toBe(true);
  });

  it('删除 calc(100dvh…) 与 100vh', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/calc\(100dvh/);
    expect(src).not.toMatch(/100vh/);
    expect(src).not.toMatch(/100dvh/);
  });

  it('局部 Stat 改为 display 的 Stat', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/\bfunction Stat\s*\(/);
    expect(src).not.toMatch(/\bconst Stat\b/);
    expect(importsBinding(src, 'Stat', '@/components/ui/display')).toBe(true);
    const stats = findOpenTags(src, 'Stat');
    for (const label of STAT_LABELS) {
      expect(stats.some((tag) => statHasLabel(tag.text, label))).toBe(true);
    }
  });

  it('局部 SubtaskCard 改为 Panel', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/\bfunction SubtaskCard\s*\(/);
    expect(src).not.toMatch(/<SubtaskCard\b/);
    expect(importsBinding(src, 'Panel', '@/components/ui/panel')).toBe(true);
    const tags = subtaskCardTags(src);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(subtaskCardUsesPanel(src, tag), `${tag} 必须用 Panel 画测试点卡片`).toBe(true);
    }
  });

  it('原 h1 改为 Toolbar 最左侧的标题 span', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/<h1(?=[\s>])/);
    const toolbars = findOpenTags(src, 'Toolbar');
    expect(toolbars.length).toBeGreaterThan(0);
    const bar = toolbars
      .map((tag) => toolbarBlock(src, tag.text))
      .find((text) => text.includes('评测配置')) ?? '';
    expect(bar.length).toBeGreaterThan(0);
    const open = findOpenTags(bar, 'Toolbar')[0];
    expect(open).toBeDefined();
    const children = bar.slice(open?.text.length ?? 0).trimStart();
    expect(children.startsWith('<span')).toBe(true);
    const title = findOpenTags(children, 'span')[0];
    expect(title).toBeDefined();
    expect(hasJoinedClasses(title?.text ?? '', TITLE_TOKENS)).toBe(true);
    const spanClose = children.indexOf('</span>');
    expect(spanClose).toBeGreaterThan(0);
    expect(children.slice(0, spanClose)).toContain('评测配置');
  });

  it('文件池和用例行的拖动手柄可用键盘拖动', () => {
    const src = readSource(EDITOR);
    const problems: string[] = [];
    const sensors = callText(src, 'useSensors');
    if (!/useSensor\(\s*PointerSensor\b/.test(sensors)) {
      problems.push('useSensors 缺少 PointerSensor');
    }
    if (!/useSensor\(\s*KeyboardSensor\b/.test(sensors)) {
      problems.push('useSensors 未注册 KeyboardSensor，只剩 PointerSensor 时键盘拖拽不会开始');
    }
    for (const title of DRAG_HANDLE_TITLES) {
      const tags = dragHandleTags(src, title);
      if (tags.length === 0) {
        problems.push(`找不到「${title}」拖动手柄`);
        continue;
      }
      for (const tag of tags) {
        if (!isKeyboardDragHandle(tag.name, tag.text)) {
          problems.push(`「${title}」是 <${tag.name}>，不能键盘聚焦后拖动`);
        }
        if (!hasDragHandleName(tag.text, title)) {
          problems.push(`「${title}」是纯图标手柄，缺少 aria-label`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
