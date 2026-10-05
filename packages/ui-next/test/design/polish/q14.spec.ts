// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/mindmap/admin.tsx';

/** 工具栏收进「更多」的两个动作。菜单项与 xl 按钮各保留一份同一动作。 */
const COLLAPSED_ACTIONS = ['导图设置', '查看公开页'] as const;

const REMOVED_TOOLBAR_CLASSES = ['scrollbar-none', 'overflow-x-auto', 'overflow-y-hidden'] as const;

type Quote = '"' | "'" | '`';

function isQuote(char: string | undefined): char is Quote {
  return char === '"' || char === "'" || char === '`';
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function matchBrace(source: string, openIndex: number): number {
  if (source[openIndex] !== '{') return -1;
  let depth = 0;
  let quote: Quote | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (quote === '`' && char === '$' && source[index + 1] === '{') {
        const nested = matchBrace(source, index + 1);
        if (nested < 0) return -1;
        index = nested;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (isQuote(char)) {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function classTokens(source: string): string[] {
  return quotedStrings(source).flatMap((value) => value.split(/\s+/).filter((token) => token.length > 0));
}

function toolbarBlock(source: string): string {
  let from = 0;
  for (const open of findOpenTags(source, 'Toolbar')) {
    const start = source.indexOf(open.text, from);
    if (start < 0) continue;
    const close = source.indexOf('</Toolbar>', start + open.text.length);
    from = start + open.text.length;
    if (close < 0) continue;
    const block = source.slice(start, close + '</Toolbar>'.length);
    if (block.includes('导图管理')) return block;
  }
  return '';
}

function elementBlock(source: string, openText: string, tag: string, from: number): { block: string; next: number } | null {
  const start = source.indexOf(openText, from);
  if (start < 0) return null;
  if (/\/\s*>$/.test(openText)) {
    return { block: openText, next: start + openText.length };
  }
  const closeNeedle = `</${tag}>`;
  const close = source.indexOf(closeNeedle, start + openText.length);
  if (close < 0) return { block: openText, next: start + openText.length };
  return { block: source.slice(start, close + closeNeedle.length), next: start + openText.length };
}

/** Menu 的 trigger/items 写在开标签属性里；DropdownMenu 用子元素。两者都算菜单。 */
function menuBlocks(source: string): string[] {
  const blocks: string[] = [];
  for (const name of ['DropdownMenu', 'Menu'] as const) {
    let from = 0;
    for (const open of findOpenTags(source, name)) {
      const found = elementBlock(source, open.text, name, from);
      if (found === null) continue;
      blocks.push(found.block);
      from = found.next;
    }
  }
  return blocks;
}

function enclosingObject(source: string, index: number): string {
  let depth = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const char = source[cursor];
    if (char === '}') {
      depth += 1;
      continue;
    }
    if (char !== '{') continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    const end = matchBrace(source, cursor);
    return end < 0 ? '' : source.slice(cursor, end + 1);
  }
  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Menu 的 items 用 `label` 字段；DropdownMenu 的菜单项是 DropdownMenuItem / MenuItem。 */
function menuItemSlices(source: string, label: string): string[] {
  const slices: string[] = [];
  const property = new RegExp(String.raw`\blabel\s*:\s*(['"\`])${escapeRegExp(label)}\1`, 'g');
  for (const match of source.matchAll(property)) {
    const object = enclosingObject(source, match.index ?? 0);
    if (object !== '') slices.push(object);
  }
  for (const name of ['DropdownMenuItem', 'MenuItem'] as const) {
    let from = 0;
    for (const open of findOpenTags(source, name)) {
      const found = elementBlock(source, open.text, name, from);
      if (found === null) continue;
      from = found.next;
      if (found.block.includes(label)) slices.push(found.block);
    }
  }
  return slices;
}

function hasStringAttr(tag: string, name: string, value: string): boolean {
  const pattern = new RegExp(String.raw`\b${name}=(?:\{\s*)?(['"\`])${escapeRegExp(value)}\1`);
  return pattern.test(tag);
}

function isIconOnly(tag: string): boolean {
  return /\biconOnly\b/.test(tag) && !/iconOnly=\{\s*false\s*\}/.test(tag);
}

function wideActionButtons(toolbar: string, label: string): string[] {
  const buttons: string[] = [];
  let from = 0;
  for (const open of findOpenTags(toolbar, 'Button')) {
    const found = elementBlock(toolbar, open.text, 'Button', from);
    if (found === null) continue;
    from = found.next;
    const tokens = classTokens(open.text);
    if (!tokens.includes('hidden') || !tokens.includes('xl:inline-flex')) continue;
    if (!found.block.includes(label)) continue;
    buttons.push(found.block);
  }
  return buttons;
}

function moreTriggers(toolbar: string): string[] {
  const triggers: string[] = [];
  for (const menu of menuBlocks(toolbar)) {
    for (const open of findOpenTags(menu, 'Button')) {
      if (!hasStringAttr(open.text, 'aria-label', '更多操作')) continue;
      triggers.push(open.text);
    }
  }
  return triggers;
}

function hrefExpr(source: string): string {
  const braced = /href\s*[=:]\s*\{(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_]\w*(?:\.\w+)*)\}/.exec(source);
  const match = braced ?? /href\s*[=:]\s*(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_]\w*(?:\.\w+)*)/.exec(source);
  return match?.[1]?.replaceAll(/\s+/g, '') ?? '';
}

function handlerName(source: string): string {
  const braced = /(?:onClick|onSelect)\s*[=:]\s*\{([A-Za-z_]\w*)\}/.exec(source);
  if (braced?.[1] !== undefined) return braced[1];
  const bare = /(?:onClick|onSelect)\s*[=:]\s*([A-Za-z_]\w*)/.exec(source);
  return bare?.[1] ?? '';
}

function settingsAction(source: string): string {
  if (source.replaceAll(/\s+/g, '').includes('setSettingsOpen(true)')) return 'setSettingsOpen(true)';
  const called = /=>\s*([A-Za-z_]\w*)\s*\(/.exec(source);
  if (called?.[1] !== undefined) return called[1];
  const name = handlerName(source);
  if (name === '' || name === 'setSettingsOpen') return '';
  return name;
}

function actionExpr(label: string, source: string): string {
  return label === '导图设置' ? settingsAction(source) : hrefExpr(source);
}

describe('q14 mindmap admin toolbar overflow', () => {
  it('源码不含 scrollbar-none、overflow-x-auto、overflow-y-hidden', () => {
    const source = readSource(PAGE);
    const present = REMOVED_TOOLBAR_CLASSES.filter((token) => source.includes(token));
    expect(present).toEqual([]);
  });

  it('「更多操作」是 ghost、sm、iconOnly 的菜单触发器，并且 xl 起隐藏', () => {
    const toolbar = toolbarBlock(readSource(PAGE));
    const problems: string[] = [];
    if (menuBlocks(toolbar).length === 0) {
      problems.push('工具栏没有 Menu 或 DropdownMenu');
    }
    const triggers = moreTriggers(toolbar);
    if (triggers.length !== 1) {
      problems.push(`aria-label「更多操作」的菜单触发按钮有 ${triggers.length} 个，要恰好 1 个`);
    }
    const trigger = triggers[0] ?? '';
    if (trigger !== '' && !hasStringAttr(trigger, 'variant', 'ghost')) problems.push('触发按钮 variant 不是 ghost');
    if (trigger !== '' && !hasStringAttr(trigger, 'size', 'sm')) problems.push('触发按钮 size 不是 sm');
    if (trigger !== '' && !isIconOnly(trigger)) problems.push('触发按钮不是 iconOnly');
    if (trigger !== '' && !classTokens(trigger).includes('xl:hidden')) problems.push('触发按钮缺少 xl:hidden');
    expect(problems).toEqual([]);
  });

  it('导图设置与查看公开页在菜单项和 hidden xl:inline-flex 按钮中各出现一次，并调用同一动作', () => {
    const page = functionBody(readSource(PAGE), 'AdminMindmapPage');
    const toolbar = toolbarBlock(page);
    const problems: string[] = [];
    for (const label of COLLAPSED_ACTIONS) {
      const items = menuItemSlices(page, label);
      const buttons = wideActionButtons(toolbar, label);
      if (items.length !== 1) problems.push(`${label} 菜单项 ${items.length} 处，要恰好 1 处`);
      if (buttons.length !== 1) problems.push(`${label} 的 hidden xl:inline-flex 按钮 ${buttons.length} 处，要恰好 1 处`);
      const item = items[0] ?? '';
      const button = buttons[0] ?? '';
      if (item === '' || button === '') continue;
      const itemAction = actionExpr(label, item);
      const buttonAction = actionExpr(label, button);
      if (itemAction === '' || itemAction !== buttonAction) {
        problems.push(`${label} 的菜单项与按钮不是同一处理或同一链接`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('切换知识导图在 xl 以下是 w-40，xl 起是 w-48', () => {
    const selects = findOpenTags(readSource(PAGE), 'SimpleSelect').filter((tag) => hasStringAttr(tag.text, 'ariaLabel', '切换知识导图'));
    expect(selects).toHaveLength(1);
    const tokens = classTokens(selects[0]?.text ?? '');
    const problems = [
      tokens.includes('w-40') ? '' : '缺少 w-40',
      tokens.includes('xl:w-48') ? '' : '缺少 xl:w-48',
      tokens.includes('w-48') ? '仍有不带断点的 w-48' : '',
    ].filter((problem) => problem !== '');
    expect(problems).toEqual([]);
  });

  it('保存状态 shrink-0，并且仍是工具栏最右侧', () => {
    const source = readSource(PAGE);
    const toolbar = toolbarBlock(source);
    const saveAt = toolbar.lastIndexOf('<SaveStatus');
    expect(saveAt).toBeGreaterThan(0);
    const after = toolbar.slice(saveAt);
    expect(findOpenTags(after, 'Button')).toEqual([]);
    expect(findOpenTags(after, 'Menu')).toEqual([]);
    expect(findOpenTags(after, 'DropdownMenu')).toEqual([]);
    expect(findOpenTags(after, 'SimpleSelect')).toEqual([]);
    const badges = findOpenTags(functionBody(source, 'SaveStatus'), 'Badge');
    expect(badges.length).toBeGreaterThan(0);
    const loose = badges.filter((badge) => !classTokens(badge.text).includes('shrink-0')).map((badge) => badge.text);
    expect(loose).toEqual([]);
  });

  it('导图管理页门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
