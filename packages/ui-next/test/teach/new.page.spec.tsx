import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
const TITLE = '第一章作业';
const DRAFT_ID = '64b8000000000000000000aa';

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

async function renderNew(priv: number, data = newPayload()) {
  const Page = await loadTeachNewPage();
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={pageBootstrap(data, priv)}>
        <Page />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

function installLocationAssign(): () => void {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...saved,
      href: saved.href,
      origin: saved.origin,
      pathname: saved.pathname,
      search: saved.search,
      hash: saved.hash,
      assign,
    },
  });
  return () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
}

function locationAssign(): ReturnType<typeof vi.fn> {
  const assign: unknown = Reflect.get(window.location, 'assign');
  if (typeof assign !== 'function' || !('mock' in assign)) throw new TypeError('location.assign is not a mock');
  return assign as ReturnType<typeof vi.fn>;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonBody(input: RequestInfo | URL, init: RequestInit | undefined): unknown {
  const raw = init?.body ?? (input instanceof Request ? input.body : undefined);
  if (typeof raw !== 'string') throw new TypeError('draft request body must be a JSON string');
  return JSON.parse(raw) as unknown;
}

function expectNoAnswerModeCopy() {
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('逐题作答');
  expect(text).not.toContain('整卷作答');
}

let restoreLocation: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restoreLocation?.();
  restoreLocation = null;
  vi.unstubAllGlobals();
});

describe('teach new homework draft', () => {
  it('creates a homework draft and opens the problems tab', async () => {
    expect(PRIV.PRIV_EDIT_SYSTEM).toBe(1);
    restoreLocation = installLocationAssign();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ id: DRAFT_ID }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderNew(0);
    expectNoAnswerModeCopy();

    await user.click(screen.getByRole('radio', { name: /^作业/ }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    const titleBox = await screen.findByRole('textbox');
    await user.type(titleBox, TITLE);
    expectNoAnswerModeCopy();

    await user.click(screen.getByRole('button', { name: '创建并进入工作台' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new TypeError('draft request was not sent');
    const [input, init] = call;
    expect(requestUrl(input)).toBe('/teach/draft');
    expect(jsonBody(input, init)).toEqual({ kind: 'homework', title: TITLE });

    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalled();
    });
    const target: unknown = locationAssign().mock.calls[0]?.[0];
    expect(target).toEqual(expect.stringContaining(`/teach/homework/${DRAFT_ID}`));
    expect(target).toEqual(expect.stringContaining('tab=problems'));
    expectNoAnswerModeCopy();
  });
});

it('copies a configured competition with its purpose, not the exam route type', async () => {
  const restore = installLocationAssign();
  try {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: DRAFT_ID }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    fetchMock.mockRejectedValueOnce(new Error('复制失败，请重试'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderNew(PRIV.PRIV_EDIT_SYSTEM, {
      ...newPayload(),
      copy: {
        type: 'exam', setPurpose: 'contest', rule: 'contest', id: DRAFT_ID,
        title: '校赛', content: '', description: '', ownerUid: 7, ownerName: '老师', mine: true,
        beginAt: null, endAt: null, durationMinutes: null, pids: [], problems: [], scores: {},
        examPaperQuotas: null, stages: null, unusablePids: [],
        settings: { kind: 'contest', rated: false, autoHide: false, hidden: false, lockMinutes: null,
          allowViewCode: false, allowPrint: false, keepScoreboardHidden: false, allowVirtual: null,
          allowPostContestPractice: null, allowPostContestView: null, allowPostContestSubmit: null,
          langs: [], examShowVerdict: null, examPassScore: null, examAttemptLimit: null },
      },
    });
    expect(screen.getByRole('heading', { name: '新建比赛' })).toBeInTheDocument();
    const title = screen.getByRole('textbox', { name: /^标题/ });
    await user.clear(title);
    await user.type(title, '第二场校赛');
    await user.type(screen.getByRole('textbox', { name: /^说明/ }), '新说明');
    await user.click(screen.getByRole('button', { name: /创建.*工作台/ }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(locationAssign()).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /创建.*工作台/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requests = fetchMock.mock.calls;
    const request = requests.find(([url]) => requestUrl(url) === '/teach/draft');
    expect(request).toBeDefined();
    if (!request) throw new Error('复制请求未发出');
    expect(jsonBody(...request)).toMatchObject({ kind: 'contest', sourceId: DRAFT_ID, title: '第二场校赛', statement: '新说明' });
  } finally { restore(); }
});
