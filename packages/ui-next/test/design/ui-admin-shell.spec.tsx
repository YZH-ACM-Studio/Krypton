// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../../src/components/admin/admin-page';
import { ModuleWorkspace } from '../../src/components/management/module-workspace';
import '../../src/lib/admin-nav-builtins';
import {
  clearAdminNavRegistry,
  getAdminNavSections,
  registerAdminNavSection,
} from '../../src/lib/admin-nav-registry';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap';
import { PRIV } from '../../src/lib/perms';

const packageRoot = resolve(import.meta.dirname, '../..');

function readSource(file: string): string {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

const LANE_FILES = [
  'src/components/admin/admin-page.tsx',
  'src/components/admin/admin-sidebar.tsx',
  'src/components/admin/forbidden.tsx',
  'src/components/management/module-workspace.tsx',
] as const;

const BANNED_GATE_RULES = ['DS001', 'DS002', 'DS003', 'DS015'] as const;

/** Existing denial copy. The plan's sample sentence is not product copy. */
const EXISTING_DENIED_TITLE = '无权访问';
const EXISTING_DENIED_DESCRIPTION = '当前账号缺少访问该管理页面所需的权限。请联系管理员。';
const EXISTING_DENIED_TITLES = [
  EXISTING_DENIED_TITLE,
  EXISTING_DENIED_DESCRIPTION,
] as const;

const SIGNED_OUT_COPY = '请先登录后再访问该页面。';

const SIDEBAR_CHROME = [
  'hidden',
  'lg:flex',
  'w-60',
  'shrink-0',
  'border-r',
  'border-line',
  'bg-surface-sunken',
] as const;

const CONTENT_COLUMN = [
  'mx-auto',
  'w-full',
  'max-w-7xl',
  'px-4',
  'pt-5',
  'pb-16',
  'sm:px-6',
  'sm:pt-8',
  'lg:px-8',
] as const;

const GROUP_TITLE = ['px-2', 'pt-4', 'pb-1', 'text-xs', 'font-semibold', 'text-fg-subtle'] as const;

const NAV_ITEM = ['h-(--row-h)', 'rounded-md'] as const;

const ACTIVE_ITEM = ['bg-surface-active', 'font-medium', 'text-fg'] as const;

const IDLE_ITEM = ['text-fg-muted', 'hover:bg-surface-hover'] as const;

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function makeBootstrap(templateName: string, user: { signedIn: boolean; priv: number }): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-07-26T00:00:00.000Z',
    user: {
      id: 2,
      name: 'root',
      signedIn: user.signedIn,
      priv: user.priv,
    } as KryptonBootstrap['user'],
    domain: {
      id: 'system',
      name: '主域',
      bulletin: '',
      avatar: '',
    },
    urls: {
      home: '/',
      problems: '/p',
      records: '/record',
      discussions: '/discuss',
      domainPermission: '/domain/permission',
      status: '/manage/status',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data: {} },
  };
}

function renderShell(
  children: ReactNode,
  user: { signedIn: boolean; priv: number },
  templateName = 'domain_dashboard.html',
) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(templateName, user)}>
      {children}
    </BootstrapProvider>,
  );
}

const allowed = { signedIn: true, priv: PRIV.PRIV_EDIT_SYSTEM };

function findWithTokens(root: ParentNode, tokens: readonly string[]): HTMLElement | undefined {
  const found = [...root.querySelectorAll('*')].find((element) => {
    return element instanceof HTMLElement && tokens.every((token) => classTokens(element).includes(token));
  });
  return found instanceof HTMLElement ? found : undefined;
}

function selfOrAncestor(element: Element, token: string): HTMLElement | undefined {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLElement && classTokens(current).includes(token)) {
      return current;
    }
    current = current.parentElement;
  }
  return undefined;
}

function emptyStateTitles(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll('div')].filter((element) => {
    const tokens = classTokens(element);
    return tokens.includes('text-md') && tokens.includes('font-medium') && tokens.includes('text-fg');
  });
}

function requireEmptyStateTitle(root: ParentNode): HTMLElement {
  const titles = emptyStateTitles(root);
  expect(titles).toHaveLength(1);
  const title = titles[0];
  if (!(title instanceof HTMLElement)) {
    throw new TypeError('expected an EmptyState title');
  }
  return title;
}

function iconUses(link: Element, tone: string): boolean {
  const tokens = classTokens(link);
  const svg = link.querySelector('svg');
  const svgTokens = svg ? classTokens(svg) : [];
  const sized = tokens.includes('[&_svg]:size-5') || svgTokens.includes('size-5');
  const colored = tokens.includes(`[&_svg]:${tone}`) || svgTokens.includes(tone);
  return sized && colored;
}

function designGateStdout(file: string): string {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', file], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new TypeError(`design-gate ${file} exited ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout;
}

describe('admin page', () => {
  it('drops the entrance motion and the fixed viewport height', () => {
    const source = readSource('src/components/admin/admin-page.tsx');
    expect(source.includes('motion')).toBe(false);
    expect(source.includes('calc(100dvh')).toBe(false);
  });

  it('renders an authorized hideSidebar page as a wide Page with an h1 title', () => {
    const view = renderShell(
      <AdminPage
        title="账号"
        hideSidebar
      >
        x
      </AdminPage>,
      allowed,
    );
    const page = view.container.querySelector('[data-slot="page"]');
    expect(page).toBeInstanceOf(HTMLElement);
    if (!(page instanceof HTMLElement)) {
      throw new TypeError('expected the page root');
    }
    expect(page).toHaveAttribute('data-width', 'wide');
    expect(view.container.querySelector('[data-slot="workspace"]')).toBeNull();
    const heading = screen.getByRole('heading', { level: 1, name: '账号' });
    expect(page).toContainElement(heading);
    expect(screen.getByText('x')).toBeTruthy();
  });

  it('renders a string title through PageHeader', () => {
    const view = renderShell(
      <AdminPage
        title="账号"
        description="域内账号"
        actions={<button type="button">新建</button>}
        hideSidebar
      >
        x
      </AdminPage>,
      allowed,
    );
    const header = view.container.querySelector('[data-slot="page-header"]');
    expect(header).toBeInstanceOf(HTMLElement);
    if (!(header instanceof HTMLElement)) {
      throw new TypeError('expected a page header');
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(header).toContainElement(screen.getByRole('heading', { level: 1, name: '账号' }));
    expect(header).toHaveTextContent('域内账号');
    expect(header).toContainElement(screen.getByRole('button', { name: '新建' }));
  });

  it('keeps a non-string title unwrapped and uses the page-header action row', () => {
    renderShell(
      <AdminPage
        title={<span data-testid="custom-title">自定义</span>}
        description={<span>节点说明</span>}
        actions={<button type="button">操作</button>}
        hideSidebar
      >
        x
      </AdminPage>,
      allowed,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const custom = screen.getByTestId('custom-title');
    const titleArea = selfOrAncestor(custom, 'min-w-0');
    expect(titleArea).toBeInstanceOf(HTMLElement);
    if (!(titleArea instanceof HTMLElement)) {
      throw new TypeError('expected the title column');
    }
    expect(titleArea).toContainElement(screen.getByText('节点说明'));
    const actionRow = selfOrAncestor(screen.getByRole('button', { name: '操作' }), 'flex-wrap');
    expect(actionRow).toBeInstanceOf(HTMLElement);
    if (!(actionRow instanceof HTMLElement)) {
      throw new TypeError('expected the actions row');
    }
    expect(classTokens(actionRow)).toEqual(expect.arrayContaining(['shrink-0', 'flex-wrap', 'gap-2']));
  });

  it('keeps contentClassName on the element that directly wraps children', () => {
    renderShell(
      <AdminPage
        title="账号"
        hideSidebar
        contentClassName="probe-width"
      >
        <span data-testid="body">x</span>
      </AdminPage>,
      allowed,
    );
    const parent = screen.getByTestId('body').parentElement;
    if (!(parent instanceof HTMLElement)) {
      throw new TypeError('expected the children container');
    }
    expect(classTokens(parent)).toContain('probe-width');
  });

  it('renders the default shell as a workspace', () => {
    const view = renderShell(
      <AdminPage title="账号">
        正文
      </AdminPage>,
      allowed,
    );
    const workspace = view.container.querySelector('[data-slot="workspace"]');
    expect(workspace).toBeInstanceOf(HTMLElement);
    expect(view.container.querySelector('[data-slot="page"]')).toBeNull();
  });

  it('splits the workspace into a sunken sidebar and a wide column', () => {
    const view = renderShell(
      <AdminPage title="账号">
        正文
      </AdminPage>,
      allowed,
    );
    const row = findWithTokens(view.container, ['flex', 'min-h-0', 'flex-1']);
    expect(row).toBeInstanceOf(HTMLElement);
    const sidebar = findWithTokens(view.container, SIDEBAR_CHROME);
    expect(sidebar).toBeInstanceOf(HTMLElement);
    const column = findWithTokens(view.container, CONTENT_COLUMN);
    expect(column).toBeInstanceOf(HTMLElement);
    if (!(column instanceof HTMLElement)) {
      throw new TypeError('expected the wide column');
    }
    expect(column).toContainElement(screen.getByRole('heading', { level: 1, name: '账号' }));
    expect(column).toContainElement(screen.getByText('正文'));
    const viewport = view.container.querySelector('[data-radix-scroll-area-viewport]');
    const scrollRoot = viewport?.parentElement;
    if (!(scrollRoot instanceof HTMLElement)) {
      throw new TypeError('expected the scroll area');
    }
    expect(classTokens(scrollRoot)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']));
    expect(classTokens(viewport instanceof Element ? viewport : scrollRoot)).toContain('[&>div]:!block');
  });

  it('styles sidebar items and group titles like the app-shell nav', () => {
    const view = renderShell(
      <AdminPage title="账号">
        正文
      </AdminPage>,
      allowed,
    );
    const active = screen.getByRole('link', { name: '域总览' });
    expect(classTokens(active)).toEqual(expect.arrayContaining([...NAV_ITEM, ...ACTIVE_ITEM]));
    const idle = screen.getByRole('link', { name: '基本设置' });
    expect(classTokens(idle)).toEqual(expect.arrayContaining([...NAV_ITEM, ...IDLE_ITEM]));
    expect(iconUses(idle, 'text-fg-subtle')).toBe(true);
    const labels = [...view.container.querySelectorAll('*')].filter((element) => {
      return element instanceof HTMLElement && element.childElementCount === 0 && element.textContent === '总览';
    });
    expect(labels).toHaveLength(1);
    const label = labels[0];
    if (!(label instanceof HTMLElement)) {
      throw new TypeError('expected the group title');
    }
    expect(classTokens(label)).toEqual(expect.arrayContaining([...GROUP_TITLE]));
    expect(classTokens(label)).not.toContain('uppercase');
  });

  it('allows a signed-in user who holds any requiredPriv bit', () => {
    renderShell(
      <AdminPage
        title="账号"
        requiredPriv={[PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_MANAGE_ALL_DOMAIN]}
        hideSidebar
      >
        x
      </AdminPage>,
      { signedIn: true, priv: PRIV.PRIV_MANAGE_ALL_DOMAIN },
    );
    expect(screen.getByRole('heading', { level: 1, name: '账号' })).toBeTruthy();
    expect(screen.getByText('x')).toBeTruthy();
  });

  it('denies a signed-in user who holds none of the requiredPriv bits', () => {
    const view = renderShell(
      <AdminPage
        title="账号"
        requiredPriv={[PRIV.PRIV_EDIT_SYSTEM, PRIV.PRIV_MANAGE_ALL_DOMAIN]}
        hideSidebar
      >
        x
      </AdminPage>,
      { signedIn: true, priv: PRIV.PRIV_CREATE_DOMAIN },
    );
    expect(screen.queryByRole('heading', { level: 1, name: '账号' })).toBeNull();
    expect(screen.queryByText('x')).toBeNull();
    expect(screen.queryByText('你没有权限访问此页面')).toBeNull();
    const title = requireEmptyStateTitle(view.container);
    expect((EXISTING_DENIED_TITLES as readonly string[]).includes(title.textContent ?? '')).toBe(true);
  });

  it('shows the existing signed-out copy as the empty-state title', () => {
    const view = renderShell(
      <AdminPage
        title="账号"
        hideSidebar
      >
        x
      </AdminPage>,
      { signedIn: false, priv: PRIV.PRIV_EDIT_SYSTEM },
    );
    expect(screen.queryByText('x')).toBeNull();
    const title = requireEmptyStateTitle(view.container);
    expect(title.textContent).toBe(SIGNED_OUT_COPY);
  });

  it('renders the default denial as an empty state with the existing copy', () => {
    const view = renderShell(
      <AdminPage
        title="账号"
        hideSidebar
      >
        x
      </AdminPage>,
      { signedIn: true, priv: 0 },
    );
    expect(screen.queryByText('x')).toBeNull();
    expect(screen.queryByText('你没有权限访问此页面')).toBeNull();
    const title = requireEmptyStateTitle(view.container);
    expect((EXISTING_DENIED_TITLES as readonly string[]).includes(title.textContent ?? '')).toBe(true);
  });

  it('omits heading chrome when title, description, and actions are all absent', () => {
    const view = renderShell(
      <AdminPage hideSidebar>
        <span>只有正文</span>
      </AdminPage>,
      allowed,
    );
    expect(view.container.querySelector('header')).toBeNull();
    expect(view.container.querySelector('[data-slot="page-header"]')).toBeNull();
    expect(screen.getByText('只有正文')).toBeTruthy();
  });

  it('keeps a string description next to a custom title', () => {
    renderShell(
      <AdminPage
        title={<span>自定义</span>}
        description="纯文字说明"
        hideSidebar
      >
        x
      </AdminPage>,
      allowed,
    );
    const description = screen.getByText('纯文字说明');
    expect(description.tagName).toBe('P');
    expect(classTokens(description)).toEqual(expect.arrayContaining(['text-sm', 'text-fg-muted']));
    expect(selfOrAncestor(description, 'min-w-0')).toContainElement(screen.getByText('自定义'));
  });

  it('renders the existing denial copy, shield icon, and recovery actions', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    try {
      const view = renderShell(
        <AdminPage
          title="账号"
          hideSidebar
        >
          x
        </AdminPage>,
        { signedIn: true, priv: 0 },
      );
      const title = requireEmptyStateTitle(view.container);
      expect(title.textContent).toBe(EXISTING_DENIED_TITLE);
      expect(screen.getByText(EXISTING_DENIED_DESCRIPTION).tagName).toBe('P');
      const icon = view.container.querySelector('svg');
      expect(icon?.tagName.toLowerCase()).toBe('svg');
      fireEvent.click(screen.getByRole('button', { name: '返回上一页' }));
      expect(back).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/');
    } finally {
      back.mockRestore();
    }
  });

  it('shows a zero badge on a visible admin nav item', () => {
    const snapshot = getAdminNavSections();
    registerAdminNavSection({
      key: 'badge-probe',
      label: '探针',
      order: 0,
      items: [{
        key: 'badge-item',
        label: '带徽标',
        href: '/badge-probe',
        badge: 0,
      }],
    });
    try {
      renderShell(
        <AdminPage title="账号">
          正文
        </AdminPage>,
        allowed,
      );
      const link = screen.getByRole('link', { name: /带徽标/ });
      expect(link.textContent).toContain('0');
    } finally {
      clearAdminNavRegistry();
      for (const section of snapshot) {
        registerAdminNavSection(section);
      }
    }
  });

  it('skips the privilege gate when bypassPrivGate is set', () => {
    renderShell(
      <AdminPage
        title="账号"
        bypassPrivGate
        hideSidebar
      >
        x
      </AdminPage>,
      { signedIn: false, priv: 0 },
    );
    expect(screen.getByRole('heading', { level: 1, name: '账号' })).toBeTruthy();
    expect(screen.getByText('x')).toBeTruthy();
    expect(screen.queryByText(SIGNED_OUT_COPY)).toBeNull();
  });
});

describe('module workspace', () => {
  const navItems = [
    {
      key: 'schools',
      label: '学校',
      href: '/schools',
      templateNames: ['schools.html'],
    },
    {
      key: 'groups',
      label: '班级',
      href: '/groups',
      templateNames: ['groups.html'],
    },
  ] as const;

  it('selects the MiniTabs item resolved from the current template', () => {
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="学校管理"
        bypassPrivGate
        navItems={navItems}
      >
        正文
      </ModuleWorkspace>,
      { signedIn: true, priv: 0 },
      'groups.html',
    );
    expect(screen.getByRole('tab', { name: '班级' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '学校' })).toHaveAttribute('aria-selected', 'false');
  });

  it('puts the toolbar slot inside Toolbar', () => {
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="学校管理"
        bypassPrivGate
        navItems={navItems}
        toolbar={<span>工具条</span>}
      >
        正文
      </ModuleWorkspace>,
      { signedIn: true, priv: 0 },
      'schools.html',
    );
    const tool = screen.getByText('工具条');
    const parent = tool.parentElement;
    if (!(parent instanceof HTMLElement)) {
      throw new TypeError('expected the toolbar');
    }
    expect(classTokens(parent)).toEqual(expect.arrayContaining(['min-h-11', 'border-y', 'border-line', 'py-2']));
  });

  it('uses MiniTabs href items below the rail', () => {
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="学校管理"
        bypassPrivGate
        navItems={navItems}
        toolbar={<span>工具条</span>}
      >
        正文
      </ModuleWorkspace>,
      { signedIn: true, priv: 0 },
      'schools.html',
    );
    const schools = screen.queryByRole('tab', { name: '学校' });
    const groups = screen.queryByRole('tab', { name: '班级' });
    expect(schools).toBeInstanceOf(HTMLElement);
    expect(groups).toBeInstanceOf(HTMLElement);
    expect(schools?.getAttribute('href')).toBe('/schools');
    expect(groups?.getAttribute('href')).toBe('/groups');
    expect(screen.getByText('正文')).toBeTruthy();
  });

  it('uses a w-60 rail with the same item appearance as the admin sidebar', () => {
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="学校管理"
        bypassPrivGate
        navItems={navItems}
      >
        正文
      </ModuleWorkspace>,
      { signedIn: true, priv: 0 },
      'schools.html',
    );
    const schoolsLinks = screen.getAllByRole('link', { name: '学校' });
    const rail = schoolsLinks.find((link) => selfOrAncestor(link, 'w-60') instanceof HTMLElement);
    expect(rail).toBeInstanceOf(HTMLElement);
    if (!(rail instanceof HTMLElement)) {
      throw new TypeError('expected the module rail link');
    }
    expect(classTokens(rail)).toEqual(expect.arrayContaining([...NAV_ITEM, ...ACTIVE_ITEM]));
    const idleLinks = screen.getAllByRole('link', { name: '班级' });
    const idle = idleLinks.find((link) => selfOrAncestor(link, 'w-60') instanceof HTMLElement);
    expect(idle).toBeInstanceOf(HTMLElement);
    if (!(idle instanceof HTMLElement)) {
      throw new TypeError('expected the idle module rail link');
    }
    expect(classTokens(idle)).toEqual(expect.arrayContaining([...NAV_ITEM, ...IDLE_ITEM]));
  });

  it('renders the toolbar slot with Toolbar', () => {
    const source = readSource('src/components/management/module-workspace.tsx');
    expect(source).toMatch(/import\s*\{[\s\S]*?\bToolbar\b[\s\S]*?\}\s*from\s*['"]@\/components\/ui\/page['"]/);
    expect(source).toContain('<Toolbar');
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="学校管理"
        bypassPrivGate
        navItems={navItems}
        toolbar={<span>工具条</span>}
      >
        正文
      </ModuleWorkspace>,
      { signedIn: true, priv: 0 },
      'schools.html',
    );
    expect(screen.getByText('工具条')).toBeTruthy();
  });

  it('still rejects an unknown activeKey', () => {
    expect(() => {
      renderShell(
        <ModuleWorkspace
          moduleTitle="用户绑定"
          title="学校管理"
          activeKey="missing"
          bypassPrivGate
          navItems={navItems}
        >
          正文
        </ModuleWorkspace>,
        { signedIn: true, priv: 0 },
        'schools.html',
      );
    }).toThrow('Unknown module workspace active key: missing');
  });

  it('still rejects a template that matches no navigation item', () => {
    expect(() => {
      renderShell(
        <ModuleWorkspace
          moduleTitle="用户绑定"
          title="学校管理"
          bypassPrivGate
          navItems={navItems}
        >
          正文
        </ModuleWorkspace>,
        { signedIn: true, priv: 0 },
        'other.html',
      );
    }).toThrow('No module workspace navigation item matches template: other.html');
  });

  it('does not resolve navigation when hideNav is set', () => {
    renderShell(
      <ModuleWorkspace
        moduleTitle="用户绑定"
        title="新建"
        hideNav
        bypassPrivGate
        navItems={navItems}
      >
        表单
      </ModuleWorkspace>,
      { signedIn: false, priv: 0 },
      'create.html',
    );
    expect(screen.getByText('表单')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('admin shell design gate', () => {
  it('reports no DS001, DS002, DS003, or DS015 for the shell files', () => {
    const hits: string[] = [];
    for (const file of LANE_FILES) {
      const output = designGateStdout(file);
      for (const line of output.split('\n')) {
        const match = /^\d+ (DS\d{3}) /.exec(line);
        const rule = match?.[1];
        if (rule && (BANNED_GATE_RULES as readonly string[]).includes(rule)) {
          hits.push(`${file}:${line}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
