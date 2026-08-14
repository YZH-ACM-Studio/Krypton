import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor, type MarkdownEditorProps } from '../src/components/markdown-renderer';
import { prepareProblemDataWrite, useProblemDataWriteGuard } from '../src/components/problem-data-write-guard';
import { emptyProgrammingStatement } from '../src/components/programming-statement';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import type { AntiAiMarkerDraft } from '../src/lib/anti-ai-marker';
import { AdminAnnounceEditorPage } from '../src/pages/announcement';
import { ProblemEditPage } from '../src/pages/problem-edit';

function imageClipboard(file: File) {
  return {
    items: [
      {
        type: file.type,
        getAsFile: () => file,
      },
    ],
  };
}

function GuardedProblemStatementPaste() {
  const [value, setValue] = useState('题面');
  const guard = useProblemDataWriteGuard(undefined, 'attachment', (operation) => prepareProblemDataWrite('/p/P1000/files', operation));
  const pasteUpload: NonNullable<MarkdownEditorProps['pasteUpload']> = {
    endpoint: '/p/P1000/files',
    meta: { type: 'additional_file' },
    makeUrl: (filename: string) => `file://${filename}`,
    authorize: async (): Promise<Record<string, string> | false> => {
      const confirmation = await guard.confirm('上传题面图片', 'files-upload');
      if (!confirmation) return false;
      return typeof confirmation === 'string' ? { activeContainerConfirmation: confirmation } : {};
    },
  };

  return (
    <>
      <MarkdownEditor value={value} onChange={setValue} pasteUpload={pasteUpload} />
      <output>{value}</output>
      {guard.notice}
      {guard.dialog}
    </>
  );
}

function MarkerProblemStatementPaste() {
  const [value, setValue] = useState('尾部');
  const [markers, setMarkers] = useState<AntiAiMarkerDraft[]>([
    {
      id: 'marker_0001',
      anchor: { path: 'content', offset: 2, affinity: 'after' },
      injectionText: '隐藏提示',
      revision: 1,
    },
  ]);
  return (
    <>
      <MarkdownEditor
        value={value}
        onChange={setValue}
        antiAiPath="content"
        antiAiMarkers={markers}
        onAntiAiMarkersChange={setMarkers}
        pasteUpload={{ endpoint: '/p/P1000/files', makeUrl: (filename) => `file://${filename}` }}
      />
      <output aria-label="marker-paste-source">{value}</output>
      <output aria-label="marker-paste-state">{JSON.stringify(markers)}</output>
    </>
  );
}

function announcementBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-03T00:00:00.000Z',
    user: {
      id: 1,
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
    urls: {} as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'admin_announce_edit.html',
      data: {
        doc: null,
        categories: [{ _id: 'category-1', key: 'announcement', name: '公告', color: 'blue', order: 0, hidden: false, builtin: true }],
        canEditGlobal: true,
      },
    },
  };
}

function problemEditBootstrap(statementFormat: 'legacy' | 'structured-v1'): KryptonBootstrap {
  const programmingStatement = emptyProgrammingStatement();
  programmingStatement.description = { state: 'present', content: '题面' };
  return {
    ...announcementBootstrap(),
    urls: {
      problemDetail: '/p/__PID__',
      problems: '/p',
    } as KryptonBootstrap['urls'],
    page: {
      templateName: 'problem_edit.html',
      data: {
        pdoc: {
          docId: 1000,
          pid: 'P1000',
          title: '图片粘贴联调题',
          content: '题面',
          hidden: true,
          statementFormat: statementFormat === 'structured-v1' ? 'structured-v1' : undefined,
          programmingStatement: statementFormat === 'structured-v1' ? programmingStatement : undefined,
        },
        problemAuthoringCapabilities: { canEditContent: true },
      },
    },
  };
}

function activeContestFetch() {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    if (form.get('operation') === 'prepare_data_write') {
      return new Response(
        JSON.stringify({
          ok: true,
          active: [{ id: 'contest-1', title: '进行中的比赛', rule: 'acm' }],
          canOverride: true,
          confirmationRequestId: 'paste-confirmation',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (form.get('activeContainerConfirmation') !== 'paste-confirmation') {
      return new Response(JSON.stringify({ error: { message: '此题正在进行中的比赛中使用，必须确认后才能上传文件。' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('markdown image paste uploads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads on HTTP origins where crypto.randomUUID exists but is not callable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      },
    });

    render(<MarkerProblemStatementPaste />);
    fireEvent.paste(screen.getByPlaceholderText(/在此输入 Markdown 内容/), {
      clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('filename')).toBe('000102030405460788090a0b0c0d0e0f.png');
  });

  it('gets a fresh active-contest confirmation before uploading a problem statement image', async () => {
    const fetchMock = activeContestFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardedProblemStatementPaste />);
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/);
    fireEvent.paste(editor, { clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })) });

    expect(await screen.findByRole('heading', { name: '确认修改赛中题面附件' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我已确认，继续' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/!\[image\]\(file:\/\/.+\.png\)/));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const uploadForm = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(uploadForm.get('operation')).toBe('upload_file');
    expect(uploadForm.get('type')).toBe('additional_file');
    expect(uploadForm.get('activeContainerConfirmation')).toBe('paste-confirmation');
  });

  it('does not insert a placeholder or upload when active-contest confirmation is cancelled', async () => {
    const fetchMock = activeContestFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardedProblemStatementPaste />);
    fireEvent.paste(screen.getByPlaceholderText(/在此输入 Markdown 内容/), {
      clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })),
    });

    expect(await screen.findByRole('heading', { name: '确认修改赛中题面附件' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: '确认修改赛中题面附件' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/^题面$/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('removes the temporary upload marker when the image upload fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, active: [], canOverride: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              name: 'StorageError',
              errorCode: 'StorageError',
              code: 500,
              status: 500,
              params: [],
              message: '存储服务拒绝了图片',
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardedProblemStatementPaste />);
    fireEvent.paste(screen.getByPlaceholderText(/在此输入 Markdown 内容/), {
      clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })),
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('存储服务拒绝了图片'));
    expect(screen.getByRole('status')).not.toHaveTextContent('uploading-');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['success', new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })],
    [
      'failure',
      new Response(
        JSON.stringify({
          error: {
            name: 'StorageError',
            errorCode: 'StorageError',
            code: 500,
            status: 500,
            params: [],
            message: '存储服务拒绝了图片',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    ],
  ])('remaps a later marker from the latest placeholder state after an async upload %s', async (_result, response) => {
    let resolveUpload: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (resolveUpload = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    render(<MarkerProblemStatementPaste />);
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 0);

    fireEvent.paste(editor, { clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })) });
    await waitFor(() => expect(screen.getByLabelText('marker-paste-source')).toHaveTextContent('uploading-'));
    resolveUpload(response);

    await waitFor(() => expect(screen.getByLabelText('marker-paste-source')).not.toHaveTextContent('uploading-'));
    const source = screen.getByLabelText('marker-paste-source').textContent || '';
    const markerState = JSON.parse(screen.getByLabelText('marker-paste-state').textContent || '[]') as AntiAiMarkerDraft[];
    expect(markerState[0].anchor.offset).toBe(source.indexOf('尾部') + '尾部'.length);
    expect(screen.getByTestId('anti-ai-marker-boundaries')).toHaveTextContent(`位置 ${markerState[0].anchor.offset}`);
  });

  it.each([
    ['legacy', 'legacy'],
    ['structured', 'structured-v1'],
  ] as const)('wires %s problem statements through the production files-upload confirmation', async (_label, statementFormat) => {
    const fetchMock = activeContestFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BootstrapProvider bootstrap={problemEditBootstrap(statementFormat)}>
        <ProblemEditPage />
      </BootstrapProvider>,
    );
    const editor = screen.getAllByPlaceholderText(/在此输入 Markdown 内容/)[0];
    fireEvent.paste(editor, { clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })) });

    expect(await screen.findByRole('heading', { name: '确认修改赛中题面附件' })).toBeInTheDocument();
    const prepareForm = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(prepareForm.get('operation')).toBe('prepare_data_write');
    expect(prepareForm.get('writeOperation')).toBe('files-upload');

    fireEvent.click(screen.getByRole('button', { name: '我已确认，继续' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const uploadForm = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(uploadForm.get('operation')).toBe('upload_file');
    expect(uploadForm.get('activeContainerConfirmation')).toBe('paste-confirmation');
  });

  it('does not send marker state or a structure revision when a legacy marker problem only changes metadata', async () => {
    const bootstrap = problemEditBootstrap('legacy');
    const data = bootstrap.page.data as {
      pdoc: Record<string, unknown>;
      statementWriteGuard?: {
        active: { id: string; title: string }[];
        canOverride: boolean;
        confirmationRequestIds: Record<string, string>;
      };
    };
    data.pdoc.structureRevision = 7;
    data.pdoc.antiAiMarkers = {
      schemaVersion: 1,
      markers: [
        {
          id: 'marker_0001',
          anchor: { path: 'content', offset: 1, affinity: 'after', before: '题', after: '面' },
          injectionText: '隐藏提示',
          revision: 1,
        },
      ],
    };
    data.statementWriteGuard = {
      active: [{ id: 'contest-1', title: '进行中的比赛' }],
      canOverride: true,
      confirmationRequestIds: {},
    };
    let requestBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        requestBody = init?.body as URLSearchParams;
        return new Promise<Response>(() => undefined);
      }),
    );

    render(
      <BootstrapProvider bootstrap={bootstrap}>
        <ProblemEditPage />
      </BootstrapProvider>,
    );
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '只修改标题' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存修改' })[0]);

    await waitFor(() => expect(requestBody).toBeInstanceOf(URLSearchParams));
    expect(requestBody?.get('title')).toBe('只修改标题');
    expect(requestBody?.has('antiAiMarkers')).toBe(false);
    expect(requestBody?.has('expectedStructureRevision')).toBe(false);
    expect(screen.queryByRole('heading', { name: '确认修改赛中题面' })).not.toBeInTheDocument();
  });

  it('uses an inline-display URL for images pasted into announcements', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <BootstrapProvider bootstrap={announcementBootstrap()}>
        <AdminAnnounceEditorPage />
      </BootstrapProvider>,
    );

    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/);
    fireEvent.paste(editor, { clipboardData: imageClipboard(new File(['png'], 'clipboard.png', { type: 'image/png' })) });

    await waitFor(() => {
      const content = document.querySelector<HTMLInputElement>('input[name="content"]')?.value || '';
      expect(content).toMatch(/!\[image\]\(\/file\/1\/.+\.png\?noDisposition=1\)/);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const uploadForm = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(uploadForm.get('operation')).toBe('upload_file');
    expect(uploadForm.get('filename')).toMatch(/\.png$/);
    expect(uploadForm.get('file')).toBeInstanceOf(File);
  });
});
