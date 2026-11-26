import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap';
import { WorkbenchDirtyProvider } from '@/pages/teach/settings-kit';
import { ManagementTab } from '@/pages/teach/tabs/management';
import type { TeachWorkbenchPayload } from '@/pages/teach/model';

vi.mock('@/components/markdown-renderer', () => ({
  MarkdownEditor: ({ name, value }: { name: string; value: string }) => <textarea aria-label="正文" name={name} defaultValue={value} />,
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@/lib/download-zip', () => ({ downloadBlob: vi.fn() }));

const id = '6af1820a8ac644e01c324e88';
const base = `/contest/${id}`;
const tdoc = { docId: id, title: 'PAT 测试', rule: 'ioi', pids: [1], owner: 7, beginAt: '2026-12-12T05:30:00Z', endAt: '2026-12-12T08:45:00Z' };
const bootstrap = {
  appName: 'Krypton', siteName: 'Krypton', locale: 'zh-CN', theme: 'light', generatedAt: '2026-11-17T00:00:00Z',
  user: { id: 7, name: '教师', signedIn: true, priv: 0, role: 'teacher', canBrowseProblemBank: true },
  domain: { id: 'system', name: '主域' },
  urls: { contestDetail: '/contest/__TID__', userDetail: '/user/__UID__' }, udict: {},
  page: { templateName: 'teach_workbench.html', data: {} },
} as KryptonBootstrap;
const payload = {
  container: { id, type: 'oi', rule: 'ioi', title: 'PAT 测试', participationMode: 'individual', links: {
    users: `${base}/user`, clarification: `${base}/clarification`, files: `${base}/management`, code: `${base}/code`,
    teams: null, balloon: `${base}/balloon`, print: `${base}/print`,
  } },
} as TeachWorkbenchPayload;
interface Call { url: string; method: string; body: RequestInit['body'] }
let calls: Call[];
let failPost: boolean;
let failReadAfterPost: boolean;
let wrongId: boolean;
let losePostResponse: boolean;
let resultUrl: string | undefined;
function serverError(message: string, status: number) { return { error: { name: 'PermissionError', errorCode: 'PermissionError', message, code: status, status, params: [] } }; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function mount(value = payload) {
  return render(<BootstrapProvider bootstrap={bootstrap}><WorkbenchDirtyProvider><ManagementTab payload={value} /></WorkbenchDirtyProvider></BootstrapProvider>);
}
async function select(name: string) { await userEvent.setup().click(screen.getByRole('tab', { name })); }
function posts() { return calls.filter((call) => call.method === 'POST'); }
beforeEach(() => {
  calls = [];
  failPost = false;
  failReadAfterPost = false;
  wrongId = false;
  losePostResponse = false;
  resultUrl = undefined;
  window.history.replaceState(null, '', `/teach/oi/${id}?tab=management`);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), window.location.href);
    const method = init.method ?? 'GET';
    calls.push({ url: url.pathname + url.search, method, body: init.body });
    if (method === 'POST') {
      if (losePostResponse) throw new TypeError('Failed to fetch');
      if (failPost) return response(serverError('没有权限执行这项操作。', 403), 403);
      if (url.pathname.endsWith('/print')) return response({ tasks: [], udict: {} });
      if (resultUrl) return response({ url: resultUrl });
      return response({ ok: true });
    }
    if (failReadAfterPost && posts().length > 0) return response(serverError('读取失败。', 503), 503);
    const doc = wrongId ? { ...tdoc, docId: 'different' } : tdoc;
    if (url.pathname.endsWith('/user')) return response({ tdoc: doc, tsdocs: [{ uid: 8, attend: 1 }], udict: { 8: { _id: 8, uname: '学生八' } }, unrankRoster: { applicable: true, enabled: true, saved: false, uids: [], candidates: [{ uid: 8, realName: '学生八' }] } });
    if (url.pathname.endsWith('/clarification')) return response({ tdoc: doc, tcdocs: [], pdict: {} });
    if (url.pathname.endsWith('/management')) return response({ tdoc: doc, files: [{ name: '题目.pdf', size: 50 }], privateFiles: [{ name: '答案.pdf', size: 40 }], pdict: {} });
    if (url.pathname.endsWith('/print')) return response({ tdoc: doc, isAdmin: true, canSubmitPrint: true });
    if (url.pathname.endsWith('/balloon')) return response({ tdoc: doc, bdocs: [], pdict: {} });
    if (url.pathname.endsWith('/teams')) return response({ tdoc: { ...doc, participationMode: 'team' }, workspaceUrl: `${base}/teams`, teams: [], users: {}, capabilities: { canManage: true, canCreate: true }, teamPage: 1, teamPageCount: 1, vigilRoleSyncWarning: url.searchParams.get('vigilRoleSyncWarning') === '1' });
    if (url.pathname.endsWith('/code')) return new Response('zip', { headers: { 'Content-Type': 'application/zip' } });
    return response({ error: { message: '未知地址。' } }, 404);
  }));
});
afterEach(() => {
 cleanup();
vi.unstubAllGlobals();
});

describe('contest management inside the teaching workbench', () => {
  it('loads the selected contest and renders users without another page shell or sidebar', async () => {
    const { container } = mount();
    expect(await screen.findByText('学生八')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(container.querySelector('[data-slot="page"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: '比赛管理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存打星名单' })).toBeNull();
    expect(calls[0].url).toBe(`${base}/user`);
  });
  it('keeps the designated roster in its own tab and posts the exact operation', async () => {
    mount();
    await screen.findByText('学生八');
    await select('指定打星名单');
    await screen.findByRole('button', { name: '保存打星名单' });
    await userEvent.setup().click(screen.getByRole('checkbox'));
    await userEvent.setup().click(screen.getByRole('button', { name: '保存打星名单' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].url).toBe(`${base}/user`);
    expect(String(posts()[0].body)).toBe('operation=unrank_roster_save&uids=8');
    expect(window.location.pathname).toBe(`/teach/oi/${id}`);
  });
  it('keeps a failed announcement draft and shows the server permission error', async () => {
    mount();
    await screen.findByText('学生八');
    await select('答疑与公告');
    await select('广播');
    fireEvent.change(await screen.findByRole('textbox', { name: '正文' }), { target: { value: '请检查输入格式。' } });
    failPost = true;
    await userEvent.setup().click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('没有权限执行这项操作');
    expect(screen.getByRole('textbox', { name: '正文' })).toHaveValue('请检查输入格式。');
    expect(posts()[0].url).toBe(`${base}/clarification`);
    expect(String(posts()[0].body)).toContain('operation=clarification');
    expect(new URLSearchParams(String(posts()[0].body)).get('content')).toBe('请检查输入格式。');
  });
  it('uploads multipart files with the clicked button operation and never navigates away', async () => {
    const { container } = mount();
    await screen.findByText('学生八');
    await select('附件文件');
    await screen.findByText('题目.pdf');
    const input = container.querySelector<HTMLInputElement>('input[type=file]');
    expect(input).not.toBeNull();
    await userEvent.setup().upload(input!, new File(['attachment'], 'test.txt', { type: 'text/plain' }));
    expect(container.querySelector('input[type=file]')).toBe(input);
    expect(input!.files?.[0]?.name).toBe('test.txt');
    await userEvent.setup().click(screen.getByRole('button', { name: '上传' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = posts()[0].body as FormData;
    expect(posts()[0].url).toBe(`${base}/management`);
    expect(body.get('operation')).toBe('upload_file'); expect(body.get('type')).toBe('public');
    expect(body.get('file')).toBeInstanceOf(File);
  });
  it('confirms a single file deletion and preserves the submitter operation', async () => {
    mount();
    await screen.findByText('学生八');
    await select('附件文件');
    await screen.findByText('题目.pdf');
    await userEvent.setup().click(screen.getByRole('button', { name: '删除' }));
    expect(posts()).toHaveLength(0);
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除文件' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].url).toBe(`${base}/management`);
    const body = new URLSearchParams(String(posts()[0].body));
    expect(body.get('operation')).toBe('delete_files'); expect(body.get('files')).toBe('题目.pdf');
  });
  it('does not repeat an accepted operation when the refresh fails', async () => {
    mount();
    await screen.findByText('学生八');
    await select('指定打星名单');
    await screen.findByRole('button', { name: '保存打星名单' }); failReadAfterPost = true;
    await userEvent.setup().click(screen.getByRole('button', { name: '保存打星名单' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作已完成，但列表刷新失败');
    expect(screen.getByRole('button', { name: '保存打星名单' })).toBeDisabled();
    failReadAfterPost = false;
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(posts()).toHaveLength(1);
  });
  it('rejects a response for another contest', async () => {
    wrongId = true; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('与当前题目集不一致');
    expect(screen.queryByText('学生八')).toBeNull();
  });
  it('requires a fresh read after losing the operation response', async () => {
    mount();
    await screen.findByText('学生八');
    await select('指定打星名单');
    await screen.findByRole('button', { name: '保存打星名单' });
    losePostResponse = true;
    await userEvent.setup().click(screen.getByRole('button', { name: '保存打星名单' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未能确认操作结果');
    expect(screen.getByRole('button', { name: '保存打星名单' })).toBeDisabled();
    expect(posts()).toHaveLength(1);
    losePostResponse = false;
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(posts()).toHaveLength(1);
  });
  it('retains an announcement when cancelling navigation and discards only after confirmation', async () => {
    mount();
    await screen.findByText('学生八');
    await select('答疑与公告');
    await select('广播');
    fireEvent.change(await screen.findByRole('textbox', { name: '正文' }), { target: { value: '保留这段公告' } });
    await select('附件文件');
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(screen.getByRole('textbox', { name: '正文' })).toHaveValue('保留这段公告');
    await select('附件文件');
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }));
    expect(await screen.findByText('题目.pdf')).toBeVisible();
    expect(posts()).toHaveLength(0);
  });
  it('uses the print endpoint for queue operations', async () => {
    mount();
    await screen.findByText('学生八');
    await select('打印服务');
    await screen.findByText('暂无打印任务');
    await waitFor(() => expect(posts().some((call) => call.url === `${base}/print`)).toBe(true));
    expect(posts().every((call) => call.url === `${base}/print`)).toBe(true);
  });
  it('keeps print file selection through workbench dirty state updates', async () => {
    const { container } = mount();
    await screen.findByText('学生八');
    await select('打印服务');
    await screen.findByText('暂无打印任务');
    await select('提交打印');
    const input = container.querySelector<HTMLInputElement>('input[type=file]');
    expect(input).not.toBeNull();
    await userEvent.setup().upload(input!, new File(['print content'], 'print.txt', { type: 'text/plain' }));
    expect(container.querySelector('input[type=file]')).toBe(input);
    expect(input!.files?.[0]?.name).toBe('print.txt');
  });
  it.each([false, true])('uses the same tool redirect to preserve operation warnings (refresh retry: %s)', async (refreshFails) => {
    const value = structuredClone(payload);
    value.container.participationMode = 'team'; value.container.links.teams = `${base}/teams`;
    mount(value);
    await screen.findByText('学生八');
    await select('队伍');
    await screen.findByText('本场还没有有效队伍');
    resultUrl = `${base}/teams?vigilRoleSyncWarning=1`;
    failReadAfterPost = refreshFails;
    // Exercise a real team command through its confirmation portal.
    await userEvent.setup().click(screen.getByRole('button', { name: '以单人队参赛' }));
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认' }));
    if (refreshFails) {
      expect(await screen.findByRole('alert')).toHaveTextContent('操作已完成，但列表刷新失败');
      failReadAfterPost = false;
      await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('Vigil');
    expect(calls.some((call) => call.url === resultUrl && call.method === 'GET')).toBe(true);
    expect(posts()).toHaveLength(1);
  });
  it('does not treat a redirect to another page as a successful command', async () => {
    mount();
    await screen.findByText('学生八');
    await select('指定打星名单');
    await screen.findByRole('button', { name: '保存打星名单' });
    resultUrl = '/login';
    await userEvent.setup().click(screen.getByRole('button', { name: '保存打星名单' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未能确认操作结果');
    expect(screen.getByRole('button', { name: '保存打星名单' })).toBeDisabled();
    expect(calls.some((call) => call.url === '/login')).toBe(false);
  });
  it('downloads code with an explicit all-submissions choice', async () => {
    const { downloadBlob } = await import('@/lib/download-zip');
    mount();
    await screen.findByText('学生八');
    await select('导出代码');
    await select('全部提交');
    await userEvent.setup().click(screen.getByRole('button', { name: '下载代码' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith('PAT 测试.zip', expect.any(Blob)));
    expect(calls.some((call) => call.url === `${base}/code?all=true`)).toBe(true);
  });
  it('offers team management only when the server supplies its link', async () => {
    const value = structuredClone(payload);
    value.container.participationMode = 'team';
    value.container.links.teams = `${base}/teams`;
    mount(value);
    await screen.findByText('学生八');
    await select('队伍');
    expect(await screen.findByText('本场还没有有效队伍')).toBeVisible();
    expect(screen.queryByRole('tab', { name: '指定打星名单' })).toBeNull();
  });
});
