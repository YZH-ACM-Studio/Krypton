import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { RealPassManagePage } from '../src/pages/realpass-manage.tsx';

function makeBootstrap(data: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-07-26T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'realpass_manage.html', data },
  };
}

function renderPage(data: Record<string, unknown>) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <RealPassManagePage />
    </BootstrapProvider>,
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('real-pass management page', () => {
  it('renders recorded statistics, migration diagnostics and pagination from bootstrap data', () => {
    renderPage({
      pdocs: [
        {
          docId: 42,
          pid: 'CAUC0042',
          title: '并查集',
          origStat: {
            accepted: 25,
            submitted: 100,
            updatedAt: '2026-07-25T12:00:00.000Z',
            updatedBy: 2,
          },
        },
      ],
      page: 2,
      ppcount: 3,
      pcount: 1,
      q: 'CAUC',
      migration: {
        at: '2026-07-25T12:00:00.000Z',
        total: 2,
        ok: 0,
        unmatched: [{ _id: 'OLD-1', accepted: 3, submitted: 7 }],
        conflicts: [{ _id: '42', accepted: 8, submitted: 10, byDocId: 42, byPid: 99 }],
      },
    });

    expect(screen.getByRole('heading', { name: '赛时通过率管理' })).not.to.equal(null);
    expect(screen.getByRole('link', { name: '并查集' }).getAttribute('href')).to.equal('/p/CAUC0042');
    expect(screen.getByText('25/100')).not.to.equal(null);
    expect(screen.getByText('25%')).not.to.equal(null);
    expect(screen.getByText(/未匹配：OLD-1 → 3\/7/)).not.to.equal(null);
    expect(screen.getByText(/冲突：42 → docId #42 \/ pid #99/)).not.to.equal(null);
    expect(screen.getByRole('link', { name: '上一页' }).getAttribute('href')).to.equal('/manage/realpass?page=1&q=CAUC');
    expect(screen.getByRole('link', { name: '下一页' }).getAttribute('href')).to.equal('/manage/realpass?page=3&q=CAUC');
  });

  it('rejects an incomplete single-item form without sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ pdocs: [], page: 1, ppcount: 1, pcount: 0, q: '', migration: null });

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('题目ID、通过数、提交数都要填')).not.to.equal(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews a batch through the JSON endpoint without performing a write', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [
          {
            status: 'ok',
            line: 'CAUC0042 25 100',
            pid: 'CAUC0042',
            docId: 42,
            title: '并查集',
            accepted: 25,
            submitted: 100,
          },
        ],
        summary: { total: 1, ok: 1, unmatched: 0, conflict: 0, invalid: 0, duplicate: 0 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ pdocs: [], page: 1, ppcount: 1, pcount: 0, q: '', migration: null });

    await user.type(screen.getByPlaceholderText(/每行：题目ID/), 'CAUC0042 25 100');
    await user.click(screen.getByRole('button', { name: '预览（不写入）' }));

    expect(await screen.findByText(/批量预览 · 共 1 行/)).not.to.equal(null);
    expect(screen.getByText('25/100')).not.to.equal(null);
    expect((screen.getByRole('button', { name: '确认写入（1 条）' }) as HTMLButtonElement).disabled).to.equal(false);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).to.equal('/manage/realpass');
    expect(init.method).to.equal('POST');
    expect(init.headers).to.deep.equal({ Accept: 'application/json' });
    const form = init.body as FormData;
    expect(form.get('operation')).to.equal('batch');
    expect(form.get('payload')).to.equal('CAUC0042 25 100');
    expect(form.get('commit')).to.equal('false');
  });

  it('invalidates a completed preview as soon as the textarea changes', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ pdocs: [], page: 1, ppcount: 1, pcount: 0, q: '', migration: null });

    const textarea = screen.getByPlaceholderText(/每行：题目ID/);
    await user.type(textarea, 'OLD 1 2');
    await user.click(screen.getByRole('button', { name: '预览（不写入）' }));
    resolveResponse?.(
      jsonResponse({
        rows: [{ status: 'ok', line: 'OLD 1 2', accepted: 1, submitted: 2 }],
        summary: { total: 1, ok: 1, unmatched: 0, conflict: 0, invalid: 0, duplicate: 0 },
      }),
    );

    expect(await screen.findByText(/批量预览 · 共 1 行/)).not.to.equal(null);
    await waitFor(() => expect((textarea as HTMLTextAreaElement).readOnly).to.equal(false));
    await user.clear(textarea);
    await user.type(textarea, 'NEW 3 4');

    expect(screen.queryByText(/批量预览/)).to.equal(null);
    expect(screen.queryByText('1/2')).to.equal(null);
  });

  it('surfaces a server error message from a failed preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: { message: '批量输入包含冲突题号' },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage({ pdocs: [], page: 1, ppcount: 1, pcount: 0, q: '', migration: null });

    await user.type(screen.getByPlaceholderText(/每行：题目ID/), '42 1 2');
    await user.click(screen.getByRole('button', { name: '预览（不写入）' }));

    expect(await screen.findByText('批量输入包含冲突题号')).not.to.equal(null);
    expect(screen.queryByText(/批量预览/)).to.equal(null);
  });
});
