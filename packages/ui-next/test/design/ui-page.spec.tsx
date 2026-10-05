// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONTENT_WIDTH, Page, PageHeader, Toolbar, Workspace } from '../../src/components/ui/page';

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function renderedRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected a single root element');
  }
  return root;
}

const WIDTHS: ReadonlyArray<{ width: 'prose' | 'form' | 'wide' | 'full'; cap: string }> = [
  { width: 'prose', cap: 'max-w-none' },
  { width: 'form', cap: 'max-w-none' },
  { width: 'wide', cap: 'max-w-none' },
  { width: 'full', cap: 'max-w-none' },
];

describe('content width', () => {
  it('copies the four playground content width classes', () => {
    expect(CONTENT_WIDTH).toEqual({
      prose: 'max-w-none',
      form: 'max-w-none',
      wide: 'max-w-none',
      full: 'max-w-none',
    });
  });
});

describe('page', () => {
  it('caps each width and records it on data-width', () => {
    for (const { width, cap } of WIDTHS) {
      const view = render(<Page width={width}>正文</Page>);
      const root = renderedRoot(view.container);
      expect(root).toHaveAttribute('data-slot', 'page');
      expect(root).toHaveAttribute('data-width', width);
      expect(classTokens(root)).toContain(cap);
      for (const other of WIDTHS) {
        if (other.cap !== cap) {
          expect(classTokens(root)).not.toContain(other.cap);
        }
      }
      view.unmount();
    }
  });

  it('defaults an omitted width to wide', () => {
    const view = render(<Page>正文</Page>);
    const root = renderedRoot(view.container);
    expect(root).toHaveAttribute('data-slot', 'page');
    expect(root).toHaveAttribute('data-width', 'wide');
    expect(classTokens(root)).toContain('max-w-none');
    expect(classTokens(root)).not.toContain('max-w-[80rem]');
  });

  it('puts short-screen padding on the root and short-screen gap on the inner layer', () => {
    const view = render(<Page width="form">区块</Page>);
    const root = renderedRoot(view.container);
    expect(classTokens(root)).toContain('short:pt-4');
    const gapHost = [...root.querySelectorAll('*')].find(
      (element) => classTokens(element).includes('short:gap-4') && (element.textContent ?? '').includes('区块'),
    );
    expect(gapHost).toBeInstanceOf(HTMLElement);
  });

  it('centers the capped column, keeps caller classes on the root, and stacks blocks with the normal gap', () => {
    const view = render(<Page width="form" className="min-w-0">区块</Page>);
    const root = renderedRoot(view.container);
    expect(root).toHaveAttribute('data-slot', 'page');
    expect(root).toHaveAttribute('data-width', 'form');
    expect(classTokens(root)).toContain('mx-auto');
    expect(classTokens(root)).toContain('min-w-0');
    expect(classTokens(root)).toContain('max-w-none');
    const gapHost = [...root.querySelectorAll('*')].find(
      (element) => classTokens(element).includes('short:gap-4') && (element.textContent ?? '').includes('区块'),
    );
    if (!(gapHost instanceof HTMLElement)) {
      throw new TypeError('expected the inner block stack');
    }
    expect(classTokens(gapHost)).toContain('gap-6');
  });
});

describe('page header', () => {
  it('renders the title as an h1 and keeps actions inside the header', () => {
    const view = render(<PageHeader title="题库" actions={<button type="button">新建</button>} />);
    const header = renderedRoot(view.container);
    expect(header).toHaveAttribute('data-slot', 'page-header');
    const title = screen.getByRole('heading', { level: 1, name: '题库' });
    expect(header).toContainElement(title);
    expect(header).toContainElement(screen.getByRole('button', { name: '新建' }));
  });

  it('omits pb-5 when tabs are present and includes pb-5 when they are absent', () => {
    const withTabs = render(<PageHeader title="有页签" tabs={<span>页签</span>} />);
    const tabbed = renderedRoot(withTabs.container);
    expect(tabbed).toHaveAttribute('data-slot', 'page-header');
    expect(tabbed).toHaveTextContent('页签');
    expect(classTokens(tabbed)).not.toContain('pb-5');
    cleanup();

    const plain = render(<PageHeader title="无页签" />);
    const header = renderedRoot(plain.container);
    expect(header).toHaveAttribute('data-slot', 'page-header');
    expect(classTokens(header)).toContain('pb-5');
  });

  it('renders breadcrumb, meta, and description inside the header', () => {
    const view = render(<PageHeader title="题库" breadcrumb={<nav>面包屑</nav>} meta={<span>元信息</span>} description="页面说明" />);
    const header = renderedRoot(view.container);
    expect(header).toHaveAttribute('data-slot', 'page-header');
    expect(header).toHaveTextContent('面包屑');
    expect(header).toHaveTextContent('元信息');
    expect(header).toHaveTextContent('页面说明');
  });

  it('uses a header element, the passed title, and the page-title sizes', () => {
    const view = render(<PageHeader title="比赛列表" description="一句说明" />);
    const header = renderedRoot(view.container);
    expect(header.tagName).toBe('HEADER');
    expect(header).toHaveAttribute('data-slot', 'page-header');
    expect(classTokens(header)).toContain('border-b');
    const title = screen.getByRole('heading', { level: 1, name: '比赛列表' });
    expect(header).toContainElement(title);
    expect(classTokens(title)).toContain('text-xl');
    expect(classTokens(title)).toContain('sm:text-2xl');
    expect(header).toHaveTextContent('一句说明');
  });

  it('places actions beside the title from the sm breakpoint', () => {
    const view = render(<PageHeader title="题库" actions={<button type="button">新建</button>} />);
    const header = renderedRoot(view.container);
    const row = [...header.querySelectorAll('*')].find((element) => classTokens(element).includes('sm:flex-row'));
    if (!(row instanceof HTMLElement)) {
      throw new TypeError('expected a row that places actions beside the title');
    }
    expect(classTokens(row)).toContain('flex-col');
    expect(row).toContainElement(screen.getByRole('heading', { level: 1, name: '题库' }));
    expect(row).toContainElement(screen.getByRole('button', { name: '新建' }));
  });

  it('renders description and meta from their own props', () => {
    const descriptionOnly = render(<PageHeader title="题库" description="页面说明" />);
    const described = renderedRoot(descriptionOnly.container);
    expect(described).toHaveTextContent('页面说明');
    expect(described).toContainElement(screen.getByRole('heading', { level: 1, name: '题库' }));
    expect(described).not.toHaveTextContent('元信息');
    cleanup();

    const metaOnly = render(<PageHeader title="题库" meta={<span>元信息</span>} />);
    const header = renderedRoot(metaOnly.container);
    expect(header).toHaveTextContent('元信息');
    expect(header).not.toHaveTextContent('页面说明');
  });
});

describe('toolbar', () => {
  it('places the end slot in a container with ml-auto', () => {
    const view = render(<Toolbar end={<span>e</span>}>x</Toolbar>);
    const root = renderedRoot(view.container);
    expect(root.textContent ?? '').toContain('x');
    const end = screen.getByText('e', { selector: 'span' });
    const holder = end.parentElement;
    if (!(holder instanceof HTMLElement)) {
      throw new TypeError('expected the end slot to have a container');
    }
    expect(classTokens(holder)).toContain('ml-auto');
    expect(holder.textContent).toBe('e');
    expect(root.contains(holder)).toBe(true);
  });

  it('wraps and keeps caller classes on the toolbar root', () => {
    const view = render(<Toolbar className="min-w-0">x</Toolbar>);
    const root = renderedRoot(view.container);
    expect(root.textContent ?? '').toContain('x');
    expect(classTokens(root)).toContain('flex-wrap');
    expect(classTokens(root)).toContain('min-w-0');
  });
});

describe('workspace', () => {
  it('marks the root as a workspace and sizes it to the shell remainder', () => {
    const view = render(<Workspace>x</Workspace>);
    const root = renderedRoot(view.container);
    expect(root).toHaveAttribute('data-slot', 'workspace');
    expect(root).toHaveTextContent('x');
    expect(classTokens(root)).toContain('min-h-0');
    expect(classTokens(root)).toContain('h-(--workspace-h,calc(100dvh-3rem))');
  });

  it('is a column flex div and merges className onto that root', () => {
    const view = render(<Workspace className="min-w-0">x</Workspace>);
    const root = renderedRoot(view.container);
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveAttribute('data-slot', 'workspace');
    expect(root).toHaveTextContent('x');
    expect(classTokens(root)).toContain('flex');
    expect(classTokens(root)).toContain('flex-col');
    expect(classTokens(root)).toContain('min-h-0');
    expect(classTokens(root)).toContain('min-w-0');
  });
});
