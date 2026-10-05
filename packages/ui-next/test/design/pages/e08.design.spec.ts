// @vitest-environment node
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap.tsx';
import { ExamEventPage } from '../../../src/pages/exam-infrastructure.tsx';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/exam-infrastructure.tsx';
const EVENT_ID = '66b800000000000000000601';
const RUN_URL = `http://localhost/admin/exam-infrastructure/events/${EVENT_ID}?panel=run`;
const POLICY = { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) };
const TARGET = { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) };

const EVENT = {
  eventId: EVENT_ID,
  schoolId: '66b800000000000000000602',
  title: '校赛网络保障',
  type: 'external',
  contestId: null,
  lifecycle: 'scheduled',
  status: 'scheduled',
  startAt: '2026-08-20T01:00:00.000Z',
  endAt: '2026-08-20T04:00:00.000Z',
  ownerUid: 2,
  collaboratorUids: [3],
  revision: 2,
  updatedAt: '2026-08-10T02:00:00.000Z',
};

const CARD_TAGS = ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'] as const;

interface PreflightProbe {
  endpointId: string;
  ready: boolean;
  online: boolean;
  compatible: boolean | null;
  reason: string;
}

let domInstalled = false;

function assignGlobal(key: string, value: unknown): void {
  const current = Object.getOwnPropertyDescriptor(globalThis, key);
  if (current && current.writable !== true && current.set === undefined) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return;
  }
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}

function installDom(): void {
  if (domInstalled) {
    window.history.replaceState(null, '', RUN_URL);
    return;
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: RUN_URL });
  const view = dom.window;
  assignGlobal('window', view);
  assignGlobal('document', view.document);
  assignGlobal('HTMLElement', view.HTMLElement);
  assignGlobal('Element', view.Element);
  assignGlobal('Node', view.Node);
  assignGlobal('DocumentFragment', view.DocumentFragment);
  assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
  assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  assignGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => view.setTimeout(() => callback(Date.now()), 0));
  assignGlobal('cancelAnimationFrame', (handle: number) => view.clearTimeout(handle));
  view.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof view.matchMedia;
  view.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof view.ResizeObserver;
  view.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof view.IntersectionObserver;
  view.Element.prototype.scrollIntoView = () => undefined;
  view.Element.prototype.hasPointerCapture = () => false;
  view.Element.prototype.setPointerCapture = () => undefined;
  view.Element.prototype.releasePointerCapture = () => undefined;
  assignGlobal('ResizeObserver', view.ResizeObserver);
  assignGlobal('IntersectionObserver', view.IntersectionObserver);
  assignGlobal('MutationObserver', view.MutationObserver);
  domInstalled = true;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function eventBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-11T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0, canManageExamInfrastructure: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_exam_event.html', data: { eventId: EVENT_ID } },
  };
}

function detailFetch(preflight: () => Response): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.endsWith('/network-execution')) return preflight();
    if (url === `/api/admin/exam-events/${EVENT_ID}`) {
      return json({
        event: EVENT,
        schools: [{ schoolId: EVENT.schoolId, name: '计算机学院' }],
        preparation: { assignment: null, publicationRevision: 0, batch: null },
      });
    }
    if (url.startsWith('/api/admin/exam-policy-templates')) return json({ templates: [] });
    if (url.endsWith('/target-assignment')) {
      return json({
        assignment: {
          assignmentId: TARGET.id,
          revision: 1,
          draft: { version: 1, sources: [] },
          revisions: [{
            revision: 1,
            sources: [],
            targetFingerprint: TARGET.fingerprint,
            endpointIds: [],
            targetCount: 0,
            publishedAt: '2026-08-11T02:00:00.000Z',
          }],
          latestPublishedRevision: 1,
        },
        classrooms: [],
        boundEndpoints: [],
      });
    }
    if (url.endsWith('/network-config')) return json({ config: { revision: 2, policy: POLICY, target: TARGET } });
    if (url.endsWith('/network-execution')) return json({ execution: null, updatePreview: null, updatePreviewWarning: null });
    throw new TypeError(`unexpected request: ${url}`);
  });
}

function preflightPayload(items: PreflightProbe[], fingerprint = POLICY.fingerprint): Response {
  return json({
    preflightConfig: { revision: 2, policy: { ...POLICY, fingerprint }, target: TARGET },
    preflight: items.map((item) => ({ ...item, serviceVersion: '0.3.0' })),
  });
}

function badgesByLabel(label: string): Element[] {
  return [...document.querySelectorAll('[data-slot="badge"]')].filter((node) => node.textContent?.trim() === label);
}

function endpointBadge(view: RenderResult, endpointId: string): Element {
  const badge = view.getByText(endpointId).parentElement?.parentElement?.querySelector('[data-slot="badge"]') ?? null;
  expect(badge, endpointId).not.toBeNull();
  return badge ?? view.getByText(endpointId);
}

async function openRun(preflight: () => Response): Promise<{ button: HTMLElement; view: RenderResult }> {
  installDom();
  vi.stubGlobal('fetch', detailFetch(preflight));
  const view = render(createElement(BootstrapProvider, { bootstrap: eventBootstrap() }, createElement(ExamEventPage)));
  const button = await view.findByRole('button', { name: '终端预检' });
  return { button, view };
}

describe('e08 exam infrastructure', () => {
  afterEach(() => {
    if (typeof document !== 'undefined') cleanup();
    vi.unstubAllGlobals();
  });

  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([PAGE]);
  });

  it('页面结构 exam-infrastructure.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('卡片换成 Panel，不再使用 Card', () => {
    const src = readSource(PAGE);
    expect(/from ['"]@\/components\/ui\/panel['"]/.test(src)).toBe(true);
    expect(findOpenTags(src, 'Panel').length).toBeGreaterThan(0);
    expect(/from ['"]@\/components\/ui\/card['"]/.test(src)).toBe(false);
    for (const tag of CARD_TAGS) {
      expect(findOpenTags(src, tag).length, tag).toBe(0);
    }
  });

  it('删除局部 EmptyState，改用共享 empty-state', () => {
    const src = readSource(PAGE);
    const usesSharedEmptyState = /from ['"]@\/components\/ui\/empty-state['"]/.test(src);
    const declaresLocalEmptyState = /(?:function|const|let|class)\s+EmptyState\b/.test(src);
    expect(usesSharedEmptyState).toBe(true);
    expect(declaresLocalEmptyState).toBe(false);
    expect(/<EmptyState\b/.test(src)).toBe(true);
  });

  it('没有当前预检结果时只显示待检，结果对上配置后待检消失', async () => {
    const stale = await openRun(() => preflightPayload([
      { endpointId: 'endpoint-stale', ready: false, online: false, compatible: null, reason: 'endpoint_offline' },
    ], 'c'.repeat(64)));
    expect(badgesByLabel('待检')).toHaveLength(1);
    expect(badgesByLabel('待检')[0]?.getAttribute('data-tone')).toBe('warning');
    expect(badgesByLabel('就绪')).toHaveLength(0);
    expect(badgesByLabel('阻塞')).toHaveLength(0);
    expect(badgesByLabel('未知')).toHaveLength(0);

    fireEvent.click(stale.button);
    await waitFor(() => expect(stale.button).not.toBeDisabled());
    expect(stale.view.queryByText('endpoint-stale')).toBeNull();
    expect(badgesByLabel('待检')).toHaveLength(1);
    expect(badgesByLabel('未知')).toHaveLength(0);

    cleanup();
    vi.unstubAllGlobals();
    const live = await openRun(() => preflightPayload([
      { endpointId: 'endpoint-ready', ready: true, online: true, compatible: true, reason: 'ready' },
    ]));
    fireEvent.click(live.button);
    expect(await live.view.findByText('endpoint-ready')).toBeTruthy();
    expect(badgesByLabel('待检')).toHaveLength(0);
  });

  it('空预检结果不能当成就绪，也不能替换待检', async () => {
    // [] 是真值，且 [].every(ready) 恒为 true；空结果必须继续是待检，不能变成 success 的「0/0 就绪」。
    const opened = await openRun(() => preflightPayload([]));
    expect(badgesByLabel('待检')).toHaveLength(1);
    expect(badgesByLabel('待检')[0]?.getAttribute('data-tone')).toBe('warning');

    fireEvent.click(opened.button);
    await waitFor(() => expect(opened.button).not.toBeDisabled());

    expect(badgesByLabel('待检')).toHaveLength(1);
    expect(badgesByLabel('待检')[0]?.getAttribute('data-tone')).toBe('warning');
    expect(badgesByLabel('就绪')).toHaveLength(0);
    const readySummaries = [...document.querySelectorAll('[data-slot="badge"]')].filter((node) => (
      /^\d+\/\d+ 就绪$/.test(node.textContent?.trim() ?? '')
    ));
    expect(readySummaries).toHaveLength(0);
    const successReady = [...document.querySelectorAll('[data-slot="badge"]')].filter((node) => (
      node.getAttribute('data-tone') === 'success' && (node.textContent ?? '').includes('就绪')
    ));
    expect(successReady).toHaveLength(0);
  });

  it('离线且 compatible 为 null 显示未知，不兼容显示阻塞，就绪显示 success', async () => {
    const opened = await openRun(() => preflightPayload([
      { endpointId: 'endpoint-ready', ready: true, online: true, compatible: true, reason: 'ready' },
      { endpointId: 'endpoint-unknown', ready: false, online: false, compatible: null, reason: 'endpoint_offline' },
      { endpointId: 'endpoint-blocked', ready: false, online: false, compatible: false, reason: 'endpoint_incompatible' },
    ]));
    fireEvent.click(opened.button);

    expect(await opened.view.findByText('endpoint-unknown')).toBeTruthy();
    const unknownRow = opened.view.getByText('endpoint-unknown').parentElement?.parentElement;
    expect(unknownRow?.textContent).toContain('离线');
    expect(endpointBadge(opened.view, 'endpoint-unknown').textContent?.trim()).toBe('未知');
    expect(endpointBadge(opened.view, 'endpoint-unknown').getAttribute('data-tone')).toBe('neutral');
    expect(endpointBadge(opened.view, 'endpoint-blocked').textContent?.trim()).toBe('阻塞');
    expect(endpointBadge(opened.view, 'endpoint-blocked').getAttribute('data-tone')).toBe('danger');
    expect(endpointBadge(opened.view, 'endpoint-ready').textContent?.trim()).toBe('就绪');
    expect(endpointBadge(opened.view, 'endpoint-ready').getAttribute('data-tone')).toBe('success');
    expect(badgesByLabel('待检')).toHaveLength(0);
  });

  it('活动状态用状态点，草稿和已归档保持中性徽标', () => {
    const src = readSource(PAGE);
    const start = src.indexOf('function statusBadge');
    const end = src.indexOf('\nfunction ', start + 1);
    const body = src.slice(start, end);
    expect(body).toContain('<StatusDot tone="success" pulse />');
    expect(body).toContain('<StatusDot tone="info" />');
    expect(body).toContain('<StatusDot />');
    expect(body).toContain('{label}');
    expect(body).not.toContain('<Badge tone="warning"');
    expect(body).not.toContain('<Badge tone="success"');
    expect(body).not.toContain('<Badge tone="info"');
    expect(body).toContain('<Badge tone="neutral">');
  });
});
