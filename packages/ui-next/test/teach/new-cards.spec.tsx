import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { PRIV } from '../../src/lib/perms.ts';

const pageLoaders = import.meta.glob('../../src/pages/teach/new.tsx');
const PAGE_SOURCE = 'src/pages/teach/new.tsx';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageBootstrap(data: Record<string, unknown>, priv: number): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T00:00:00.000Z',
    user: {
      id: 7,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_new.html', data },
  };
}

async function loadTeachNewPage(): Promise<ComponentType> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) load = candidate;
  }
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} must exist`);
  let imported: unknown;
  try {
    imported = await load();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    expect.fail(`${PAGE_SOURCE} failed to load: ${message}`);
  }
  if (!isRecord(imported) || typeof imported.TeachNewPage !== 'function') {
    throw new TypeError('TeachNewPage must be exported');
  }
  return imported.TeachNewPage as ComponentType;
}

function newPayload(): Record<string, unknown> {
  return {
    canCreate: {
      practice: true,
      homework: true,
      exam: true,
      acm: true,
      oi: true,
    },
    initialType: null,
    fromCourse: null,
    copy: null,
  };
}

function radioValues(): string[] {
  return screen.getAllByRole('radio').map((node) => node.getAttribute('value') ?? '');
}

async function renderNew(priv: number) {
  const Page = await loadTeachNewPage();
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={pageBootstrap(newPayload(), priv)}>
        <Page />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('teach new type cards', () => {
  it('shows homework and exam to a non-admin and hides practice, contest, and answer-mode phrases', async () => {
    expect(PRIV.PRIV_EDIT_SYSTEM).toBe(1);
    const user = userEvent.setup();
    await renderNew(0);

    expect(radioValues()).toEqual(['homework', 'exam']);
    expect(screen.getByRole('radio', { name: /^作业/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^考试/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^练习/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^比赛/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^ACM/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^OI/ })).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('比赛');
    expect(document.body.textContent ?? '').not.toContain('逐题作答');
    expect(document.body.textContent ?? '').not.toContain('整卷作答');

    await user.click(screen.getByRole('radio', { name: /^作业/ }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('button', { name: '创建并进入工作台' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('逐题作答');
    expect(document.body.textContent ?? '').not.toContain('整卷作答');

    await user.click(screen.getByRole('button', { name: '上一步' }));
    await user.click(screen.getByRole('radio', { name: /^考试/ }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('button', { name: '创建并进入工作台' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('逐题作答');
    expect(document.body.textContent ?? '').not.toContain('整卷作答');
  });

  it('also shows practice and contest when PRIV_EDIT_SYSTEM is set', async () => {
    await renderNew(PRIV.PRIV_EDIT_SYSTEM);

    expect(radioValues()).toEqual(['practice', 'homework', 'exam', 'contest']);
    expect(screen.getByRole('radio', { name: /^练习/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^作业/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^考试/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^比赛/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^ACM/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^OI/ })).toBeNull();
  });
});
