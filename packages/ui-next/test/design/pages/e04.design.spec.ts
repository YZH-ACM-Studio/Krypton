// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const FILE = 'src/components/krypton-ide.tsx';

// 结构规格是「组件：只要求门禁零违规」，不写 expectPageStructure。
const HIGHLIGHT_PAIRS: ReadonlyArray<{ label: string; tag: RegExp; color: string }> = [
  { label: '关键字 brand-fg', tag: /\.keyword\b/, color: 'var(--brand-fg)' },
  { label: '字符串 success-fg', tag: /\.string\b/, color: 'var(--success-fg)' },
  { label: '数字 orange-fg', tag: /\.number\b/, color: 'var(--orange-fg)' },
  { label: '函数 info-fg', tag: /\.function\s*\(/, color: 'var(--info-fg)' },
  { label: '类型 violet-fg', tag: /\.typeName\b/, color: 'var(--violet-fg)' },
  { label: '注释 fg-subtle', tag: /\.comment\b/, color: 'var(--fg-subtle)' },
];

const IDENTIFIER_SKIP = new Set([
  'false',
  'function',
  'null',
  'return',
  'this',
  'true',
  'undefined',
]);

function readBalanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return '';
}

function readOpenTag(source: string, start: number): string {
  let depth = 0;
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === '>' && depth === 0) return source.slice(start, index + 1);
  }
  return '';
}

function readExpression(source: string, start: number): string {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) return source.slice(start, index);
  }
  return source.slice(start);
}

function functionBody(source: string, name: string): string {
  const decl = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=\\s*(?:function\\s*)?\\()`);
  const match = decl.exec(source);
  if (match?.index === undefined) return '';
  const parenAt = match.index + match[0].length - 1;
  const params = readBalanced(source, parenAt, '(', ')');
  if (!params) return '';
  const braceAt = source.indexOf('{', parenAt + params.length);
  if (braceAt < 0) return '';
  const block = readBalanced(source, braceAt, '{', '}');
  if (!block) return '';
  return source.slice(match.index, braceAt + block.length);
}

function constExpression(source: string, name: string): string {
  const decl = new RegExp(`(?:^|\\n)(?:export )?const ${name}\\b[^=\\n]*=`);
  const match = decl.exec(source);
  if (match?.index === undefined) return '';
  return readExpression(source, match.index + match[0].length);
}

function rootIdentifiers(expr: string): string[] {
  const stripped = expr.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
  const names: string[] = [];
  for (const match of stripped.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (name && !IDENTIFIER_SKIP.has(name)) names.push(name);
  }
  return names;
}

/** 主题函数本体，加上它直接调用的本文件 helper，避免变量写在旁边的 const 里就对不上。 */
function themeSource(source: string): string {
  const body = functionBody(source, 'kryptonEditorTheme');
  if (!body) return '';
  const seen = new Set<string>(['kryptonEditorTheme']);
  const parts = [body];
  const queue = rootIdentifiers(body);
  while (queue.length > 0 && seen.size < 40) {
    const name = queue.shift() ?? '';
    if (!name || seen.has(name) || name[0] !== name[0]?.toLowerCase()) continue;
    seen.add(name);
    const extra = functionBody(source, name) || constExpression(source, name);
    if (!extra) continue;
    parts.push(extra);
    queue.push(...rootIdentifiers(extra));
  }
  return parts.join('\n');
}

function callArguments(source: string, name: string): string[] {
  const args: string[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(name, from);
    if (at < 0) break;
    const prev = source[at - 1] ?? '';
    const next = source[at + name.length] ?? '';
    const before = source.slice(Math.max(0, at - 16), at);
    const declaration = /function\s+$/.test(before) || /(?:const|let)\s+$/.test(before);
    if (/[\w$]/.test(prev) || next !== '(' || declaration) {
      from = at + name.length;
      continue;
    }
    const call = readBalanced(source, at + name.length, '(', ')');
    if (call) args.push(call.slice(1, -1));
    from = at + name.length + Math.max(call.length, 1);
  }
  return args;
}

function feedsColorMode(source: string, expr: string, depth: number): boolean {
  if (expr.includes('useColorMode')) return true;
  if (depth <= 0) return false;
  return rootIdentifiers(expr).some((name) => {
    const init = constExpression(source, name);
    return init !== '' && feedsColorMode(source, init, depth - 1);
  });
}

function hasClassToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text);
}

function buttonAroundLabel(source: string, label: string): { open: string; inner: string } | null {
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(label, from);
    if (at < 0) return null;
    const start = source.lastIndexOf('<Button', at);
    if (start >= 0) {
      const open = readOpenTag(source, start);
      const close = source.indexOf('</Button>', at);
      if (open && start + open.length <= at && close > at) {
        const inner = source.slice(start + open.length, close);
        if (inner.includes(label)) return { open, inner };
      }
    }
    from = at + label.length;
  }
  return null;
}

/** 编辑器挂载点之前的那次组件 return，也就是主工具条和只读工具条。 */
function toolbarJsx(source: string): string {
  const mount = source.indexOf('ref={containerRef}');
  if (mount < 0) return '';
  const start = source.lastIndexOf('\n  return (', mount);
  if (start < 0) return '';
  return source.slice(start, mount);
}

function stripComments(source: string): string {
  let out = '';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      out += char;
      if (char === '\\') {
        out += source[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      out += '\n';
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 1;
      out += ' ';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    out += char;
  }
  return out;
}

function splitCallArguments(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function skipSpace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

function readQuoted(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '\\') {
      value += source[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (char === quote) return { value, end: index + 1 };
    value += char;
  }
  return null;
}

function readStyleKey(source: string, start: number): { key: string; end: number } | null {
  const index = skipSpace(source, start);
  const char = source[index];
  if (char === '"' || char === "'") {
    const quoted = readQuoted(source, index);
    return quoted ? { key: quoted.value, end: quoted.end } : null;
  }
  const match = /^[A-Za-z_][\w-]*/.exec(source.slice(index));
  if (!match?.[0]) return null;
  return { key: match[0], end: index + match[0].length };
}

function skipStyleValue(source: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return index;
      depth -= 1;
    } else if (char === ',' && depth === 0) return index;
  }
  return source.length;
}

interface StyleEntry {
  key: string;
  entries: StyleEntry[];
  value: string | null;
}

function parseStyleObject(source: string, open: number): { end: number; entries: StyleEntry[] } {
  const entries: StyleEntry[] = [];
  let index = open + 1;
  while (index < source.length) {
    index = skipSpace(source, index);
    if (source[index] === '}' || source[index] === undefined) return { end: index + 1, entries };
    if (source[index] === ',') {
      index += 1;
      continue;
    }
    const key = readStyleKey(source, index);
    if (!key) break;
    index = skipSpace(source, key.end);
    if (source[index] !== ':') break;
    index = skipSpace(source, index + 1);
    if (source[index] === '{') {
      const child = parseStyleObject(source, index);
      entries.push({ key: key.key, entries: child.entries, value: null });
      index = child.end;
      continue;
    }
    const quoted = readQuoted(source, index);
    if (quoted) {
      entries.push({ key: key.key, entries: [], value: quoted.value });
      index = quoted.end;
      continue;
    }
    index = skipStyleValue(source, index);
  }
  return { end: index, entries };
}

function isSelectorKey(key: string): boolean {
  return /[[\]&.#:>*\s]/.test(key);
}

function selectorList(key: string, parents: readonly string[]): string[] {
  const parts = key.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parents.length === 0) return parts;
  return parts.flatMap((part) => parents.map((parent) => (part.includes('&') ? part.replaceAll('&', parent) : `${parent} ${part}`)));
}

interface PaintedSelection {
  selector: string;
  score: [number, number, number];
}

function collectSelectionPaint(entries: readonly StyleEntry[], parents: readonly string[], out: PaintedSelection[]): void {
  const nested = entries.filter((entry) => entry.entries.length > 0 && isSelectorKey(entry.key));
  if (parents.length > 0) {
    for (const entry of entries) {
      if (entry.value === null) continue;
      if (entry.key !== 'background' && entry.key !== 'backgroundColor' && entry.key !== 'background-color') continue;
      if (!/(?<![\w-])var\(--selection\)(?![\w-])/.test(entry.value)) continue;
      for (const selector of parents) {
        const score = themeSelectionSpecificity(selector);
        if (score) out.push({ selector, score });
      }
    }
  }
  for (const entry of nested) {
    collectSelectionPaint(entry.entries, selectorList(entry.key, parents), out);
  }
}

/** EditorView.theme 把 `&` 换成一个类；没有 `&` 时再前置这个类。`&light` / `&dark` 在这里会抛错。 */
function themeSelectionSpecificity(selector: string): [number, number, number] | null {
  if (/&\w/.test(selector)) return null;
  const expanded = selector.includes('&') ? selector.replaceAll('&', '.cm-theme') : `.cm-theme ${selector}`;
  if (!/(?<![\w-])\.cm-selectionBackground(?![\w-])/.test(expanded)) return null;
  let elements = 0;
  const withoutPseudos = expanded.replace(/::[A-Za-z_-]+/g, () => {
    elements += 1;
    return ' ';
  });
  const classes = withoutPseudos.match(/\.[A-Za-z_-][\w-]*/g)?.length ?? 0;
  const ids = withoutPseudos.match(/#[A-Za-z_-][\w-]*/g)?.length ?? 0;
  const pseudos = withoutPseudos.match(/:[A-Za-z_-]+/g)?.length ?? 0;
  return [ids, classes + pseudos, elements];
}

function specificityAtLeast(score: readonly [number, number, number], floor: readonly [number, number, number]): boolean {
  for (let index = 0; index < 3; index += 1) {
    const left = score[index] ?? 0;
    const right = floor[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

function styleObjectText(themeInner: string, fileSource: string): string {
  let argument = (splitCallArguments(stripComments(themeInner))[0] ?? '').trim();
  if (!argument.startsWith('{')) {
    const name = /^[A-Za-z_$][\w$]*/.exec(argument)?.[0];
    if (name) argument = constExpression(fileSource, name).trim();
  }
  const open = argument.indexOf('{');
  return open < 0 ? '' : argument.slice(open);
}

/**
 * CodeMirror 基础主题的聚焦选区是
 * `.lightId.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`，
 * 特异度 (0, 5, 0)。主题模块后挂载，相等即可盖住；更低则 token 不会画出来。
 */
function paintedSelections(themeInners: readonly string[], fileSource: string): PaintedSelection[] {
  const painted: PaintedSelection[] = [];
  for (const inner of themeInners) {
    const text = styleObjectText(inner, fileSource);
    if (!text.startsWith('{')) continue;
    const parsed = parseStyleObject(text, 0);
    collectSelectionPaint(parsed.entries, [], painted);
  }
  return painted;
}

interface ThemeProp {
  selector: string;
  key: string;
  value: string;
}

function collectThemeProps(entries: readonly StyleEntry[], parents: readonly string[], out: ThemeProp[]): void {
  const nested = entries.filter((entry) => entry.entries.length > 0 && isSelectorKey(entry.key));
  if (parents.length > 0) {
    for (const entry of entries) {
      if (entry.value === null) continue;
      for (const selector of parents) out.push({ selector, key: entry.key, value: entry.value });
    }
  }
  for (const entry of nested) {
    collectThemeProps(entry.entries, selectorList(entry.key, parents), out);
  }
}

function themeProps(themeInners: readonly string[], fileSource: string): ThemeProp[] {
  const props: ThemeProp[] = [];
  for (const inner of themeInners) {
    const text = styleObjectText(inner, fileSource);
    if (!text.startsWith('{')) continue;
    collectThemeProps(parseStyleObject(text, 0).entries, [], props);
  }
  return props;
}

function isBackgroundKey(key: string): boolean {
  return key === 'background' || key === 'backgroundColor' || key === 'background-color';
}

function selectorHasClass(selector: string, className: string): boolean {
  return new RegExp(`(?<![\\w-])\\.${className}(?![\\w-])`).test(selector);
}

/** `&`、编辑器根、内容层。行号栏和当前行不算编辑器表面。 */
function isEditorSurface(selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed === '&') return true;
  const classes = trimmed.match(/\.[A-Za-z_-][\w-]*/g) ?? [];
  if (classes.length === 0) return false;
  const allowed = new Set(['.cm-editor', '.cm-content', '.cm-scroller']);
  return classes.every((name) => allowed.has(name));
}

function isLineNumberRule(selector: string): boolean {
  return selectorHasClass(selector, 'cm-gutters')
    || selectorHasClass(selector, 'cm-lineNumbers')
    || selectorHasClass(selector, 'cm-gutter')
    || selectorHasClass(selector, 'cm-gutterElement');
}

function isCursorColorKey(key: string): boolean {
  return key === 'color'
    || key === 'caretColor'
    || key === 'caret-color'
    || key === 'borderLeftColor'
    || key === 'border-left-color'
    || key === 'borderLeft'
    || key === 'border-left'
    || key === 'borderColor'
    || key === 'border-color';
}

function themeRoleMatched(
  props: readonly ThemeProp[],
  selectorOk: (selector: string) => boolean,
  keyOk: (key: string) => boolean,
  token: string,
): boolean {
  return props.some((prop) => selectorOk(prop.selector) && keyOk(prop.key) && hasClassToken(prop.value, token));
}

describe('e04 Krypton IDE', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('运行全部自测按钮固定宽度，文案换成倒计时后位置不跳动', () => {
    const button = buttonAroundLabel(readSource(FILE), '运行全部自测');
    expect(button, '运行全部自测 Button').not.toBeNull();
    expect(hasClassToken(button?.open ?? '', 'w-[7.25rem]'), 'w-[7.25rem]').toBe(true);
    expect(hasClassToken(button?.open ?? '', 'shrink-0'), 'shrink-0').toBe(true);
  });

  it('冷却中显示秒数的同一按钮仍保持固定宽度', () => {
    const button = buttonAroundLabel(readSource(FILE), '运行全部自测');
    expect(button?.inner ?? '').toMatch(/pretestCooldown\s*>\s*0/);
    expect(hasClassToken(button?.open ?? '', 'w-[7.25rem]'), 'w-[7.25rem]').toBe(true);
    expect(hasClassToken(button?.open ?? '', 'shrink-0'), 'shrink-0').toBe(true);
  });

  it('删除 oneDark 的导入与使用，依赖仍留在 package.json', () => {
    const src = readSource(FILE);
    expect(src).not.toContain('@codemirror/theme-one-dark');
    expect(src).not.toMatch(/\boneDark\b/);
    expect(readSource('package.json')).toContain('"@codemirror/theme-one-dark"');
  });

  it('kryptonEditorTheme 用 EditorView.theme 读取表面、文字、行号、当前行、选区、光标和匹配括号', () => {
    const src = readSource(FILE);
    const signature = /kryptonEditorTheme\b[\s\S]{0,160}?\(\s*([A-Za-z_$][\w$]*)\s*:\s*boolean\b/.exec(src);
    expect(signature?.[1], 'kryptonEditorTheme(dark: boolean)').toBeTruthy();
    const body = functionBody(src, 'kryptonEditorTheme');
    const inside = body.slice(Math.max(0, body.indexOf('{')));
    const param = signature?.[1] ?? '';
    expect(new RegExp(`(?<![.\\w$])${param}\\b`).test(inside), 'dark 参数传入主题').toBe(true);
    const themes = callArguments(themeSource(src), 'EditorView.theme');
    expect(themes.length, 'EditorView.theme').toBeGreaterThan(0);
    // 变量必须落在对应属性和选择器上。行号 color 与行号栏 background 对调时，两个 token 仍在同一个 theme 参数里。
    const props = themeProps(themes, src);
    const roles: ReadonlyArray<{ label: string; ok: boolean }> = [
      {
        label: '背景 background var(--surface)',
        ok: themeRoleMatched(props, isEditorSurface, isBackgroundKey, 'var(--surface)'),
      },
      {
        label: '文字 color var(--fg)',
        ok: themeRoleMatched(props, isEditorSurface, (key) => key === 'color', 'var(--fg)'),
      },
      {
        label: '行号 color var(--fg-subtle)',
        ok: themeRoleMatched(props, isLineNumberRule, (key) => key === 'color', 'var(--fg-subtle)'),
      },
      {
        label: '行号栏 background var(--surface-sunken)',
        ok: themeRoleMatched(props, isLineNumberRule, isBackgroundKey, 'var(--surface-sunken)'),
      },
      {
        label: '当前行 background var(--surface-hover)',
        ok: themeRoleMatched(
          props,
          (selector) => selectorHasClass(selector, 'cm-activeLine') || selectorHasClass(selector, 'cm-activeLineGutter'),
          isBackgroundKey,
          'var(--surface-hover)',
        ),
      },
      {
        label: '光标 var(--fg)',
        ok: themeRoleMatched(props, (selector) => selectorHasClass(selector, 'cm-cursor'), isCursorColorKey, 'var(--fg)'),
      },
      {
        label: '匹配括号 background var(--brand-soft)',
        ok: themeRoleMatched(props, (selector) => selectorHasClass(selector, 'cm-matchingBracket'), isBackgroundKey, 'var(--brand-soft)'),
      },
      {
        label: '折叠占位 background var(--surface-sunken)',
        ok: themeRoleMatched(props, (selector) => selectorHasClass(selector, 'cm-foldPlaceholder'), isBackgroundKey, 'var(--surface-sunken)'),
      },
    ];
    expect(roles.filter((role) => !role.ok).map((role) => role.label)).toEqual([]);
    // 基础主题聚焦选区特异度是 (0, 5, 0)。只在参数字符串里出现 token，或选择器更弱，都盖不住它。
    const painted = paintedSelections(themes, src);
    const strong = painted.filter((item) => specificityAtLeast(item.score, [0, 5, 0]));
    const detail = painted.map((item) => `${item.selector} (${item.score.join(',')})`).join('; ');
    expect(strong.length, `选区规则必须压过 CodeMirror 基础主题。读到：${detail || '无'}`).toBeGreaterThan(0);
  });

  it('语法高亮用 HighlightStyle.define，颜色对齐 hljs', () => {
    const src = readSource(FILE);
    expect(src).not.toMatch(/syntaxHighlighting\(\s*defaultHighlightStyle\b/);
    const rules = callArguments(themeSource(src), 'HighlightStyle.define').flatMap((arg) => arg.split(/\btag\s*:/).slice(1));
    expect(rules.length, 'HighlightStyle.define').toBeGreaterThan(0);
    const missing = HIGHLIGHT_PAIRS.filter((pair) => !rules.some((rule) => pair.tag.test(rule) && rule.includes(pair.color)));
    expect(missing.map((pair) => pair.label)).toEqual([]);
  });

  it('编辑器主题随 useColorMode 切换', () => {
    const src = readSource(FILE);
    const args = callArguments(src, 'kryptonEditorTheme');
    expect(args.length, '调用 kryptonEditorTheme').toBeGreaterThan(0);
    expect(args.some((arg) => feedsColorMode(src, arg, 4)), '参数来自 useColorMode').toBe(true);
  });

  it('工具条的原生 button 换成 Button，且 size 为 sm', () => {
    const jsx = toolbarJsx(readSource(FILE));
    expect(jsx.length, '工具条 JSX').toBeGreaterThan(0);
    expect(jsx).not.toMatch(/<button[\s>/]/);
    expect(jsx).not.toMatch(/<select[\s>/]/);
    const buttons = findOpenTags(jsx, 'Button');
    expect(buttons.length).toBeGreaterThan(0);
    const missingSize = buttons
      .filter((tag) => !/\bsize=(?:"sm"|'sm'|\{\s*["']sm["']\s*\})/.test(tag.text))
      .map((tag) => tag.line);
    expect(missingSize).toEqual([]);
  });

  it('提交、自测、记录轮询、只读策略和团队快照入口仍在', () => {
    const src = readSource(FILE);
    expect(src).toContain("from '@/lib/readonly-code-policy'");
    expect(src).toContain('READ_ONLY_CODE_EXTENSIONS');
    expect(src).toContain('resolveReadOnlyCodeLanguage');
    expect(src).toMatch(/\bhandleSubmit\b/);
    expect(src).toMatch(/\bhandleRunAll\b/);
    expect(src).toMatch(/\bpollRecord\b/);
    expect(src).toContain('onSendToTeammates');
  });
});
