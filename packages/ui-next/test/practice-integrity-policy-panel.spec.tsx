import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PracticeIntegrityPolicyPanel } from '../src/components/practice-integrity-policy-panel';

const containerId = '66b800000000000000000021';
const endpoint = `/practice-integrity/course/${containerId}`;

const emptyPolicy = {
  prohibitExternalCodeInjection: false,
  removeIndependentSubmitForm: false,
  antiAiCopyInjection: false,
};

const enabledPolicy = {
  prohibitExternalCodeInjection: true,
  removeIndependentSubmitForm: false,
  antiAiCopyInjection: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function postedFields(init?: RequestInit) {
  return Object.fromEntries(new URLSearchParams(String(init?.body || '')));
}

function postedCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([, init]) => init && typeof init === 'object' && 'method' in init && init.method === 'POST')
    .map(([, init]) => postedFields(init as RequestInit));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('practice integrity teacher policy panel', () => {
  it('publishes from an empty container with one save-and-publish action', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({ published: null, draft: null });
      }
      const fields = postedFields(init);
      expect(fields.operation).toBe('saveAndPublish');
      expect(fields.expectedDraftVersion).toBe('0');
      expect(fields.prohibitExternalCodeInjection).toBe('true');
      return jsonResponse({
        published: {
          revision: 1,
          state: 'published',
          policy: enabledPolicy,
          publishedAt: '2026-09-17T08:00:00.000Z',
          updatedAt: '2026-09-17T08:00:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    expect(await screen.findByRole('button', { name: '发布到学生' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '仅保存草稿' })).toBeEnabled();
    expect(screen.getByText('还没有发布过策略，学生不受限制。')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /禁止粘贴或拖入外部代码/ }));
    await user.click(screen.getByRole('button', { name: '发布到学生' }));

    await waitFor(() => expect(screen.getByText('已发布第 1 版，学生现在会按该版生效。')).toBeInTheDocument());
    expect(screen.getByText('学生当前生效：第 1 版。')).toBeInTheDocument();
    expect(postedCalls(fetchMock)).to.deep.equal([
      {
        operation: 'saveAndPublish',
        expectedDraftVersion: '0',
        prohibitExternalCodeInjection: 'true',
        removeIndependentSubmitForm: 'false',
        antiAiCopyInjection: 'false',
      },
    ]);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(endpoint);
  });

  it('saves a dirty existing draft before publishing it', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({
          published: {
            revision: 1,
            state: 'published',
            policy: emptyPolicy,
            publishedAt: '2026-09-16T08:00:00.000Z',
            updatedAt: '2026-09-16T08:00:00.000Z',
          },
          draft: {
            revision: 2,
            state: 'draft',
            draftVersion: 3,
            policy: enabledPolicy,
            updatedAt: '2026-09-17T08:00:00.000Z',
          },
        });
      }
      const fields = postedFields(init);
      expect(fields.operation).toBe('saveAndPublish');
      expect(fields.expectedDraftVersion).toBe('3');
      expect(fields.removeIndependentSubmitForm).toBe('true');
      return jsonResponse({
        published: {
          revision: 2,
          state: 'published',
          policy: { ...enabledPolicy, removeIndependentSubmitForm: true },
          publishedAt: '2026-09-17T08:01:00.000Z',
          updatedAt: '2026-09-17T08:01:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    expect(await screen.findByText('学生当前生效：第 1 版。 有未发布草稿（版本 3）。')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /只许用题面内的 Krypton IDE 提交/ }));
    await user.click(screen.getByRole('button', { name: '发布到学生' }));
    await waitFor(() => expect(screen.getByText('已发布第 2 版，学生现在会按该版生效。')).toBeInTheDocument());
    expect(postedCalls(fetchMock).map((fields) => fields.operation)).to.deep.equal(['saveAndPublish']);
  });

  it('publishes a clean existing draft without writing another draft version', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({
          published: {
            revision: 1,
            state: 'published',
            policy: emptyPolicy,
            publishedAt: '2026-09-16T08:00:00.000Z',
            updatedAt: '2026-09-16T08:00:00.000Z',
          },
          draft: {
            revision: 2,
            state: 'draft',
            draftVersion: 4,
            policy: enabledPolicy,
            updatedAt: '2026-09-17T08:03:00.000Z',
          },
        });
      }
      const fields = postedFields(init);
      expect(fields.operation).toBe('publish');
      expect(fields.expectedDraftVersion).toBe('4');
      return jsonResponse({
        published: {
          revision: 2,
          state: 'published',
          policy: enabledPolicy,
          publishedAt: '2026-09-17T08:02:00.000Z',
          updatedAt: '2026-09-17T08:02:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    expect(await screen.findByText(/有未发布草稿（版本 4）。/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发布到学生' }));
    await waitFor(() => expect(screen.getByText('已发布第 2 版，学生现在会按该版生效。')).toBeInTheDocument());
    expect(postedCalls(fetchMock)).to.have.length(1);
    expect(postedCalls(fetchMock)[0].operation).toBe('publish');
  });

  it('turns policy off by publishing a new all-false revision, not by mutating the old one', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({
          published: {
            revision: 1,
            state: 'published',
            policy: enabledPolicy,
            publishedAt: '2026-09-16T08:00:00.000Z',
            updatedAt: '2026-09-16T08:00:00.000Z',
          },
          draft: null,
        });
      }
      const fields = postedFields(init);
      expect(fields.operation).toBe('saveAndPublish');
      expect(fields.expectedDraftVersion).toBe('0');
      expect(fields.prohibitExternalCodeInjection).toBe('false');
      expect(fields.removeIndependentSubmitForm).toBe('false');
      expect(fields.antiAiCopyInjection).toBe('false');
      return jsonResponse({
        published: {
          revision: 2,
          state: 'published',
          policy: emptyPolicy,
          publishedAt: '2026-09-17T08:04:00.000Z',
          updatedAt: '2026-09-17T08:04:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    expect(await screen.findByText('学生当前生效：第 1 版。')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /禁止粘贴或拖入外部代码/ }));
    await user.click(screen.getByRole('button', { name: '发布到学生' }));
    await waitFor(() => expect(screen.getByText('已发布第 2 版，学生现在会按该版生效。')).toBeInTheDocument());
    expect(postedCalls(fetchMock)[0]).to.include({
      operation: 'saveAndPublish',
      expectedDraftVersion: '0',
      prohibitExternalCodeInjection: 'false',
    });
  });

  it('keeps 仅保存草稿 as an optional draft-only write', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return jsonResponse({ published: null, draft: null });
      expect(postedFields(init).operation).toBe('save');
      return jsonResponse({
        draft: {
          revision: 1,
          state: 'draft',
          draftVersion: 1,
          policy: enabledPolicy,
          updatedAt: '2026-09-17T08:00:00.000Z',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    await screen.findByRole('button', { name: '仅保存草稿' });
    await user.click(screen.getByRole('checkbox', { name: /禁止粘贴或拖入外部代码/ }));
    await user.click(screen.getByRole('button', { name: '仅保存草稿' }));
    await waitFor(() => expect(screen.getByText('草稿已保存。学生在你点「发布到学生」之前不会受影响。')).toBeInTheDocument());
    expect(postedCalls(fetchMock)).to.have.length(1);
    expect(postedCalls(fetchMock)[0].operation).toBe('save');
    expect(screen.getByText(/有未发布草稿（版本 1）。/)).toBeInTheDocument();
  });

  it('keeps writes disabled when the current policy cannot be loaded', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    render(<PracticeIntegrityPolicyPanel containerKind="course" containerId={containerId} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布到学生' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '仅保存草稿' })).toBeDisabled();
    expect(postedCalls(fetchMock)).to.deep.equal([]);
  });
});
