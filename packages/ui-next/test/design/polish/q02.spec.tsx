// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, type RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from '../../../src/components/ui/data-table';

const packageRoot = resolve(import.meta.dirname, '../../..');

function readSource(file: string): string {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

const ACCOUNTS = 'src/pages/admin-accounts.tsx';
const TOKENS = 'src/pages/authtoken/index.tsx';

interface StackRow {
  id: string;
}

interface StackHandlers {
  onRowClick?: (row: StackRow) => void;
  rowHref?: (row: StackRow) => string;
}

function renderStack(handlers: StackHandlers = {}): RenderResult {
  return render(
    <DataTable
      mobile="stack"
      rows={[{ id: '1' }]}
      rowKey={(row) => row.id}
      columns={[{
        key: 'revoke',
        header: '操作',
        cell: () => <button>撤销</button>,
      }]}
      onRowClick={handlers.onRowClick}
      rowHref={handlers.rowHref}
    />,
  );
}

/** jsdom does not apply `md:hidden`, so the stack card is the list item, not the table row. */
function stackedCard(container: HTMLElement): HTMLElement {
  const items = [...container.querySelectorAll('ul > li')];
  expect(items).toHaveLength(1);
  const item = items[0];
  if (!(item instanceof HTMLLIElement)) {
    throw new TypeError('expected a stacked card item');
  }
  const card = item.firstElementChild;
  if (!(card instanceof HTMLElement) || item.childElementCount !== 1) {
    throw new TypeError('expected one stacked card root');
  }
  return card;
}

function isTagBoundary(char: string): boolean {
  return /[\s/>]/.test(char);
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return index + 1;
  }
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      cursor = skipBraced(source, cursor + 1);
      continue;
    }
    if (char === quote) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
}

function skipBraced(source: string, openIndex: number): number {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '{') {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return cursor;
      }
      continue;
    }
    cursor += 1;
  }
  return source.length;
}

function endOfOpenTag(source: string, start: number): { end: number; selfClosing: boolean } {
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '{') {
      cursor = skipBraced(source, cursor);
      continue;
    }
    if (char === '>') {
      let look = cursor - 1;
      while (look > start && /\s/.test(source[look] ?? '')) {
        look -= 1;
      }
      return { end: cursor + 1, selfClosing: source[look] === '/' };
    }
    cursor += 1;
  }
  throw new Error('JSX 开标签没有结束');
}

function endOfPanel(source: string, start: number): number {
  const open = endOfOpenTag(source, start);
  if (open.selfClosing) {
    return open.end;
  }
  let depth = 1;
  let cursor = open.end;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (source.startsWith('</Panel>', cursor)) {
      depth -= 1;
      if (depth === 0) {
        return cursor + '</Panel>'.length;
      }
      cursor += '</Panel>'.length;
      continue;
    }
    if (source.startsWith('<Panel', cursor) && isTagBoundary(source[cursor + '<Panel'.length] ?? '')) {
      const nested = endOfOpenTag(source, cursor);
      if (!nested.selfClosing) {
        depth += 1;
      }
      cursor = nested.end;
      continue;
    }
    cursor += 1;
  }
  throw new Error('Panel 没有闭合');
}

function panelBlocks(source: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (source.startsWith('<Panel', cursor) && isTagBoundary(source[cursor + '<Panel'.length] ?? '')) {
      const end = endOfPanel(source, cursor);
      blocks.push(source.slice(cursor, end));
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  return blocks;
}

interface ButtonRecord {
  open: string;
  children: string;
}

function buttonRecords(source: string): ButtonRecord[] {
  const records: ButtonRecord[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf('<Button', from);
    if (start < 0) {
      break;
    }
    const boundary = source[start + '<Button'.length] ?? '';
    if (!isTagBoundary(boundary)) {
      from = start + '<Button'.length;
      continue;
    }
    const open = endOfOpenTag(source, start);
    const close = source.indexOf('</Button>', open.end);
    records.push({
      open: source.slice(start, open.end).replace(/\s+/g, ' ').trim(),
      children: close < 0 ? '' : source.slice(open.end, close),
    });
    from = close < 0 ? open.end : close + '</Button>'.length;
  }
  return records;
}

function visibleLabel(children: string): string {
  return children.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
}

function cancelOpens(source: string): string[] {
  return buttonRecords(source)
    .filter((button) => visibleLabel(button.children) === '取消')
    .map((button) => button.open);
}

function nestedBorderHits(source: string): string[] {
  return panelBlocks(source).flatMap((block, index) => {
    const at = block.indexOf('rounded-lg border');
    if (at < 0) {
      return [];
    }
    const snippet = block.slice(Math.max(0, at - 24), at + 'rounded-lg border'.length).replace(/\s+/g, ' ');
    return [`Panel#${index + 1} ${snippet}`];
  });
}

describe('q02 stacked cards, profile sections, and dialog cancel', () => {
  it('无 rowHref 和 onRowClick 时堆叠卡片根是不可聚焦的 div，且按钮不再套按钮', () => {
    const view = renderStack();
    const card = stackedCard(view.container);

    expect({
      tag: card.tagName,
      role: card.getAttribute('role'),
      tabIndex: card.getAttribute('tabindex'),
      nestedButtons: view.container.querySelectorAll('button button').length,
    }).toEqual({
      tag: 'DIV',
      role: null,
      tabIndex: null,
      nestedButtons: 0,
    });
  });

  it('传入 onRowClick 时堆叠卡片根是 button，传入 rowHref 时是 a', () => {
    const clicked = renderStack({ onRowClick: () => undefined });
    const buttonCard = stackedCard(clicked.container);
    expect(buttonCard.tagName).toBe('BUTTON');
    expect(buttonCard.getAttribute('type')).toBe('button');
    clicked.unmount();

    const linked = renderStack({ rowHref: () => '/credential/1' });
    const linkCard = stackedCard(linked.container);
    expect(linkCard.tagName).toBe('A');
    expect(linkCard.getAttribute('href')).toBe('/credential/1');
  });

  it('档案页分区改用 PageTabs，不再 import 或使用 MiniTabs', () => {
    const source = readSource(ACCOUNTS);
    expect(source).not.toMatch(/\bMiniTabs\b/);
    expect(source).toContain('<PageTabs');
  });

  it('账号页和令牌页文本为「取消」的 Button 开标签都是 secondary', () => {
    for (const file of [ACCOUNTS, TOKENS]) {
      const opens = cancelOpens(readSource(file));
      expect(opens, file).not.toEqual([]);
      const wrong = opens.filter((open) => !open.includes('variant="secondary"'));
      expect(wrong, file).toEqual([]);
    }
  });

  it('账号页每个 Panel 块内不再出现 rounded-lg border', () => {
    const source = readSource(ACCOUNTS);
    expect(panelBlocks(source).length).toBeGreaterThan(0);
    expect(nestedBorderHits(source)).toEqual([]);
  });
});
