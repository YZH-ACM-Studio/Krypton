import { Code, Download, Folder, MessageSquare, Printer, Star, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/display';
import { toast } from '@/components/ui/toast';
import type { GenericUserDoc } from '@/lib/bootstrap';
import { downloadBlob } from '@/lib/download-zip';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { ContestBalloonPage, ContestClarificationPage, ContestManagePage, ContestPrintPage, ContestUserPage } from '@/pages/contest-manage';
import { ContestTeamsPage } from '@/pages/contest-teams';
import { ContestManagementContext, type ContestTool } from '@/pages/contest-management-context';
import type { TeachWorkbenchPayload } from '../model';
import { useWorkbenchDirty } from '../settings-kit';

interface ToolItem { value: ContestTool; label: string; icon: typeof Users; endpoint: string }

function toolsFor(payload: TeachWorkbenchPayload): ToolItem[] {
  const links = payload.container.links;
  const items: Array<ToolItem | null> = [
    links.users ? { value: 'users', label: '参赛选手', icon: Users, endpoint: links.users } : null,
    links.clarification ? { value: 'clarification', label: '答疑与公告', icon: MessageSquare, endpoint: links.clarification } : null,
    links.users && payload.container.participationMode !== 'team' && ['acm', 'ioi'].includes(payload.container.rule)
      ? { value: 'unrank', label: '指定打星名单', icon: Star, endpoint: links.users } : null,
    { value: 'files', label: '附件文件', icon: Folder, endpoint: links.files },
    links.code ? { value: 'code', label: '导出代码', icon: Code, endpoint: links.code } : null,
    links.teams ? { value: 'teams', label: '队伍', icon: Users, endpoint: links.teams } : null,
    links.balloon ? { value: 'balloon', label: '气球分发', icon: Trophy, endpoint: links.balloon } : null,
    links.print ? { value: 'print', label: '打印服务', icon: Printer, endpoint: links.print } : null,
  ];
  return items.filter((item): item is ToolItem => item !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readManagementData(value: unknown, id: string, tool: ContestTool) {
  if (!isRecord(value) || !isRecord(value.tdoc) || (value.tdoc.docId ?? value.tdoc._id) !== id) {
    throw new Error('管理页面的数据与当前题目集不一致，请重新读取。');
  }
  const listKey = tool === 'users' || tool === 'unrank' ? 'tsdocs'
    : tool === 'files' ? 'files' : tool === 'clarification' ? 'tcdocs' : tool === 'balloon' ? 'bdocs' : tool === 'teams' ? 'teams' : null;
  if (listKey && !Array.isArray(value[listKey])) throw new Error('管理列表的数据不完整，请重新读取。');
  if (tool === 'files' && !Array.isArray(value.privateFiles)) throw new Error('附件列表的数据不完整，请重新读取。');
  const users: Record<string, GenericUserDoc> = {};
  if (value.udict !== undefined) {
    if (!isRecord(value.udict)) throw new Error('用户数据无效，请重新读取。');
    for (const [key, user] of Object.entries(value.udict)) {
      if (!isRecord(user) || typeof user._id !== 'number' || !Number.isSafeInteger(user._id)
        || (user.uname !== undefined && typeof user.uname !== 'string')) throw new Error('用户数据无效，请重新读取。');
      users[key] = { ...user, _id: user._id, ...(typeof user.uname === 'string' ? { uname: user.uname } : {}) };
    }
  }
  return { data: value, users };
}

async function getManagement(endpoint: string, id: string, tool: ContestTool) {
  const response = await fetchHydroResponse(endpoint, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '管理页面没有加载出来。'));
  const raw = await readJson(response);
  return readManagementData(raw, id, tool);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error('服务器响应无法解析，请重新读取后核对。', { cause });
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ToolContent({ tool }: { tool: ContestTool }) {
  if (tool === 'users' || tool === 'unrank') return <ContestUserPage />;
  if (tool === 'clarification') return <ContestClarificationPage />;
  if (tool === 'files') return <ContestManagePage />;
  if (tool === 'teams') return <ContestTeamsPage />;
  if (tool === 'balloon') return <ContestBalloonPage />;
  if (tool === 'print') return <ContestPrintPage />;
  return null;
}

function CodeExport({ endpoint, title }: { endpoint: string; title: string }) {
  const [range, setRange] = useState<'selected' | 'all'>('selected');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exporting = useRef(false);
  const download = async () => {
    if (exporting.current) return;
    exporting.current = true;
    setBusy(true); setError('');
    try {
      const url = new URL(endpoint, window.location.href);
      url.searchParams.set('all', range === 'all' ? 'true' : 'false');
      const response = await fetchHydroResponse(url.pathname + url.search, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '导出代码失败。'));
      if (!/application\/(?:zip|octet-stream)/i.test(response.headers.get('content-type') ?? '')) throw new Error('服务器没有返回代码压缩包，请重试。');
      downloadBlob(`${title}.zip`, await response.blob());
    } catch (cause) {
      console.error('contest code export failed', { endpoint, cause });
      setError(errorMessage(cause, '导出代码失败。'));
    } finally {
      exporting.current = false; setBusy(false);
    }
  };
  return <Panel title="导出提交代码" description="选择要导出的提交记录，下载为 ZIP 压缩包。">
    <div className="flex flex-col gap-4">
      <MiniTabs
aria-label="代码导出范围"
value={range}
onValueChange={setRange}
items={[
        { value: 'selected', label: '计分提交' }, { value: 'all', label: '全部提交' },
      ]} />
      <div><Button variant="primary" loading={busy} onClick={() => void download()}><Download />下载代码</Button></div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  </Panel>;
}

type Loaded = ReturnType<typeof readManagementData> & { revision: number };

function LoadedTool({ payload, item, items, dirty, onSelect, onDirty }: {
  payload: TeachWorkbenchPayload;
  item: ToolItem;
  items: ToolItem[];
  dirty: boolean;
  onSelect: (item: ToolItem) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const endpoint = useRef(item.endpoint);
  const saving = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async (url = endpoint.current) => {
    const token = ++generation.current;
    const result = await getManagement(url, payload.container.id, item.value);
    if (!mounted.current || generation.current !== token) return;
    endpoint.current = url;
    setLoaded((previous) => ({ ...result, revision: (previous?.revision ?? 0) + 1 }));
    setNeedsRefresh(false);
    setError('');
    onDirty(false);
  }, [item.value, payload.container.id, onDirty]);
  useEffect(() => {
    mounted.current = true;
    void load().catch((cause: unknown) => {
      console.error('contest management load failed', { endpoint: item.endpoint, cause });
      if (mounted.current) setError(errorMessage(cause, '管理页面没有加载出来。'));
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load, item.endpoint]);

  const submit = async (form: HTMLFormElement, submitter?: HTMLElement | null) => {
    if (saving.current || needsRefresh) return;
    saving.current = true;
    setBusy(true);
    setError('');
    let accepted = false;
    let uncertain = false;
    try {
      const data = new FormData(form, submitter ?? undefined);
      const formEndpoint = new URL(form.getAttribute('action') || item.endpoint, window.location.href);
      const allowed = new URL(item.endpoint, window.location.href);
      if (formEndpoint.origin !== allowed.origin || formEndpoint.pathname !== allowed.pathname) throw new Error('操作地址与当前管理页面不一致。');
      if (form.method.toLowerCase() === 'get') {
        const params = new URLSearchParams();
        for (const [key, value] of data) {
          if (typeof value !== 'string') throw new Error('搜索参数无效。');
          params.append(key, value);
        }
        await load(`${allowed.pathname}?${params}`);
        return;
      }
      const body = form.enctype === 'multipart/form-data' ? data : new URLSearchParams();
      if (body instanceof URLSearchParams) {
        for (const [key, value] of data) {
          if (typeof value !== 'string') throw new Error('表单参数无效。');
          body.append(key, value);
        }
      }
      uncertain = true;
      const response = await fetchHydroResponse(item.endpoint, {
        method: 'POST', credentials: 'same-origin', referrer: allowed.href, headers: { Accept: 'application/json' }, body,
      });
      if (!response.redirected && response.status >= 400 && response.status < 500) uncertain = false;
      if (!response.ok) throw new Error(await readHydroResponseError(response, '操作没有完成，请重试。'));
      const result = await readJson(response);
      if (!isRecord(result) || result.error) throw new Error('服务器没有确认操作结果，请重新读取后核对。');
      let refreshUrl = endpoint.current;
      if (result.url !== undefined) {
        if (typeof result.url !== 'string' || !result.url) throw new Error('服务器返回的操作地址无效。');
        const target = new URL(result.url, window.location.href);
        if (target.origin !== allowed.origin || target.pathname !== allowed.pathname) throw new Error('服务器返回了其它页面，请重新读取后核对操作结果。');
        refreshUrl = target.pathname + target.search;
      }
      accepted = true;
      if (!mounted.current) return;
      endpoint.current = refreshUrl;
      onDirty(false);
      await load(refreshUrl);
      toast.success('操作已完成');
    } catch (cause) {
      console.error('contest management operation failed', { endpoint: item.endpoint, accepted, uncertain, cause });
      if (!mounted.current) return;
      setNeedsRefresh(accepted || uncertain);
      setError(accepted ? '操作已完成，但列表刷新失败，请重新读取。'
        : uncertain ? '未能确认操作结果，请重新读取后核对，避免重复提交。' : errorMessage(cause, '操作没有完成，请重试。'));
    } finally {
      saving.current = false; if (mounted.current) setBusy(false);
    }
  };
  const reload = async (url?: string) => {
    if (saving.current) return;
    if (dirty && !needsRefresh && !await confirmDialog('重新读取会丢掉还没提交的修改。', { title: '放弃未提交的修改？', confirmLabel: '放弃修改' })) return;
    saving.current = true; setBusy(true);
    try { await load(url); } catch (cause) {
      console.error('contest management reload failed', { endpoint: url ?? endpoint.current, cause });
      if (mounted.current) setError(errorMessage(cause, '重新读取失败。'));
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  const onSubmit = (event: FormEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    void submit(event.target, (event.nativeEvent as SubmitEvent).submitter);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.download || anchor.target === '_blank') return;
    const url = new URL(anchor.href, window.location.href);
    const destination = items.find((candidate) => {
      const target = new URL(candidate.endpoint, window.location.href);
      return target.origin === url.origin && target.pathname === url.pathname;
    });
    if (!destination) return;
    event.preventDefault();
    if (destination.value !== item.value) onSelect(destination);
    else void reload(url.pathname + url.search);
  };
  return <div className="min-w-0 space-y-4" onSubmit={onSubmit} onClick={onClick} onChange={() => onDirty(true)}>
    {error ? <Alert tone="danger" action={<Button size="sm" disabled={busy} onClick={() => void reload()}>重新读取</Button>}>{error}</Alert> : null}
    {!loaded && !error ? <p role="status" className="flex items-center gap-2 text-sm text-fg-muted"><Spinner />正在读取…</p> : null}
    {loaded ? <ContestManagementContext.Provider value={{ tool: item.value, endpoint: item.endpoint, data: loaded.data, users: loaded.users, submit }}>
      <fieldset disabled={busy || needsRefresh} className="min-w-0" key={loaded.revision} aria-busy={busy}>
        <ToolContent tool={item.value} />
      </fieldset>
    </ContestManagementContext.Provider> : null}
  </div>;
}

export function ManagementTab({ payload }: { payload: TeachWorkbenchPayload }) {
  const items = toolsFor(payload);
  const [selected, setSelected] = useState(() => items.find((item) => item.value === new URLSearchParams(window.location.search).get('tool'))?.value ?? 'users');
  const [dirty, setDirty] = useState(false);
  const { setTabDirty } = useWorkbenchDirty();
  const item = items.find((candidate) => candidate.value === selected) ?? items[0];
  useEffect(() => {
    setTabDirty('management', dirty);
    return () => setTabDirty('management', false);
  }, [dirty, setTabDirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const choose = async (next: ToolItem) => {
    if (next.value === item.value) return;
    if (dirty && !await confirmDialog('切换管理分类会丢掉还没提交的修改。', { title: '放弃未提交的修改？', confirmLabel: '放弃修改' })) return;
    setDirty(false); setSelected(next.value);
    const url = new URL(window.location.href);
    url.searchParams.set('tool', next.value);
    window.history.replaceState(null, '', url.pathname + url.search);
  };
  return <div className="min-w-0 space-y-5">
    <MiniTabs
aria-label="比赛管理分类"
size="md"
value={item.value}
onValueChange={(value) => {
      const next = items.find((candidate) => candidate.value === value);
      if (next) void choose(next);
    }}
items={items} />
    {item.value === 'code' ? <CodeExport endpoint={item.endpoint} title={payload.container.title} />
      : <LoadedTool key={`${payload.container.id}:${item.value}`} payload={payload} item={item} items={items} dirty={dirty} onSelect={(next) => void choose(next)} onDirty={setDirty} />}
  </div>;
}
