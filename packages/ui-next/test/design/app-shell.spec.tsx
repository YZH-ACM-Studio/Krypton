// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap';
import { router } from '../../src/router';

const packageRoot = resolve(import.meta.dirname, '../..');
const SHELL_FILES = [
  'src/router.tsx',
  'src/main.tsx',
  'src/components/layout/sidebar.tsx',
  'src/components/layout/footer.tsx',
] as const;
const SIDEBAR_KEY = 'krypton:sidebar-collapsed';
const THEME_KEY = 'krypton:theme';

const originalMatchMedia = window.matchMedia;
const originalFetch = globalThis.fetch;

function readSource(file: string): string {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function shellBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-02T00:00:00.000Z',
    user: {
      id: 2,
      name: 'root',
      mail: 'root@example.com',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'default',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: {
      id: 'system',
      name: '主域',
      bulletin: '',
      avatar: '',
    },
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
      ranking: '/ranking',
      discussions: '/discuss',
      domains: '/domain',
      messages: '/home/messages',
      login: '/login',
      register: '/register',
      logout: '/logout',
      settings: '/home/settings',
      security: '/home/security',
      files: '/file',
      records: '/record',
      domainDashboard: '/domain/dashboard',
      domainPermission: '/domain/permission',
      manage: '/manage',
      status: '/manage/status',
      problemDetail: '/p/{pid}',
      contestDetail: '/contest/{tid}',
      homeworkDetail: '/homework/{tid}',
      trainingDetail: '/training/{tid}',
      discussionDetail: '/discuss/{did}',
      discussionNode: '/discuss/node/{name}',
      userDetail: '/user/{UID}',
      recordDetail: '/record/{rid}',
    },
    udict: {},
    page: {
      templateName: 'main.html',
      data: {},
    },
  };
}

function installMatchMedia(viewportPx: number): void {
  window.matchMedia = ((query: string) => {
    const minWidth = /^\(min-width:\s*(\d+)px\)$/.exec(query);
    const width = minWidth?.[1];
    const matches = width !== undefined && viewportPx >= Number(width);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    };
  }) as unknown as typeof window.matchMedia;
}

function installFetch(): void {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ count: 0, docs: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  globalThis.fetch = fetchMock as typeof fetch;
}

async function renderShell(): Promise<void> {
  await router.load();
  render(
    <BootstrapProvider bootstrap={shellBootstrap()}>
      <RouterProvider router={router} />
    </BootstrapProvider>,
  );
}

// The mobile drawer is `fixed`. The rail is the in-flow aside. jsdom does not apply Tailwind `hidden`.
function visibleHomeLabels(): HTMLElement[] {
  return screen.queryAllByText('首页').filter((element) => {
    if (element.getAttribute('role') === 'tooltip' || element.closest('[role="tooltip"]') !== null) {
      return false;
    }
    const aside = element.closest('aside');
    if (!(aside instanceof HTMLElement)) {
      return false;
    }
    return !classTokens(aside).includes('fixed');
  });
}

function gateResult(file: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', file], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
    throw new TypeError(`design-gate did not return a status for ${file}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(SIDEBAR_KEY);
  document.documentElement.classList.remove('dark');
  installFetch();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.fetch = originalFetch;
});

describe('app shell source', () => {
  it('drops the frosted theme toggle and reads the shared preference', () => {
    const source = readSource('src/router.tsx');
    expect(source).not.toContain('backdrop-blur');
    expect(source).not.toContain('THEME_KEY');
    expect(source).not.toContain('toggleTheme');
    expect(source).toContain('useThemePreference(');
    expect(source).toContain('has-[>[data-slot=page]]:p-0');
    expect(source).toContain('--workspace-h');
  });

  it('uses the icon rail and expanded sidebar widths', () => {
    const source = readSource('src/components/layout/sidebar.tsx');
    expect(source).not.toContain('rounded-[14px]');
    expect(source).not.toContain('text-[10px]');
    expect(source).toContain('w-14');
    expect(source).toContain('w-60');
  });

  it('wraps the router in MotionConfig reducedMotion user', () => {
    const source = readSource('src/main.tsx');
    expect(source).toContain('MotionConfig');
    expect(source).toContain('reducedMotion="user"');
  });

  it('is clean under design-gate --file', () => {
    for (const file of SHELL_FILES) {
      const result = gateResult(file);
      expect(result.status, `${file}\n${result.stdout}\n${result.stderr}`).toBe(0);
    }
  });
});

describe('default app shell', () => {
  it('shows the system theme control and applies dark from the dark control', async () => {
    installMatchMedia(1280);
    await renderShell();
    expect(screen.getAllByLabelText('跟随系统').length).toBeGreaterThan(0);
    const darkControl = screen.getAllByLabelText('暗色')[0];
    if (!(darkControl instanceof HTMLElement)) {
      throw new TypeError('expected a dark theme control');
    }
    fireEvent.click(darkControl);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('expands the sidebar at 1280px when no preference is stored', async () => {
    installMatchMedia(1280);
    await renderShell();
    expect(visibleHomeLabels().length).toBeGreaterThan(0);
  });

  it('collapses the sidebar between 1024px and 1279px when no preference is stored', async () => {
    installMatchMedia(1024);
    await renderShell();
    expect(visibleHomeLabels().length).toBe(0);
  });

  it('lets a stored collapsed preference override the wide default', async () => {
    localStorage.setItem(SIDEBAR_KEY, '1');
    installMatchMedia(1280);
    await renderShell();
    expect(visibleHomeLabels().length).toBe(0);
  });

  it('lets a stored expanded preference override the tablet default', async () => {
    localStorage.setItem(SIDEBAR_KEY, '0');
    installMatchMedia(1024);
    await renderShell();
    expect(visibleHomeLabels().length).toBeGreaterThan(0);
  });

  it('sets --workspace-h from 48px before the first measurement', async () => {
    installMatchMedia(1280);
    await renderShell();
    const styled = document.querySelector('[style*="--workspace-h"]');
    expect(styled).toBeInstanceOf(HTMLElement);
    expect(styled?.getAttribute('style') ?? '').toContain('calc(100dvh - 48px)');
  });
});
