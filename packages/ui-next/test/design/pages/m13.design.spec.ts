// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/problem-manage.tsx',
  'src/components/problem-testdata-file-dialog.tsx',
  'src/components/uploader.tsx',
  'src/components/problem-rejudge-dialog.tsx',
] as const;

const MANAGE = 'src/pages/problem-manage.tsx';
const TESTDATA_DIALOG = 'src/components/problem-testdata-file-dialog.tsx';
const UPLOADER = 'src/components/uploader.tsx';
const REJUDGE = 'src/components/problem-rejudge-dialog.tsx';

/** 拼出源码里的 ${...}，避免被 no-template-curly-in-string 当成模板表达式。 */
function expr(body: string): string {
  return ['$', '{', body, '}'].join('');
}

/** PLAN M13：删除自挂的 ToastProvider 后，成功提示仍是这一句。 */
const TOAST_SUCCESS = [
  'toast.success(rejudged ? `已提交 ',
  expr('rejudged'),
  " 条记录重新评测` : '没有符合整题重测条件的记录');",
].join('');

const DELETE_SUBMIT = [
  'guardedSubmit(event, `删除 ',
  expr('selected.size'),
  " 个文件`, 'files-delete')",
].join('');

const RENAME_SUBMIT = [
  'guardedSubmit(event, `重命名 ',
  expr('renameKeys.length'),
  " 个文件`, 'files-rename')",
].join('');

const UPLOAD_CONFIRM = [
  'await dataGuard.confirm(`上传',
  expr("type === 'testdata' ? '测试数据' : '附加文件'"),
  "`, 'files-upload')",
].join('');

const FILES_ENDPOINT_ATTR = ['endpoint={`', expr('problemUrl'), '/files`}'].join('');

const DOWNLOAD_URL = [
  '`',
  expr('problemUrl'),
  '/file/',
  expr('encodeURIComponent(filename)'),
  '?type=testdata`',
].join('');

const PREVIEW_URL = ['`', expr('downloadUrl'), '&noDisposition=1`'].join('');

const SAVE_ENDPOINT = ['`', expr('problemUrl'), '/files`'].join('');

const DIALOG_UI = 'src/components/ui/dialog.tsx';
const IDE = 'src/components/krypton-ide.tsx';

const NOT_DEFINITE_HEIGHT = new Set(['h-0', 'h-auto', 'h-full', 'h-fit', 'h-min', 'h-max', 'h-px']);

interface OpenTag {
  name: string;
  text: string;
}

/** `sm:` 及以上的 min-width 变体在小于 sm 的视口上不是高度。`h-full` 也不算，百分比父高未定。 */
function splitVariants(token: string): { variants: string[]; root: string } {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of token) {
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  const rawRoot = parts.pop() ?? '';
  const bare = (part: string) => part.replace(/^!/, '').replace(/!$/, '');
  return {
    variants: parts.map(bare).filter((part) => part.length > 0),
    root: bare(rawRoot),
  };
}

function isMaxWidthVariant(variant: string): boolean {
  return /^max-(?:sm|md|lg|xl|2xl|3xl)$/.test(variant) || variant.startsWith('max-[');
}

/** 静止布局、且视口小于 sm 时仍生效。 */
function appliesOnNarrowRest(token: string): boolean {
  return splitVariants(token).variants.every(isMaxWidthVariant);
}

function isDefiniteHeightRoot(root: string): boolean {
  if (root === 'h-screen' || root === 'h-svh' || root === 'h-dvh' || root === 'h-lvh') {
    return true;
  }
  if (NOT_DEFINITE_HEIGHT.has(root)) {
    return false;
  }
  if (root.startsWith('h-[')) {
    const inner = root.slice(3, -1);
    if (!/(?:dvh|svh|lvh|vh|vw|px|rem|em|ch)\b/.test(inner)) {
      return false;
    }
    return !/^0(?:px|rem|em|vh|dvh|svh|lvh)?$/.test(inner);
  }
  return /^h-\d+(?:\.\d+)?$/.test(root);
}

function isNarrowDefiniteHeight(token: string): boolean {
  const { variants, root } = splitVariants(token);
  return variants.every(isMaxWidthVariant) && isDefiniteHeightRoot(root);
}

function isNarrowFlexGrow(token: string): boolean {
  if (!appliesOnNarrowRest(token)) {
    return false;
  }
  const root = splitVariants(token).root;
  return root === 'flex-1' || root === 'grow' || root.startsWith('grow-');
}

function isNarrowFullHeight(token: string): boolean {
  return appliesOnNarrowRest(token) && splitVariants(token).root === 'h-full';
}

function skipString(source: string, index: number): number {
  const quote = source[index] ?? '';
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return index;
  }
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (quote === '`' && source[cursor] === '$' && source[cursor + 1] === '{') {
      let depth = 1;
      cursor += 2;
      for (; cursor < source.length && depth > 0; cursor += 1) {
        if (source[cursor] === '{') {
          depth += 1;
        } else if (source[cursor] === '}') {
          depth -= 1;
        }
      }
      cursor -= 1;
      continue;
    }
    if (source[cursor] === quote) {
      return cursor;
    }
  }
  return source.length - 1;
}

function findTagEnd(source: string, start: number): number {
  let depth = 0;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === '>' && depth === 0) {
      return cursor;
    }
  }
  return -1;
}

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      continue;
    }
    const end = skipString(source, cursor);
    values.push(source.slice(cursor + 1, end));
    cursor = end;
  }
  return values;
}

function splitTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function attributeExpression(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(tag);
  if (match?.index === undefined) {
    return null;
  }
  const start = match.index + match[0].length;
  const char = tag[start];
  if (char === '"' || char === "'") {
    const end = tag.indexOf(char, start + 1);
    return end < 0 ? null : tag.slice(start + 1, end);
  }
  if (char !== '{') {
    return null;
  }
  let depth = 0;
  for (let cursor = start; cursor < tag.length; cursor += 1) {
    const next = tag[cursor];
    if (next === '"' || next === "'" || next === '`') {
      cursor = skipString(tag, cursor);
      continue;
    }
    if (next === '{') {
      depth += 1;
    } else if (next === '}') {
      depth -= 1;
      if (depth === 0) {
        return tag.slice(start, cursor + 1);
      }
    }
  }
  return null;
}

function classTokensFromTag(tag: string): string[] {
  const expression = attributeExpression(tag, 'className');
  if (expression === null) {
    return [];
  }
  if (expression.startsWith('{')) {
    return stringLiterals(expression).flatMap(splitTokens);
  }
  return splitTokens(expression);
}

function literalAttr(tag: string, name: string): string | null {
  const expression = attributeExpression(tag, name);
  if (expression === null) {
    return null;
  }
  if (!expression.startsWith('{')) {
    return expression;
  }
  const literals = stringLiterals(expression);
  return literals.length === 1 ? literals[0] ?? null : null;
}

function functionSource(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\n(?:export )?function /);
  return next < 0 ? source.slice(start) : source.slice(start, start + marker.length + next);
}

function readCall(source: string, openIndex: number): string {
  let depth = 0;
  for (let cursor = openIndex; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, cursor + 1);
      }
    }
  }
  return '';
}

function cnCallContaining(fnSource: string, needle: string): string {
  let from = 0;
  while (from < fnSource.length) {
    const at = fnSource.indexOf('cn(', from);
    if (at < 0) {
      return '';
    }
    const call = readCall(fnSource, at + 2);
    if (call.includes(needle)) {
      return call;
    }
    from = at + 3;
  }
  return '';
}

function firstCnTokens(dialogSource: string, name: string): string[] {
  const call = cnCallContaining(functionSource(dialogSource, name), 'className');
  if (call === '') {
    throw new Error(`${name} 没有 cn() 类名`);
  }
  return stringLiterals(call).flatMap(splitTokens);
}

function constBlock(source: string, name: string): string {
  const marker = `const ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const open = source.indexOf('{', start);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, cursor + 1);
      }
    }
  }
  return '';
}

function sizeClassTokens(dialogSource: string, size: string): string[] {
  const block = constBlock(dialogSource, 'SIZE_CLASS');
  const match = new RegExp(`\\b${size}\\s*:\\s*(['"])([\\s\\S]*?)\\1`).exec(block);
  const value = match?.[2];
  if (value === undefined) {
    throw new Error(`SIZE_CLASS.${size} 缺失`);
  }
  return splitTokens(value);
}

function dialogContentTokens(tag: string, dialogSource: string): string[] {
  const call = cnCallContaining(functionSource(dialogSource, 'DialogContent'), 'SIZE_CLASS');
  if (call === '') {
    throw new Error('DialogContent 没有 SIZE_CLASS 类名');
  }
  const size = literalAttr(tag, 'size');
  if (size === null) {
    throw new Error('预览 DialogContent 的 size 不是字面量');
  }
  return [...stringLiterals(call).flatMap(splitTokens), ...sizeClassTokens(dialogSource, size), ...classTokensFromTag(tag)];
}

function composedTokens(node: OpenTag, dialogSource: string): string[] {
  if (node.name === 'DialogContent') {
    return dialogContentTokens(node.text, dialogSource);
  }
  if (node.name === 'DialogHeader' || node.name === 'DialogBody' || node.name === 'DialogFooter') {
    return [...firstCnTokens(dialogSource, node.name), ...classTokensFromTag(node.text)];
  }
  return classTokensFromTag(node.text);
}

function nodeHasDefiniteHeight(tokens: readonly string[], parentDefinite: boolean): boolean {
  if (tokens.some(isNarrowDefiniteHeight)) {
    return true;
  }
  if (!parentDefinite) {
    return false;
  }
  return tokens.some((token) => isNarrowFlexGrow(token) || isNarrowFullHeight(token));
}

function sliceReturn(source: string): string {
  const fn = source.indexOf('function ProblemTestdataFileDialog');
  const marker = 'return (';
  let ret = fn < 0 ? -1 : source.indexOf(marker, fn);
  while (ret >= 0) {
    const next = source[ret + marker.length] ?? '';
    if (next === '\n' || next === '\r' || next === '<') {
      break;
    }
    ret = source.indexOf(marker, ret + marker.length);
  }
  if (fn < 0 || ret < 0) {
    throw new Error('预览对话框没有 return');
  }
  let depth = 0;
  for (let cursor = ret + 'return '.length; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(ret, cursor + 1);
      }
    }
  }
  throw new Error('预览对话框 return 没有结束');
}

function previewIde(jsx: string): { ancestors: OpenTag[]; ide: string } {
  const stack: OpenTag[] = [];
  let found: { ancestors: OpenTag[]; ide: string } | null = null;
  for (let cursor = 0; cursor < jsx.length; cursor += 1) {
    const char = jsx[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(jsx, cursor);
      continue;
    }
    if (char !== '<') {
      continue;
    }
    const next = jsx[cursor + 1];
    if (next === '/') {
      const end = findTagEnd(jsx, cursor);
      if (end < 0) {
        break;
      }
      const name = /^<\/\s*([A-Za-z][\w.]*)/.exec(jsx.slice(cursor, end))?.[1];
      if (name) {
        let index = -1;
        for (let slot = stack.length - 1; slot >= 0; slot -= 1) {
          if (stack[slot]?.name === name) {
            index = slot;
            break;
          }
        }
        if (index >= 0) {
          stack.splice(index);
        }
      }
      cursor = end;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      continue;
    }
    const end = findTagEnd(jsx, cursor);
    if (end < 0) {
      break;
    }
    const tag = jsx.slice(cursor, end + 1);
    const name = /^<([A-Za-z][\w.]*)/.exec(tag)?.[1];
    if (!name) {
      cursor = end;
      continue;
    }
    if (name === 'KryptonIDE') {
      found = { ancestors: [...stack], ide: tag };
    }
    if (!/\/\s*>$/.test(tag)) {
      stack.push({ name, text: tag });
    }
    cursor = end;
  }
  if (!found) {
    throw new Error('预览对话框里没有 KryptonIDE');
  }
  return found;
}

function editorMinHeight(ideTag: string, ideSource: string): number {
  if (/minHeight\s*=/.test(ideTag)) {
    const literal = /minHeight=\{\s*(\d+)\s*\}/.exec(ideTag);
    if (!literal?.[1]) {
      throw new Error('预览 KryptonIDE 的 minHeight 不是数字字面量');
    }
    return Number(literal[1]);
  }
  const fallback = /minHeightProp \?\? \(fillsParentHeight \? (\d+) : (\d+)\)/.exec(ideSource);
  if (!fallback?.[1] || !fallback[2]) {
    throw new Error('无法从 KryptonIDE 读到 minHeight 缺省规则');
  }
  return /\bh-full\b/.test(classTokensFromTag(ideTag).join(' ')) ? Number(fallback[1]) : Number(fallback[2]);
}

/** 编辑区是 flex-1，并且把 minHeight 写进自身；父级没有确定高度时 minHeight 0 会把编辑区压成 0。 */
function editorFillsDefiniteParent(ideSource: string): boolean {
  const root = /className=\{cn\(\s*'([^']*flex-col[^']*)'/.exec(ideSource);
  const editor = /ref=\{containerRef\}[\s\S]{0,500}?className="([^"]*)"[\s\S]{0,500}?minHeight:\s*fullscreen \? undefined : minHeight/.exec(ideSource);
  if (!root?.[1] || !editor?.[1]) {
    return false;
  }
  return splitTokens(root[1]).includes('flex-col') && splitTokens(editor[1]).includes('flex-1');
}

function expectLines(file: string, lines: readonly string[]): void {
  const src = readSource(file);
  const missing = lines.filter((line) => !src.includes(line));
  expect(missing).toEqual([]);
}

describe('m13 problem files, solutions, statistics and uploads', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-manage.tsx', () => {
    expectPageStructure(MANAGE, {
      widths: ['wide'],
      workspace: 'allowed',
      minPageHeaders: 3,
    });
  });

  it('重测对话框不挂 ToastProvider，toast.success 文案不变', () => {
    const src = readSource(REJUDGE);
    expect(src.includes('ToastProvider')).toBe(false);
    expect(src.includes(TOAST_SUCCESS)).toBe(true);
  });

  it('testdata 三层写入字段保持原样', () => {
    expectLines(MANAGE, [
      'name="operation" value="delete_files"',
      'name="operation" value="rename_files"',
      'name="operation" value="generate_testdata"',
      DELETE_SUBMIT,
      RENAME_SUBMIT,
      "guardedSubmit(event, '生成测试数据', 'generate-testdata-request')",
      UPLOAD_CONFIRM,
      "marker.name = 'activeContainerConfirmation';",
      'HTMLFormElement.prototype.submit.call(form);',
      FILES_ENDPOINT_ATTR,
      'fieldName="file"',
      'meta={{ type, ...(uploadConfirmationRequestId ? { activeContainerConfirmation: uploadConfirmationRequestId } : {}) }}',
      'uploadConcurrency={1}',
      'await downloadProblemFiles({ pdoc, problemUrl, files: Array.from(selected), type });',
    ]);
    expectLines(TESTDATA_DIALOG, [
      DOWNLOAD_URL,
      PREVIEW_URL,
      "form.append('operation', 'upload_file');",
      "form.append('type', 'testdata');",
      "form.append('filename', filename);",
      "form.append('activeContainerConfirmation', confirmation);",
      "form.append('file', new Blob([content], { type: 'text/plain' }), filename);",
      SAVE_ENDPOINT,
      "method: 'POST',",
      "credentials: 'same-origin',",
    ]);
    expectLines(UPLOADER, [
      "operation: 'upload_file',",
      'filename: f.name,',
      'uppy.setFileMeta(id, {',
      'allowedMetaFields: fileUploaderAllowedMetaFields(meta),',
    ]);
  });

  it('预览对话框在小于 sm 时编辑区高度不为 0', () => {
    const dialogUi = readSource(DIALOG_UI);
    const ideSource = readSource(IDE);
    const preview = previewIde(sliceReturn(readSource(TESTDATA_DIALOG)));
    const contentIndex = preview.ancestors.findIndex((node) => node.name === 'DialogContent');
    if (contentIndex < 0) {
      throw new Error('预览 KryptonIDE 不在 DialogContent 里');
    }
    const chain = preview.ancestors.slice(contentIndex);
    let parentDefinite = false;
    const heightTokens: string[] = [];
    for (const node of chain) {
      const tokens = composedTokens(node, dialogUi);
      for (const token of tokens) {
        const root = splitVariants(token).root;
        if (root.startsWith('h-') || root.startsWith('min-h-') || root.startsWith('max-h-')) {
          heightTokens.push(token);
        }
      }
      parentDefinite = nodeHasDefiniteHeight(tokens, parentDefinite);
    }
    const ideTokens = classTokensFromTag(preview.ide);
    for (const token of ideTokens) {
      const root = splitVariants(token).root;
      if (root.startsWith('h-') || root.startsWith('min-h-') || root.startsWith('max-h-')) {
        heightTokens.push(token);
      }
    }
    const ideDefinite = ideTokens.some(isNarrowDefiniteHeight)
      || (parentDefinite && ideTokens.some(isNarrowFullHeight));
    const minHeight = editorMinHeight(preview.ide, ideSource);
    expect(editorFillsDefiniteParent(ideSource)).toBe(true);
    if (minHeight > 0) {
      return;
    }
    expect(
      ideDefinite,
      `minHeight 为 0，小于 sm 没有确定的 h-（sm:h- 与 max-h- 都不占高）。读到的高度类：${heightTokens.join(' ') || '(无)'}`,
    ).toBe(true);
  });
});
