// @vitest-environment jsdom
import { type ComponentType, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as paginationModule from '../../src/components/ui/pagination';

interface PaginationProps {
  current: number;
  total: number;
  baseUrl: string;
  pageParam?: string;
  summary?: ReactNode;
}

const SUMMARY_CLASS = ['hidden', 'sm:block', 'text-sm', 'text-fg-subtle'] as const;
const SHOWN_FROM_SM = ['sm:flex', 'sm:inline-flex', 'sm:block', 'sm:inline-block', 'sm:grid'] as const;

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key);
}

function isPagination(value: unknown): value is ComponentType<PaginationProps> {
  return typeof value === 'function';
}

function loadPagination(): ComponentType<PaginationProps> {
  const record: unknown = paginationModule;
  if (typeof record !== 'object' || record === null) {
    throw new TypeError('Pagination module is not an object');
  }
  const component = readField(record, 'Pagination');
  if (!isPagination(component)) {
    throw new TypeError('Pagination is not a function');
  }
  return component;
}

const Pagination = loadPagination();

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

/** `${baseUrl}{?|&}page=N`, the separator rule the link format must keep. */
function pageHref(baseUrl: string, page: number): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}page=${page}`;
}

function leavesWithText(root: ParentNode, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter((element) => {
    if ((element.textContent ?? '').trim() !== text) {
      return false;
    }
    return ![...element.querySelectorAll('*')].some((child) => (child.textContent ?? '').trim() === text);
  });
}

function oneLeaf(root: ParentNode, text: string): Element {
  const found = leavesWithText(root, text);
  expect(found, text).toHaveLength(1);
  const leaf = found[0];
  if (!leaf) {
    throw new TypeError(`expected ${text}`);
  }
  return leaf;
}

function pageAnchor(element: Element): HTMLAnchorElement {
  const anchor = element.tagName === 'A' ? element : element.closest('a');
  expect(anchor).toBeInstanceOf(HTMLAnchorElement);
  if (!(anchor instanceof HTMLAnchorElement)) {
    throw new TypeError('expected a page anchor');
  }
  return anchor;
}

/**
 * Page numbers and ellipses in document order.
 * The compact readout is `current / total`, so it is not a page token.
 */
function pageTokens(root: ParentNode): string[] {
  const tokens: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    const text = (element.textContent ?? '').trim();
    const isPage = text === '…' || /^\d+$/.test(text);
    const nested = [...element.querySelectorAll('*')].some((child) => {
      const childText = (child.textContent ?? '').trim();
      return childText === '…' || /^\d+$/.test(childText);
    });
    if (isPage && !nested) {
      tokens.push(text);
    }
  }
  return tokens;
}

function expectWindow(root: HTMLElement, baseUrl: string, tokens: readonly string[]): void {
  expect(pageTokens(root)).toEqual(tokens);
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      expect(pageAnchor(oneLeaf(root, token))).toHaveAttribute('href', pageHref(baseUrl, Number(token)));
    }
  }
  const marks = leavesWithText(root, '…');
  const expectedMarks = tokens.filter((token) => token === '…').length;
  expect(marks).toHaveLength(expectedMarks);
  for (const mark of marks) {
    expect(mark.closest('a')).toBeNull();
  }
}

function controlsNamed(root: ParentNode, name: string): Element[] {
  const matches = [...root.querySelectorAll('a, span, button')].filter((element) => {
    if (element.getAttribute('aria-label') === name) {
      return true;
    }
    return (element.textContent ?? '').trim() === name;
  });
  return matches.filter((element) => !matches.some((other) => other !== element && other.contains(element)));
}

function oneControl(root: ParentNode, name: string): Element {
  const found = controlsNamed(root, name);
  expect(found, name).toHaveLength(1);
  const control = found[0];
  if (!control) {
    throw new TypeError(`expected control ${name}`);
  }
  return control;
}

function assertDisabledSpan(root: ParentNode, name: string): void {
  const control = oneControl(root, name);
  expect(control.tagName).toBe('SPAN');
  expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(control.closest('a')).toBeNull();
}

function assertEnabledLink(root: ParentNode, name: string, href: string): void {
  const control = oneControl(root, name);
  expect(control.tagName).toBe('A');
  expect(control).toHaveAttribute('href', href);
  expect(control.getAttribute('aria-disabled')).not.toBe('true');
}

function linkedPages(root: ParentNode): number[] {
  const pages: number[] = [];
  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? '';
    const match = /[?&]page=(\d+)(?:&|$)/.exec(href);
    if (match?.[1]) {
      pages.push(Number(match[1]));
    }
  }
  return pages;
}

/** The page list is hidden below sm. `hidden`+`sm:*` and `max-sm:hidden` both say that. */
function hiddenBelowSm(element: Element): boolean {
  const tokens = classTokens(element);
  if (tokens.includes('max-sm:hidden')) {
    return true;
  }
  return tokens.includes('hidden') && SHOWN_FROM_SM.some((token) => tokens.includes(token));
}

function onePageList(root: ParentNode): Element {
  const lists = [...root.querySelectorAll('*')].filter((element) => {
    if (!hiddenBelowSm(element)) {
      return false;
    }
    return [...element.children].some((child) => /^\d+$/.test((child.textContent ?? '').trim()));
  });
  const innermost = lists.filter((element) => !lists.some((other) => other !== element && element.contains(other)));
  expect(innermost, 'page list hidden below sm').toHaveLength(1);
  const list = innermost[0];
  if (!list) {
    throw new TypeError('expected a page list');
  }
  return list;
}

function childLabels(list: Element): string[] {
  return [...list.children].map((child) => (child.textContent ?? '').trim()).filter((text) => text.length > 0);
}

function oneReadout(root: ParentNode, current: number, total: number): Element {
  const text = `${current} / ${total}`;
  const found = leavesWithText(root, text);
  expect(found, `compact readout ${text}`).toHaveLength(1);
  const readout = found[0];
  if (!readout) {
    throw new TypeError(`expected readout ${text}`);
  }
  expect(classTokens(readout)).toContain('sm:hidden');
  expect(classTokens(readout)).not.toContain('hidden');
  let parent = readout.parentElement;
  while (parent) {
    expect(hiddenBelowSm(parent)).toBe(false);
    parent = parent.parentElement;
  }
  return readout;
}

function summaryCarrier(root: ParentNode, text: string): Element {
  const carriers = [...root.querySelectorAll('*')].filter((element) => {
    if ((element.textContent ?? '').trim() !== text) {
      return false;
    }
    const tokens = classTokens(element);
    return SUMMARY_CLASS.every((token) => tokens.includes(token));
  });
  const innermost = carriers.filter((element) => !carriers.some((other) => other !== element && element.contains(other)));
  expect(innermost, `summary ${text}`).toHaveLength(1);
  const carrier = innermost[0];
  if (!carrier) {
    throw new TypeError(`expected summary ${text}`);
  }
  return carrier;
}

function assertShownAtBoth(element: Element, root: HTMLElement): void {
  let current: Element | null = element;
  while (current && current !== root) {
    const tokens = classTokens(current);
    expect(tokens).not.toContain('hidden');
    expect(tokens).not.toContain('sm:hidden');
    expect(tokens).not.toContain('max-sm:hidden');
    current = current.parentElement;
  }
}

function assertNotReversed(element: Element, root: HTMLElement): void {
  let current: Element | null = element;
  while (current && current !== root) {
    const tokens = classTokens(current);
    expect(tokens).not.toContain('flex-row-reverse');
    expect(tokens).not.toContain('flex-col-reverse');
    current = current.parentElement;
  }
}

describe('pagination', () => {
  it('renders nothing when total is 1 or less', () => {
    const cases = [
      { current: 1, total: 1 },
      { current: 5, total: 1 },
      { current: 1, total: 0 },
    ];
    for (const { current, total } of cases) {
      const view = render(
        <Pagination
          current={current}
          total={total}
          baseUrl="/p"
          summary="共 99 题"
        />,
      );
      expect(view.container.innerHTML).toBe('');
      expect(view.container.textContent ?? '').not.toContain('共 99 题');
      view.unmount();
    }
  });

  it('lists 1 … 4 5 6 … 12 for page 5 of 12 and links with ?page', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
      />,
    );

    expectWindow(view.container, '/p', ['1', '…', '4', '5', '6', '…', '12']);
  });

  it('lists every page when total is 7 or less', () => {
    const view = render(
      <Pagination
        current={4}
        total={7}
        baseUrl="/p"
      />,
    );

    expectWindow(view.container, '/p', ['1', '2', '3', '4', '5', '6', '7']);
  });

  it('inserts an ellipsis only when the gap between kept pages is greater than 1', () => {
    const windows: Array<{ current: number; total: number; tokens: string[] }> = [
      { current: 1, total: 8, tokens: ['1', '2', '…', '8'] },
      { current: 2, total: 12, tokens: ['1', '2', '3', '…', '12'] },
      { current: 3, total: 8, tokens: ['1', '2', '3', '4', '…', '8'] },
      { current: 4, total: 8, tokens: ['1', '…', '3', '4', '5', '…', '8'] },
      { current: 8, total: 8, tokens: ['1', '…', '7', '8'] },
    ];
    for (const { current, total, tokens } of windows) {
      const view = render(
        <Pagination
          current={current}
          total={total}
          baseUrl="/p"
        />,
      );
      expectWindow(view.container, '/p', tokens);
      view.unmount();
    }
  });

  it('joins the second page with & when the base url already has a query', () => {
    const view = render(
      <Pagination
        current={1}
        total={3}
        baseUrl="/p?x=1"
      />,
    );

    expect(pageAnchor(oneLeaf(view.container, '2'))).toHaveAttribute('href', '/p?x=1&page=2');
    expect(pageAnchor(oneLeaf(view.container, '1'))).toHaveAttribute('href', '/p?x=1&page=1');
    expect(pageAnchor(oneLeaf(view.container, '3'))).toHaveAttribute('href', '/p?x=1&page=3');
  });

  it('uses pageParam as the query key', () => {
    const view = render(
      <Pagination
        current={1}
        total={3}
        baseUrl="/p?tab=groups"
        pageParam="groupPage"
      />,
    );

    expect(pageAnchor(oneLeaf(view.container, '2'))).toHaveAttribute('href', '/p?tab=groups&groupPage=2');
  });

  it('adds no separator when the base url already ends with one', () => {
    const view = render(
      <Pagination
        current={1}
        total={3}
        baseUrl="/p?x=1&"
      />,
    );

    expect(pageAnchor(oneLeaf(view.container, '2'))).toHaveAttribute('href', '/p?x=1&page=2');
  });

  it('does not link to page 0 and disables the previous step on the first page', () => {
    const view = render(
      <Pagination
        current={1}
        total={12}
        baseUrl="/p"
      />,
    );

    expect(linkedPages(view.container)).not.toContain(0);
    expect(view.container.querySelector('[aria-disabled="true"]')).not.toBeNull();
    assertDisabledSpan(view.container, '上一页');
    assertEnabledLink(view.container, '下一页', '/p?page=2');
  });

  it('disables the next step on the last page and does not link past the end', () => {
    const view = render(
      <Pagination
        current={12}
        total={12}
        baseUrl="/p"
      />,
    );

    expect(linkedPages(view.container)).not.toContain(13);
    assertDisabledSpan(view.container, '下一页');
    assertEnabledLink(view.container, '上一页', '/p?page=11');
  });

  it('links the neighboring pages from the middle', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
      />,
    );

    assertEnabledLink(view.container, '上一页', '/p?page=4');
    assertEnabledLink(view.container, '下一页', '/p?page=6');
  });

  it('links both steps on the page next to either end', () => {
    const view = render(
      <Pagination
        current={2}
        total={3}
        baseUrl="/p"
      />,
    );

    assertEnabledLink(view.container, '上一页', '/p?page=1');
    assertEnabledLink(view.container, '下一页', '/p?page=3');
  });

  it('marks only the current page and paints it with the foreground fill', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
      />,
    );
    const current = oneLeaf(view.container, '5');

    expect(current).toHaveAttribute('aria-current', 'page');
    expect(classTokens(current)).toEqual(expect.arrayContaining(['bg-fg', 'text-bg']));
    expect(classTokens(current)).not.toContain('text-fg-muted');
    expect(view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(pageAnchor(current)).toHaveAttribute('href', '/p?page=5');
  });

  it('paints the other pages as muted links', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
      />,
    );

    for (const label of ['1', '4', '6', '12']) {
      const page = oneLeaf(view.container, label);
      expect(page.hasAttribute('aria-current')).toBe(false);
      expect(classTokens(page)).toEqual(expect.arrayContaining(['text-fg-muted', 'hover:bg-surface-hover']));
      expect(classTokens(page)).not.toContain('bg-fg');
      expect(classTokens(page)).not.toContain('text-bg');
      expect(pageAnchor(page)).toHaveAttribute('href', pageHref('/p', Number(label)));
    }
  });

  it('renders the summary on the left with the subtle text classes', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
        summary="共 99 题"
      />,
    );
    const summary = summaryCarrier(view.container, '共 99 题');

    expect(classTokens(summary)).toEqual(expect.arrayContaining([...SUMMARY_CLASS]));
    assertNotReversed(summary, view.container);
  });

  it('shows only the compact readout below sm and the page list from sm', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
        summary="共 99 题"
      />,
    );
    const readout = oneReadout(view.container, 5, 12);
    const list = onePageList(view.container);
    const summary = summaryCarrier(view.container, '共 99 题');
    const previous = oneControl(view.container, '上一页');
    const next = oneControl(view.container, '下一页');

    expect(childLabels(list)).toEqual(['1', '…', '4', '5', '6', '…', '12']);
    expect(list.contains(readout)).toBe(false);
    expect(list.contains(summary)).toBe(false);
    expect(summary.contains(list)).toBe(false);
    expect(summary.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(summary.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    assertShownAtBoth(previous, view.container);
    assertShownAtBoth(next, view.container);
    expect(view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('places the compact readout between the previous and next steps', () => {
    const view = render(
      <Pagination
        current={5}
        total={12}
        baseUrl="/p"
      />,
    );
    const previous = oneControl(view.container, '上一页');
    const readout = oneReadout(view.container, 5, 12);
    const next = oneControl(view.container, '下一页');

    expect(previous.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(readout.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
