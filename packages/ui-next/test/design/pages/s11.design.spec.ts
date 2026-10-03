// @vitest-environment node
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap';
import { DiscussionDetailPage, DiscussionsPage } from '@/pages/discussions';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/discussions.tsx',
  'src/pages/blog.tsx',
  'src/pages/wiki.tsx',
] as const;

const DISCUSSIONS = 'src/pages/discussions.tsx';
const BLOG = 'src/pages/blog.tsx';
const WIKI = 'src/pages/wiki.tsx';

// expectPageStructure only rejects widths that were not listed. These checks
// require the listed width on the <Page tag of that page function.
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

function pageWidth(width: 'wide' | 'prose' | 'form'): RegExp {
  return new RegExp(`<Page\\b[^>]*\\bwidth="${width}"`);
}

function discussionBootstrap(star: boolean, extra: Record<string, unknown> = {}): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-03T00:00:00.000Z',
    user: {
      id: 2,
      name: 'root',
      mail: 'root@example.test',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'root',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      discussions: '/discuss',
      discussionDetail: '/discuss/__DID__',
    } as KryptonBootstrap['urls'],
    udict: {
      3: { _id: 3, uname: 'alice' },
    },
    page: {
      templateName: 'discussion_detail.html',
      data: {
        ddoc: {
          _id: 'did1',
          docId: 'did1',
          title: '题解讨论',
          content: '楼主正文',
          owner: 2,
          views: 3,
        },
        drdocs: [
          {
            _id: 'rid1',
            owner: 3,
            content: '一条回复',
            reply: [{ _id: 'tid1', owner: 3, content: '楼中楼' }],
          },
        ],
        drcount: 1,
        page: 1,
        pcount: 1,
        dsdoc: { star },
        vnode: { id: 'general', title: '综合讨论', type: 10 },
        permissions: {
          canEditDiscussion: true,
          canReply: true,
          replies: {
            rid1: { canEdit: true, tail: { tid1: { canEdit: true } } },
          },
        },
        ...extra,
      },
    },
  };
}

interface DiscussionListDoc {
  _id: string;
  title: string;
  owner: number;
  views: number;
  nReply: number;
  updateAt: string;
  docId: string;
}

function discussionListBootstrap(ddocs: DiscussionListDoc[]): KryptonBootstrap {
  const base = discussionBootstrap(false);
  return {
    ...base,
    page: {
      templateName: 'discussion_main.html',
      data: {
        ddocs,
        dcount: ddocs.length,
        page: 1,
        dpcount: 1,
        page_name: 'discussion_main',
        vnode: {},
        vnodes: [],
      },
    },
  };
}

function assignGlobal(name: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor?.configurable === false) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const view = dom.window;
  assignGlobal('window', view);
  assignGlobal('document', view.document);
  assignGlobal('navigator', view.navigator);
  assignGlobal('HTMLElement', view.HTMLElement);
  assignGlobal('HTMLFormElement', view.HTMLFormElement);
  assignGlobal('HTMLInputElement', view.HTMLInputElement);
  assignGlobal('HTMLTextAreaElement', view.HTMLTextAreaElement);
  assignGlobal('Element', view.Element);
  assignGlobal('Node', view.Node);
  assignGlobal('SVGElement', view.SVGElement);
  assignGlobal('DocumentFragment', view.DocumentFragment);
  assignGlobal('MutationObserver', view.MutationObserver);
  assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
  assignGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  assignGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  assignGlobal('localStorage', view.localStorage);
  assignGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  assignGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
  assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

async function renderDiscussion(
  star: boolean,
  extra: Record<string, unknown> = {},
): Promise<{ container: HTMLElement; unmount: () => void }> {
  installDom();
  const { render } = await import('@testing-library/react');
  const view = render(createElement(
    BootstrapProvider,
    { bootstrap: discussionBootstrap(star, extra) },
    createElement(DiscussionDetailPage),
  ));
  return { container: view.container, unmount: view.unmount };
}

function formByOperation(container: ParentNode, operation: string): HTMLFormElement {
  const form = [...container.querySelectorAll('form')].find((item) => (
    item.querySelector('[name="operation"]')?.getAttribute('value') === operation
  ));
  expect(form, operation).toBeInstanceOf(HTMLFormElement);
  return form as HTMLFormElement;
}

function expectContentField(container: ParentNode, operation: string): void {
  const field = formByOperation(container, operation).querySelector('[name="content"]');
  expect(field, operation).not.toBeNull();
}

function starForm(container: ParentNode): HTMLFormElement {
  const form = [...container.querySelectorAll('form')].find((item) => item.textContent?.includes('收藏'));
  expect(form).toBeInstanceOf(HTMLFormElement);
  return form as HTMLFormElement;
}

describe('s11 discussions, blog and wiki', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 discussions.tsx', () => {
    expectPageStructure(DISCUSSIONS, {
      widths: ['wide', 'prose'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('页面结构 blog.tsx', () => {
    expectPageStructure(BLOG, {
      widths: ['wide', 'prose', 'form'],
      workspace: 'forbidden',
      minPageHeaders: 3,
    });
  });

  it('页面结构 wiki.tsx', () => {
    expectPageStructure(WIKI, {
      widths: ['prose'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('讨论列表用 wide，帖子用 prose', () => {
    const src = readSource(DISCUSSIONS);
    expect(functionBody(src, 'DiscussionsPage')).toMatch(pageWidth('wide'));
    expect(functionBody(src, 'DiscussionDetailPage')).toMatch(pageWidth('prose'));
  });

  it('博客列表用 wide，正文用 prose，编辑用 form', () => {
    const src = readSource(BLOG);
    expect(functionBody(src, 'BlogMainPage')).toMatch(pageWidth('wide'));
    expect(functionBody(src, 'BlogDetailPage')).toMatch(pageWidth('prose'));
    expect(functionBody(src, 'BlogEditPage')).toMatch(pageWidth('form'));
  });

  it('wiki 用 prose', () => {
    const src = readSource(WIKI);
    expect(functionBody(src, 'AboutPage')).toMatch(pageWidth('prose'));
    expect(functionBody(src, 'WikiHelpPage')).toMatch(pageWidth('prose'));
  });

  it('讨论、博客正文和 Wiki 正文放在 krypton-prose 容器里', () => {
    const discussions = readSource(DISCUSSIONS);
    const blog = readSource(BLOG);
    const wiki = readSource(WIKI);
    expect(functionBody(discussions, 'MentionedMarkdown'), 'discussions').toMatch(/\bkrypton-prose\b/);
    expect(functionBody(blog, 'BlogDetailPage'), 'blog').toMatch(/\bkrypton-prose\b/);
    expect(functionBody(wiki, 'ArticleSection'), 'wiki article').toMatch(/\bkrypton-prose\b/);
    expect(functionBody(wiki, 'WikiHelpPage'), 'wiki help').toMatch(/\bkrypton-prose\b/);
  });

  it('删除 BlogShell，换成 Page 与 PageHeader', () => {
    const src = readSource(BLOG);
    expect(src).not.toMatch(/\bfunction BlogShell\b/);
    expect(src).not.toMatch(/<BlogShell\b/);
    expect(functionBody(src, 'BlogMainPage')).toMatch(/<Page\b/);
    expect(functionBody(src, 'BlogMainPage')).toMatch(/<PageHeader\b/);
    expect(functionBody(src, 'BlogDetailPage')).toMatch(/<PageHeader\b/);
    expect(functionBody(src, 'BlogEditPage')).toMatch(/<PageHeader\b/);
  });

  it('讨论帖提交 content 与 star，编辑入口不是 summary 里的 button', async () => {
    const open = await renderDiscussion(false);
    expectContentField(open.container, 'reply');
    expectContentField(open.container, 'tail_reply');
    expectContentField(open.container, 'edit_reply');
    expectContentField(open.container, 'edit_tail_reply');
    const star = starForm(open.container);
    expect(star.querySelector('[name="operation"]')?.getAttribute('value')).toBe('star');
    expect(star.querySelector('input[name="star"]')).toHaveProperty('value', 'true');
    for (const summary of open.container.querySelectorAll('summary')) {
      expect(summary.querySelector('button')).toBeNull();
    }
    open.unmount();

    const starred = await renderDiscussion(true);
    const starredForm = starForm(starred.container);
    expect(starredForm.querySelector('[name="operation"]')?.getAttribute('value')).toBe('star');
    expect(starredForm.querySelector('input[name="star"]')).toHaveProperty('value', 'false');
    starred.unmount();
  });

  it('删除 WikiShell，换成 Page 与 PageHeader', () => {
    const src = readSource(WIKI);
    expect(src).not.toMatch(/\bfunction WikiShell\b/);
    expect(src).not.toMatch(/<WikiShell\b/);
    expect(functionBody(src, 'AboutPage')).toMatch(/<Page\b/);
    expect(functionBody(src, 'AboutPage')).toMatch(/<PageHeader\b/);
    expect(functionBody(src, 'WikiHelpPage')).toMatch(/<PageHeader\b/);
  });

  it('楼层分页使用服务端每页 50 条，不把页大小写死为 20', async () => {
    const pageTwo = await renderDiscussion(false, {
      page: 2,
      pcount: 2,
      drcount: 60,
      drdocs: [{ _id: 'rid-page2', owner: 3, content: '第 51 条回复', reply: [] }],
      permissions: { canEditDiscussion: false, canReply: false, replies: {} },
    });
    try {
      const floors = [...pageTwo.container.querySelectorAll('.font-mono')].map((item) => item.textContent?.trim() ?? '');
      expect(floors).toContain('#52');
      expect(floors).not.toContain('#22');
    } finally {
      pageTwo.unmount();
    }

    const detail = functionBody(readSource(DISCUSSIONS), 'DiscussionDetailPage');
    expect(detail).not.toMatch(/\(\s*page\s*-\s*1\s*\)\s*\*\s*20\b/);
    expect(detail).not.toMatch(/Math\.ceil\(\s*[A-Za-z_][\w.]*\s*\/\s*20\b/);
  });

  it('讨论列表排序选项的参数值与迁移前一致', async () => {
    const list = functionBody(readSource(DISCUSSIONS), 'DiscussionsPage');
    expect(list).toMatch(/value:\s*['"]updateAt['"]\s*,\s*label:\s*['"]最新回复['"]/);
    expect(list).toMatch(/value:\s*['"]docId['"]\s*,\s*label:\s*['"]最新发布['"]/);
    expect(list).toMatch(/value:\s*['"]nReply['"]\s*,\s*label:\s*['"]回复数['"]/);
    expect(list).toMatch(/value:\s*['"]views['"]\s*,\s*label:\s*['"]浏览数['"]/);

    const docs: DiscussionListDoc[] = [
      {
        _id: 'a',
        title: '浏览最多',
        owner: 3,
        views: 100,
        nReply: 1,
        updateAt: '2026-01-01T00:00:00.000Z',
        docId: '64b00000aaaaaaaaaaaaaaaa',
      },
      {
        _id: 'c',
        title: '浏览居中',
        owner: 3,
        views: 50,
        nReply: 2,
        updateAt: '2026-02-01T00:00:00.000Z',
        docId: '67b00000cccccccccccccccc',
      },
      {
        _id: 'b',
        title: '浏览最少',
        owner: 3,
        views: 1,
        nReply: 3,
        updateAt: '2026-03-01T00:00:00.000Z',
        docId: '65b00000bbbbbbbbbbbbbbbb',
      },
    ];
    installDom();
    const { fireEvent, render } = await import('@testing-library/react');
    const view = render(createElement(BootstrapProvider, {
      bootstrap: discussionListBootstrap(docs),
    }, createElement(DiscussionsPage)));
    try {
      const tab = (label: string): HTMLElement => {
        const found = [...view.container.querySelectorAll('[role="tab"]')].find((item) => item.textContent?.includes(label));
        expect(found, label).toBeInstanceOf(HTMLElement);
        return found as HTMLElement;
      };
      const titles = (): string[] => [...view.container.querySelectorAll('a span.truncate.font-medium')].map((item) => item.textContent?.trim() ?? '');
      fireEvent.click(tab('浏览数'));
      expect(titles()).toEqual(['浏览最多', '浏览居中', '浏览最少']);
      fireEvent.click(tab('最新回复'));
      expect(titles()).toEqual(['浏览最少', '浏览居中', '浏览最多']);
      fireEvent.click(tab('最新发布'));
      expect(titles()).toEqual(['浏览居中', '浏览最少', '浏览最多']);
    } finally {
      view.unmount();
    }
  });
});
