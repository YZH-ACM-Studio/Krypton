/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, PID, with sidebar navigation and delete.
 */

import { AlertCircle, ArrowRight, CheckCircle2, Download, Eye, EyeOff, FileText, Loader2, Lock, Save, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { ManagedProgrammingAuthorControl, ManagedProgrammingTrainingControl, ManagedReviewPanel } from '@/components/managed-programming-authority';
import {
  ManagedProblemTrainingStatus,
  type ManagedTrainingOptionView,
  type ManagedTrainingPlacementView,
} from '@/components/problem-authoring-state';
import { ProblemEditorWorkspace } from '@/components/problem-editor-workspace';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { downloadProblemPackage } from '@/lib/problem-package';
import { managedSourceFieldViews, managedSourceTagPreview, type ManagedSourceTemplateOption } from '@/lib/managed-problem-source';
import { readHydroResponseError, readProblemSaveSuccess } from '@/lib/problem-save-response';

type R = Record<string, any>;

interface ManagedMindmapOption {
  id: string;
  label: string;
  tags: string[];
}

interface ProgrammingTagState {
  mode: 'managed' | 'converted' | 'unconverted';
  sourceTags: string[];
  selectedNodeIds: string[];
  suggestions?: Array<{ tag: string; nodeId: string; label: string }>;
  ambiguousTags?: Array<{ tag: string; candidates: string[] }>;
  unknownTags?: string[];
}

interface ProgrammingTagPreview {
  sourceTags: string[];
  selectedNodeIds: string[];
  nextTags: string[];
  retainedTags: string[];
  addedTags: string[];
  removedTags: string[];
  fingerprint: string;
}

const DIFFICULTY_OPTIONS = [
  { value: '', label: '未评定' },
  { value: 1, label: '入门' },
  { value: 2, label: '普及−' },
  { value: 3, label: '普及/提高−' },
  { value: 4, label: '普及+/提高' },
  { value: 5, label: '提高+/省选−' },
  { value: 6, label: '省选/NOI−' },
  { value: 7, label: '省选/NOI' },
  { value: 8, label: 'NOI/NOI+' },
  { value: 9, label: 'NOI+/CTSC' },
  { value: 10, label: 'CTSC/IOI' },
];

/* ---------- Permits panel ---------- */

interface PermitRow {
  _id: string;
  pid: number;
  uid: number;
  role: 'verifier' | 'author' | 'maintainer';
  grantedBy: number;
  grantedAt: string;
  viaContest: string | null;
  note: string;
}

interface ContributionRow {
  _id: string;
  pid: number;
  uid: number;
  scope: 'data' | 'tag';
  active: boolean;
  status: 'pending' | 'completed';
  note?: string;
  assignedBy: number;
  assignedAt: string;
  updatedBy: number;
  updatedAt: string;
  firstCompletedAt?: string;
}

type PermitRole = PermitRow['role'];

const PERMIT_ROLE_LABELS: Record<PermitRole, string> = {
  verifier: '验题人',
  author: '出题人',
  maintainer: '维护者',
};

function PermitsPanel({ pid, pdocId, hidden, managed }: { pid: string; pdocId: number; hidden: boolean; managed: boolean }) {
  const bs = useBootstrap();
  const [permits, setPermits] = useState<PermitRow[]>([]);
  const [udict, setUdict] = useState<Record<string, { _id: number; uname: string }>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PermitRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<DomainUserOption[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [grantableRoles, setGrantableRoles] = useState<PermitRole[]>([]);
  const [canManageMaintainers, setCanManageMaintainers] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PermitRole>('verifier');
  const apiPid = String(pdocId || pid);

  const refresh = useCallback(async () => {
    setLoadError('');
    setLoaded(false);
    try {
      const r = await fetch(`/p/${apiPid}/permits`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(await readHydroResponseError(r, '权限列表加载失败'));
      const j = await r.json();
      if (!Array.isArray(j?.permits)) throw new Error('权限列表响应格式错误');
      setPermits(j.permits || []);
      setUdict(j.udict || {});
      const roles: PermitRole[] = Array.isArray(j.grantableRoles)
        ? j.grantableRoles.filter((role: unknown): role is PermitRole => typeof role === 'string' && role in PERMIT_ROLE_LABELS)
        : [];
      setGrantableRoles(roles);
      setCanManageMaintainers(j.canManageMaintainers === true);
      setSelectedRole((current) => (roles.includes(current) ? current : roles[0] || 'verifier'));
      setLoaded(true);
    } catch (error) {
      console.error('Failed to load problem permits', error);
      setLoadError(error instanceof Error ? error.message : '权限列表加载失败');
      setLoaded(true);
    }
  }, [apiPid]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const searchUsers = useCallback(
    async (query: string): Promise<DomainUserOption[]> => {
      setInviteError('');
      try {
        return await loadDomainUsers(bs.domain?.id || 'system', query);
      } catch (error) {
        console.error('Failed to search problem collaborators', error);
        setInviteError(error instanceof Error ? error.message : '用户搜索失败');
        throw error;
      }
    },
    [bs.domain?.id],
  );

  async function revoke() {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    setLoadError('');
    const fd = new FormData();
    fd.set('permitId', revokeTarget._id);
    try {
      const r = await fetch(`/p/${apiPid}/permits/revoke`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        setLoadError(await readHydroResponseError(r, '撤销权限失败'));
        return;
      }
      setRevokeTarget(null);
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '撤销权限失败');
    } finally {
      setRevokeBusy(false);
    }
  }

  async function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteError('');
    if (!selectedUsers.length) {
      setInviteError('请选择至少一个用户');
      return;
    }
    setInviteBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('uids', selectedUsers.map((u) => String(u._id)).join(','));
      const r = await fetch(`/p/${apiPid}/permits`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        setInviteError(await readHydroResponseError(r, '发送邀请失败'));
        return;
      }
      setSelectedUsers([]);
      setOpen(false);
      await refresh();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : '发送邀请失败');
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <section aria-labelledby="collaboration-heading" className="rounded-2xl border border-border/70 bg-card/30">
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="collaboration-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            出题协作
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">管理出题人、验题人与维护者；所有变更仍由服务端能力校验。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm" variant="ghost">
            <a href="/permits/inbox">我的验题任务</a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={!loaded || !grantableRoles.length || (!hidden && !managed)}
          >
            添加协作者
          </Button>
        </div>
      </header>
      <div className="space-y-2 p-5">
        {!hidden && !managed ? (
          <p className="text-xs text-muted-foreground">题目当前不是隐藏状态，无需邀请验题人。把题目设为「隐藏」并保存后即可邀请。</p>
        ) : null}
        {loadError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {loadError}
          </p>
        ) : !loaded ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : permits.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有协作者</p>
        ) : (
          <ul className="divide-y">
            {permits.map((p) => (
              <li key={p._id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{udict[p.uid]?.uname || `uid:${p.uid}`}</span>
                    <Badge variant={p.role === 'maintainer' ? 'default' : 'secondary'} className="text-[10px]">
                      {PERMIT_ROLE_LABELS[p.role]}
                    </Badge>
                    {p.viaContest ? (
                      <Badge variant="outline" className="text-[10px]">
                        通过比赛邀请
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    由 {udict[p.grantedBy]?.uname || `uid:${p.grantedBy}`} 邀请于 {new Date(p.grantedAt).toLocaleString('zh-CN')}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                {p.role !== 'maintainer' || canManageMaintainers ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRevokeTarget(p)}>
                    撤销
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setInviteError('');
        }}
      >
        <DialogContent className="w-full overflow-visible sm:w-[560px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>添加题目协作者</DialogTitle>
          </DialogHeader>
          <form method="post" action={`/p/${apiPid}/permits`} className="space-y-4 p-5" onSubmit={submitInvite}>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">用户 UID</label>
              <MultiSelect<DomainUserOption>
                value={selectedUsers}
                onChange={(next) => {
                  setSelectedUsers(next);
                  if (next.length) setInviteError('');
                }}
                loadOptions={searchUsers}
                getKey={(u) => String(u._id)}
                getLabel={domainUserSearchLabel}
                renderChip={(u) => (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{u.uname || `uid:${u._id}`}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">#{u._id}</span>
                  </span>
                )}
                renderOption={(u) => <DomainUserSearchOption user={u} />}
                name="uids"
                placeholder="输入 UID / 用户名 / 邮箱搜索"
                emptyText="没有找到用户"
                minHeight={44}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="permit-role">
                角色
              </label>
              <SimpleSelect
                id="permit-role"
                name="role"
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as PermitRole)}
                options={grantableRoles.map((role) => ({ value: role, label: PERMIT_ROLE_LABELS[role] }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="permit-note">
                附言（可选，会附在通知里）
              </label>
              <Input id="permit-note" name="note" placeholder="例：帮我测一下边界数据" />
            </div>
            {inviteError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {inviteError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={inviteBusy}>
                取消
              </Button>
              <Button type="submit" disabled={inviteBusy || selectedUsers.length === 0}>
                {inviteBusy ? '发送中…' : '发送邀请'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !revokeBusy) setRevokeTarget(null);
        }}
      >
        <DialogContent className="w-full sm:w-[460px]" onClose={() => !revokeBusy && setRevokeTarget(null)}>
          <DialogHeader>
            <DialogTitle>确认撤销协作权限</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              确定撤销
              <span className="mx-1 font-medium text-foreground">
                {revokeTarget ? udict[revokeTarget.uid]?.uname || `uid:${revokeTarget.uid}` : ''}
              </span>
              的{revokeTarget ? PERMIT_ROLE_LABELS[revokeTarget.role] : '协作'}权限？
            </p>
            {loadError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {loadError}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={revokeBusy} onClick={() => setRevokeTarget(null)}>
                取消
              </Button>
              <Button type="button" variant="destructive" disabled={revokeBusy} onClick={revoke}>
                {revokeBusy ? <Loader2 className="mr-1 size-4 animate-spin motion-reduce:animate-none" /> : null}
                确认撤销
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ContributionsPanel({ pid, pdocId, structureRevision }: { pid: string; pdocId: number; structureRevision?: number }) {
  const bs = useBootstrap();
  const apiPid = String(pdocId || pid);
  const [rows, setRows] = useState<ContributionRow[]>([]);
  const [udict, setUdict] = useState<Record<string, { _id: number; uname: string }>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<DomainUserOption[]>([]);
  const [dataScope, setDataScope] = useState(true);
  const [tagScope, setTagScope] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ContributionRow | null>(null);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setError('');
    try {
      const response = await fetch(`/p/${apiPid}/contributions`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '贡献分工加载失败'));
      const body = await response.json();
      if (!Array.isArray(body?.contributions)) throw new Error('贡献分工响应格式错误');
      setRows(body.contributions);
      setUdict(body.udict || {});
    } catch (cause) {
      console.error('Failed to load problem contributions', cause);
      setError(cause instanceof Error ? cause.message : '贡献分工加载失败');
    } finally {
      setLoaded(true);
    }
  }, [apiPid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const searchUsers = useCallback(
    async (query: string) => {
      try {
        return await loadDomainUsers(bs.domain?.id || 'system', query);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '用户搜索失败');
        throw cause;
      }
    },
    [bs.domain?.id],
  );

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser[0] || (!dataScope && !tagScope)) {
      setError('请选择一个用户和至少一项贡献范围');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    form.set('pids', String(pdocId));
    form.set('expectedRevisions', JSON.stringify({ [pdocId]: Number(structureRevision ?? 0) }));
    form.set('uid', String(selectedUser[0]._id));
    form.set('scopes', [dataScope ? 'data' : '', tagScope ? 'tag' : ''].filter(Boolean).join(','));
    form.set('requestId', crypto.randomUUID());
    try {
      const response = await fetch('/problem-contributions/bulk', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (Array.isArray(body?.failed) && body.failed.length) {
          throw new Error(
            `分配未全部完成（requestId: ${body.requestId || '未知'}）：${body.failed
              .map((failure: R) => `${failure.publicPid || failure.pid} / ${failure.scope}: ${failure.message}`)
              .join('；')}`,
          );
        }
        throw new Error(await readHydroResponseError(response, '分配贡献任务失败'));
      }
      setSelectedUser([]);
      setDataScope(true);
      setTagScope(false);
      setAssignOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分配贡献任务失败');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(row: ContributionRow, operation: 'reopen' | 'revoke') {
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('uid', String(row.uid));
    form.set('scope', row.scope);
    form.set('requestId', crypto.randomUUID());
    if (operation === 'reopen') form.set('status', 'pending');
    try {
      const response = await fetch(operation === 'reopen' ? `/p/${apiPid}/contributions/status` : `/p/${apiPid}/contributions/revoke`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, operation === 'reopen' ? '重开任务失败' : '撤销贡献范围失败'));
      setRevokeTarget(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : operation === 'reopen' ? '重开任务失败' : '撤销贡献范围失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="contribution-heading" className="rounded-2xl border border-border/70 bg-card/30">
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="contribution-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            数据与标签协作
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">贡献范围彼此独立；完成只记录进度，不会撤销权限或触发发布。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm" variant="ghost">
            <a href="/permits/inbox">我的出题协作</a>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAssignOpen(true)} disabled={!loaded}>
            分配贡献任务
          </Button>
        </div>
      </header>
      <div className="space-y-3 p-5">
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {!loaded ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有数据或标签贡献分工</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((row) => (
              <li key={row._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{udict[row.uid]?.uname || `uid:${row.uid}`}</span>
                    <Badge variant="secondary">{row.scope === 'data' ? '数据贡献者' : '标签贡献者'}</Badge>
                    <Badge variant={row.active && row.status === 'pending' ? 'outline' : 'secondary'}>
                      {!row.active ? '已撤销' : row.status === 'completed' ? '已完成' : '待完成'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    由 {udict[row.assignedBy]?.uname || `uid:${row.assignedBy}`} 分配于 {new Date(row.assignedAt).toLocaleString('zh-CN')}
                    {row.note ? ` · ${row.note}` : ''}
                  </p>
                  {row.firstCompletedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">首次完成于 {new Date(row.firstCompletedAt).toLocaleString('zh-CN')}</p>
                  ) : null}
                </div>
                {row.active ? (
                  <div className="flex shrink-0 gap-2">
                    {row.status === 'completed' ? (
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => mutate(row, 'reopen')}>
                        重开
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setRevokeTarget(row)}>
                      撤销
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={assignOpen} onOpenChange={(open) => !busy && setAssignOpen(open)}>
        <DialogContent className="w-full sm:w-[560px]" onClose={() => !busy && setAssignOpen(false)}>
          <DialogHeader>
            <DialogTitle>分配数据 / 标签贡献任务</DialogTitle>
          </DialogHeader>
          <form className="space-y-4 p-5" onSubmit={assign}>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">目标用户</label>
              <MultiSelect<DomainUserOption>
                value={selectedUser}
                onChange={(next) => setSelectedUser(next.length ? [next[next.length - 1]] : [])}
                loadOptions={searchUsers}
                getKey={(user) => String(user._id)}
                getLabel={domainUserSearchLabel}
                renderChip={(user) => `${user.uname || `uid:${user._id}`} · UID ${user._id}`}
                renderOption={(user) => <DomainUserSearchOption user={user} />}
                placeholder="输入 UID / 用户名 / 邮箱搜索"
                emptyText="没有找到用户"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-muted-foreground">贡献范围</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={dataScope} onCheckedChange={setDataScope} />
                数据贡献者
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={tagScope} onCheckedChange={setTagScope} />
                标签贡献者
              </label>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="contribution-note" className="text-xs text-muted-foreground">
                备注（可选，会进入任务箱和站内信）
              </label>
              <Input id="contribution-note" name="note" placeholder="例：补齐边界数据并跑一遍验证程序" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setAssignOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy || !selectedUser[0] || (!dataScope && !tagScope)}>
                {busy ? <Loader2 className="mr-1 size-4 animate-spin motion-reduce:animate-none" /> : null}
                确认分配
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && !busy && setRevokeTarget(null)}>
        <DialogContent className="w-full sm:w-[460px]" onClose={() => !busy && setRevokeTarget(null)}>
          <DialogHeader>
            <DialogTitle>确认撤销贡献范围</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">撤销后将立即停止后续写权限；已经记录的首次完成署名仍会保留。</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRevokeTarget(null)}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !revokeTarget}
                onClick={() => revokeTarget && mutate(revokeTarget, 'revoke')}
              >
                {busy ? <Loader2 className="mr-1 size-4 animate-spin motion-reduce:animate-none" /> : null}
                确认撤销
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ---------- Main edit page ---------- */

export function ProblemEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const capabilities: R = data.problemAuthoringCapabilities || {};
  const isCreate = !pdoc.docId;
  const managedExisting = pdoc.authoringMode === 'managed' || capabilities.managed === true;
  const managed = managedExisting || isCreate;
  const canAssignManagedAuthor = isCreate && data.canAssignManagedAuthor === true;
  const canAssignManagedTraining = isCreate && data.canAssignManagedTraining === true;
  const initialProgrammingTagState: ProgrammingTagState = data.programmingTagState || {
    mode: 'managed',
    sourceTags: [],
    selectedNodeIds: (pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String),
  };
  const [programmingTagState, setProgrammingTagState] = useState<ProgrammingTagState>(initialProgrammingTagState);
  const programmingTagMode = isCreate ? 'managed' : programmingTagState.mode;
  const pidEditable = !managed && programmingTagMode === 'unconverted';
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const additionalFiles: R[] = data.additional_file || [];
  const testdataFiles: R[] = data.testdata || pdoc.data || [];
  const canEditContent = isCreate || capabilities.canEditContent === true;
  const canEditData = !isCreate && capabilities.canEditData === true;
  const canEditTags = !isCreate && capabilities.canEditTags === true;
  const canEditDraftMetadata = isCreate || capabilities.canEditDraftMetadata === true;
  const canPublish = !isCreate && capabilities.canPublish === true;
  const canDelete = !isCreate && capabilities.canDelete === true;
  const canManageCollaborators = !isCreate && capabilities.canManageCollaborators === true;
  const canManageContributions = !isCreate && capabilities.canManageContributions === true;
  const canReviewManaged = managed && !isCreate && capabilities.canPublish === true;
  const collaborationEnabled = !isCreate && (canManageCollaborators || canManageContributions || canReviewManaged);
  const requestedSection = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('section');
  const showCollaboration = requestedSection === 'collaboration' && collaborationEnabled;
  const managedMetadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft';
  const canSubmitManagedWorkingTitle = isCreate || (managedMetadataDraft && canEditDraftMetadata);
  const filesBase = pdoc.docId ? `${problemUrl}/files` : '';

  const rawContent = pdoc.content || '';
  const contentValue =
    typeof rawContent === 'string' || (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent))
      ? rawContent
      : String(rawContent || '');
  const [draftContent, setDraftContent] = useState<string | R>(contentValue);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const editVersion = useRef(0);

  const [persistedTags, setPersistedTags] = useState<string[]>(pdoc.tag || []);
  const [persistedStructureRevision, setPersistedStructureRevision] = useState<number | undefined>(pdoc.structureRevision);
  const [hiddenValue, setHiddenValue] = useState(isCreate || !!pdoc.hidden);
  const [lockHiddenValue, setLockHiddenValue] = useState(!!pdoc.lockHidden);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const sourceTemplates: ManagedSourceTemplateOption[] = data.managedSourceTemplates || [];
  const mindmapOptions: ManagedMindmapOption[] = data.programmingMindmapOptions || data.managedMindmapOptions || [];
  const trainingOptions: ManagedTrainingOptionView[] = data.managedTrainingOptions || [];
  const managedTrainingPlacements: ManagedTrainingPlacementView[] = data.managedTrainingPlacements || [];
  const initialTemplate = pdoc.sourceMeta?.template || sourceTemplates[0]?.id || '';
  const [sourceTemplate, setSourceTemplate] = useState(initialTemplate);
  const [sourceYear, setSourceYear] = useState(String(pdoc.sourceMeta?.year || new Date().getFullYear()));
  const [sourceSeason, setSourceSeason] = useState(String(pdoc.sourceMeta?.season || 'spring'));
  const [sourceLevel, setSourceLevel] = useState(String(pdoc.sourceMeta?.level || 'L1'));
  const [sourceRound, setSourceRound] = useState(String(pdoc.sourceMeta?.round || 1));
  const [selectedManagedAuthors, setSelectedManagedAuthors] = useState<DomainUserOption[]>([]);
  const [managedAuthorSearchError, setManagedAuthorSearchError] = useState('');
  const initialMindmapIds = isCreate ? (pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String) : programmingTagState.selectedNodeIds || [];
  const mindmapOptionsById = new Map(mindmapOptions.map((option) => [option.id, option]));
  const [selectedMindmapNodes, setSelectedMindmapNodes] = useState<ManagedMindmapOption[]>(
    initialMindmapIds.map((id) => mindmapOptionsById.get(id)).filter((option): option is ManagedMindmapOption => !!option),
  );
  const [persistedMindmapNodeIds, setPersistedMindmapNodeIds] = useState(initialMindmapIds);
  const selectedMindmapNodeIds = selectedMindmapNodes.map((node) => node.id);
  const mindmapSelectionChanged =
    selectedMindmapNodeIds.length !== persistedMindmapNodeIds.length ||
    selectedMindmapNodeIds.some((nodeId, index) => nodeId !== persistedMindmapNodeIds[index]);
  const tagSelectionDirty = !isCreate && canEditTags && mindmapSelectionChanged;
  const [tagPreview, setTagPreview] = useState<ProgrammingTagPreview | null>(null);
  const [tagPreviewOpen, setTagPreviewOpen] = useState(false);
  const [tagOperationState, setTagOperationState] = useState<'idle' | 'previewing' | 'applying' | 'saved' | 'error'>('idle');
  const [tagOperationError, setTagOperationError] = useState('');
  const [selectedTrainingId, setSelectedTrainingId] = useState(String(pdoc.managedAuthoring?.pendingTrainingPlacement?.trainingId || ''));
  const [selectedChapterId, setSelectedChapterId] = useState(String(pdoc.managedAuthoring?.pendingTrainingPlacement?.chapterId || ''));
  const selectedTemplateDefinition = sourceTemplates.find((template) => template.id === sourceTemplate);
  const persistedTemplateDefinition = sourceTemplates.find((template) => template.id === pdoc.sourceMeta?.template);
  const persistedSourceFields = managedSourceFieldViews(pdoc.sourceMeta, persistedTemplateDefinition);
  const eligibleTrainings = trainingOptions.filter((training) => training.templates.includes(sourceTemplate));
  const selectedTraining = eligibleTrainings.find((training) => training.id === selectedTrainingId);
  const sourcePreviewTags = managedSourceTagPreview(sourceTemplate, sourceYear, sourceSeason, sourceLevel);
  const editorRevisionKey = JSON.stringify({
    draftContent,
    hiddenValue,
    lockHiddenValue,
    sourceTemplate,
    sourceYear,
    sourceSeason,
    sourceLevel,
    sourceRound,
    managedAuthors: selectedManagedAuthors.map((author) => author._id),
    mindmapNodes: isCreate ? selectedMindmapNodeIds : undefined,
    selectedTrainingId,
    selectedChapterId,
  });
  const previousRevisionKey = useRef(editorRevisionKey);
  const dirtyState = useFormDirtyState(formRef, editorRevisionKey);
  const navigationGuard = useUnsavedChangesGuard(
    (canEditContent && (dirtyState.dirty || saveState === 'saving')) || tagSelectionDirty || tagOperationState === 'applying',
  );

  const searchManagedAuthors = useCallback(
    async (query: string): Promise<DomainUserOption[]> => {
      setManagedAuthorSearchError('');
      try {
        return await loadDomainUsers(bs.domain?.id || 'system', query);
      } catch (error) {
        console.error('Failed to search managed problem authors', error);
        setManagedAuthorSearchError(error instanceof Error ? error.message : '用户搜索失败');
        throw error;
      }
    },
    [bs.domain?.id],
  );

  useEffect(() => {
    if (!selectedTrainingId || eligibleTrainings.some((training) => training.id === selectedTrainingId)) return;
    setSelectedTrainingId('');
    setSelectedChapterId('');
  }, [eligibleTrainings, selectedTrainingId]);

  useEffect(() => {
    if (previousRevisionKey.current === editorRevisionKey) return;
    previousRevisionKey.current = editorRevisionKey;
    editVersion.current += 1;
  }, [editorRevisionKey]);

  useEffect(() => {
    setSaveState((current) => {
      if (current === 'saving' || current === 'error') return current;
      if (dirtyState.dirty) return 'dirty';
      return current === 'dirty' ? 'idle' : current;
    });
  }, [dirtyState.dirty]);

  const markDirty = useCallback(() => {
    editVersion.current += 1;
    setSaveError('');
    setSaveState((current) => (current === 'saving' ? current : 'dirty'));
    dirtyState.recompute();
  }, [dirtyState.recompute]);

  const handleDownloadPackage = useCallback(async () => {
    if (isCreate || !problemUrl) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const fd = formRef.current ? new FormData(formRef.current) : null;
      const packagePdoc = fd
        ? {
            ...pdoc,
            pid: String(fd.get('pid') || pdoc.pid || ''),
            title: String(fd.get('title') || pdoc.title || ''),
            tag: persistedTags,
            difficulty: Number(fd.get('difficulty') || pdoc.difficulty || 0),
          }
        : pdoc;
      await downloadProblemPackage({
        pdoc: packagePdoc,
        problemUrl,
        testdata: testdataFiles,
        additionalFiles,
        content: draftContent,
      });
    } catch (e: any) {
      setDownloadError(e?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  }, [additionalFiles, draftContent, isCreate, pdoc, persistedTags, problemUrl, testdataFiles]);

  const requestTagNormalizationPreview = async () => {
    setTagOperationError('');
    if (!selectedMindmapNodeIds.length) {
      setTagOperationError('请至少选择一个知识导图节点。');
      setTagOperationState('error');
      return;
    }
    setTagOperationState('previewing');
    try {
      const response = await fetch(`${problemUrl}/tags/preview`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ knowledgeNodeIds: selectedMindmapNodeIds.join(',') }),
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, response.status === 409 ? '题目或导图已变化，请刷新后重试' : '标签预览失败'));
      }
      const body = await response.json();
      const preview = body?.preview as ProgrammingTagPreview | undefined;
      if (
        !preview ||
        typeof preview.fingerprint !== 'string' ||
        !Array.isArray(preview.selectedNodeIds) ||
        !Array.isArray(preview.nextTags) ||
        !Array.isArray(preview.retainedTags) ||
        !Array.isArray(preview.addedTags) ||
        !Array.isArray(preview.removedTags)
      ) {
        throw new Error('标签预览响应格式错误');
      }
      setTagPreview(preview);
      setTagPreviewOpen(true);
      setTagOperationState('idle');
    } catch (error) {
      console.error('Failed to preview programming tag normalization', error);
      setTagOperationError(error instanceof Error ? error.message : '标签预览失败');
      setTagOperationState('error');
    }
  };

  const confirmTagNormalization = async () => {
    if (!tagPreview) return;
    setTagOperationError('');
    setTagOperationState('applying');
    try {
      const response = await fetch(`${problemUrl}/tags/apply`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          knowledgeNodeIds: tagPreview.selectedNodeIds.join(','),
          intent: 'normalize',
          confirmed: 'true',
          previewFingerprint: tagPreview.fingerprint,
        }),
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, response.status === 409 ? '预览已过期，请重新预览标签变化' : '标签规范化失败'));
      }
      const body = await response.json();
      if (
        body?.ok !== true ||
        body?.programmingTagState?.mode !== 'converted' ||
        (pdoc.problemKind && (!Number.isSafeInteger(body?.structureRevision) || body.structureRevision < 1))
      ) {
        throw new Error('标签规范化响应格式错误');
      }
      const normalizedNodeIds = tagPreview.selectedNodeIds.map(String);
      const normalizedNodes = normalizedNodeIds
        .map((nodeId) => mindmapOptionsById.get(nodeId))
        .filter((option): option is ManagedMindmapOption => !!option);
      setPersistedTags([...tagPreview.nextTags]);
      if (Number.isSafeInteger(body.structureRevision)) setPersistedStructureRevision(body.structureRevision);
      setSelectedMindmapNodes(normalizedNodes);
      setPersistedMindmapNodeIds(normalizedNodeIds);
      setProgrammingTagState({ mode: 'converted', sourceTags: [...tagPreview.sourceTags], selectedNodeIds: normalizedNodeIds });
      setTagPreviewOpen(false);
      setTagPreview(null);
      setTagOperationState('saved');
    } catch (error) {
      console.error('Failed to apply programming tag normalization', error);
      setTagPreviewOpen(false);
      setTagPreview(null);
      setTagOperationError(error instanceof Error ? error.message : '标签规范化失败');
      setTagOperationState('error');
    }
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === 'delete') {
      navigationGuard.allowNavigation();
      setSaveState('saving');
      return;
    }
    e.preventDefault();
    if (!canEditContent) {
      setSaveError('当前贡献范围不能修改题面或基础信息。');
      setSaveState('error');
      return;
    }
    setSaveError('');
    const contentText = typeof draftContent === 'string' ? draftContent : JSON.stringify(draftContent);
    if (!contentText.trim()) {
      const message = '请填写题面正文。';
      setSaveError(message);
      setSaveState('error');
      return;
    }
    if (contentText.length > 65535) {
      const message = '题面正文不能超过 65535 个字符。';
      setSaveError(message);
      setSaveState('error');
      return;
    }
    if (tagSelectionDirty) {
      const message = '知识标签选择尚未确认；请先在“标签与知识导图”中预览并确认标签变化。';
      setTagOperationError(message);
      setTagOperationState('error');
      setSaveError(message);
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    const form = e.currentTarget;
    const fd = new FormData(form);
    const savedVersion = editVersion.current;
    try {
      const editRes = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(fd as any),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!editRes.ok) {
        throw new Error(await readHydroResponseError(editRes, editRes.status === 409 ? '题目已被其他操作修改或锁定，请刷新后重试' : '保存失败'));
      }
      const saved = await readProblemSaveSuccess(editRes, 'programming');
      if (isCreate) {
        if (editVersion.current !== savedVersion) {
          console.warn('Programming problem created, but local form changed during request; navigation withheld', {
            destination: saved.destination,
          });
          setSaveError('服务器已创建提交时的版本，但保存过程中检测到新的本地修改；为避免丢失，未自动跳转。');
          setSaveState('dirty');
          dirtyState.recompute();
          return;
        }
        dirtyState.markClean();
        navigationGuard.allowNavigation();
        setSaveState('saved');
        window.location.assign(saved.destination);
        return;
      }
      if (editVersion.current === savedVersion) {
        dirtyState.markClean();
        navigationGuard.allowNavigation();
        setSaveState('saved');
        window.location.assign(saved.destination);
      } else {
        setSaveState('dirty');
      }
    } catch (error) {
      console.error('Failed to save programming problem metadata', error);
      setSaveError(error instanceof Error ? error.message : '保存失败');
      setSaveState('error');
    }
  };

  const status = (
    <span aria-live="polite" className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground">
      {saveState === 'saving' ? (
        <>
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          保存中
        </>
      ) : null}
      {saveState === 'dirty' ? (
        <>
          <span className="size-1.5 rounded-full bg-amber-500" />
          有未保存修改
        </>
      ) : null}
      {saveState === 'saved' ? (
        <>
          <CheckCircle2 className="size-3.5 text-emerald-600" />
          已保存
        </>
      ) : null}
      {saveState === 'error' ? (
        <>
          <AlertCircle className="size-3.5 text-destructive" />
          保存失败
        </>
      ) : null}
      {saveState === 'idle' && !isCreate ? '已载入服务器版本' : null}
    </span>
  );

  const actions = (
    <>
      {!isCreate && canEditData ? (
        <Button type="button" size="sm" variant="outline" onClick={handleDownloadPackage} disabled={downloading}>
          <Download className="mr-1 size-3.5" />
          {downloading ? '打包中…' : '打包下载'}
        </Button>
      ) : null}
      {canEditContent ? (
        <Button type="submit" form="programming-problem-form" size="sm" className="gap-1.5" disabled={saveState === 'saving'}>
          {saveState === 'saving' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Save className="size-3.5" />}
          {isCreate ? '创建题目' : '保存修改'}
        </Button>
      ) : null}
    </>
  );

  return (
    <ProblemEditorWorkspace
      page={showCollaboration ? 'collaboration' : 'edit'}
      problemUrl={problemUrl}
      title={(managed && pdoc.managedAuthoring?.workingTitle) || pdoc.title || '新建编程题'}
      pid={String(pid)}
      isCreate={isCreate}
      editEnabled={isCreate || canEditContent || canEditTags}
      dataEnabled={canEditData}
      collaborationEnabled={collaborationEnabled}
      status={showCollaboration || !canEditContent ? undefined : status}
      actions={showCollaboration ? undefined : actions}
    >
      {showCollaboration ? (
        <div className="space-y-6">
          {canManageCollaborators ? <PermitsPanel pid={String(pid)} pdocId={pdoc.docId} hidden={!!pdoc.hidden} managed={managed} /> : null}
          {canManageContributions ? <ContributionsPanel pid={String(pid)} pdocId={pdoc.docId} structureRevision={pdoc.structureRevision} /> : null}
          {canReviewManaged ? (
            <ManagedReviewPanel
              pdoc={pdoc}
              sourceTemplates={sourceTemplates}
              trainingOptions={trainingOptions}
              problemsUrl={bs.urls.problems}
              difficultyOptions={DIFFICULTY_OPTIONS}
              reviewPreview={data.managedReviewPreview}
              pendingContributions={data.managedPendingContributions}
              pendingContributionFingerprint={data.managedPendingContributionFingerprint}
              contributionUdict={data.managedContributionUdict}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          {downloadError ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              打包下载失败：{downloadError}
            </p>
          ) : null}
          {saveError ? (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {saveError}
            </p>
          ) : null}

          <form
            id="programming-problem-form"
            ref={formRef}
            method="post"
            onSubmit={handleSave}
            onChange={canEditContent ? markDirty : undefined}
            inert={saveState === 'saving'}
            aria-busy={saveState === 'saving'}
            className="space-y-6"
          >
            {!isCreate && pdoc.problemKind && persistedStructureRevision ? (
              <input type="hidden" name="expectedStructureRevision" value={String(persistedStructureRevision)} />
            ) : null}
            {isCreate && managed ? <input type="hidden" name="managed" value="true" /> : null}

            <section aria-labelledby="problem-content-heading" className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
              <header className="border-b border-border/60 px-5 py-4">
                <h2 id="problem-content-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                  题目内容
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">标题、题号、标签、来源、可见性与题面由同一表单一次保存。</p>
              </header>
              <div className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-title">
                      {managed ? (isCreate || managedMetadataDraft ? '工作标题' : '正式标题') : '标题'}
                    </label>
                    <Input
                      id="edit-title"
                      name={canEditContent && (!managed || canSubmitManagedWorkingTitle) ? 'title' : undefined}
                      defaultValue={managed && !isCreate && managedMetadataDraft ? pdoc.managedAuthoring?.workingTitle || '' : pdoc.title || ''}
                      placeholder={managed ? '用于审核协作，不会直接作为正式标题发布' : '题目标题'}
                      readOnly={!canEditContent || (managed ? !canSubmitManagedWorkingTitle : !canEditDraftMetadata)}
                      required={canEditContent}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-pid">
                      题目编号
                    </label>
                    <Input
                      id="edit-pid"
                      name={canEditContent && pidEditable ? 'pid' : undefined}
                      defaultValue={typeof pid === 'string' ? pid : ''}
                      placeholder={managed ? '由服务端分配' : programmingTagMode === 'converted' ? '规范化后锁定' : '如 P1001'}
                      pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
                      readOnly={!canEditContent || !pidEditable}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="w-full space-y-1.5 sm:w-52">
                    <label className="text-sm font-medium" htmlFor="edit-difficulty">
                      难度
                    </label>
                    {!canEditContent || (managed && !isCreate && !canEditDraftMetadata) ? (
                      <Input
                        id="edit-difficulty"
                        value={DIFFICULTY_OPTIONS.find((option) => Number(option.value) === Number(pdoc.difficulty || 0))?.label || '未评定'}
                        readOnly
                      />
                    ) : (
                      <SimpleSelect
                        id="edit-difficulty"
                        name="difficulty"
                        defaultValue={String(pdoc.difficulty || (managed && isCreate ? 1 : ''))}
                        onValueChange={markDirty}
                        options={DIFFICULTY_OPTIONS.filter((option) => !managed || option.value !== '').map((option) => ({
                          value: String(option.value),
                          label: option.label,
                        }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              {!isCreate && canEditTags ? (
                <div className="border-t border-border/60">
                  <header className="px-5 py-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                      <Tag className="size-4 text-muted-foreground" aria-hidden="true" />
                      标签与知识导图
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {programmingTagMode === 'unconverted'
                        ? '旧标签只用于给出选择建议；普通保存不会改动它们，只有查看完整增删预览并确认后才会规范化。'
                        : '来源标签只读保留；知识标签仅由所选节点及其带标签祖先实时派生。'}
                    </p>
                  </header>
                  <div className="space-y-5 p-5 pt-0">
                    <div className="rounded-xl bg-muted/45 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">只读来源与赛事标签</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {programmingTagState.sourceTags.length ? (
                          programmingTagState.sourceTags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">当前没有可识别的来源标签</span>
                        )}
                      </div>
                    </div>

                    {programmingTagMode === 'unconverted' ? (
                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-xl border border-border/70 px-4 py-3">
                          <p className="text-xs font-semibold">唯一匹配建议</p>
                          <div className="mt-2 space-y-2">
                            {programmingTagState.suggestions?.length ? (
                              programmingTagState.suggestions.map((suggestion) => (
                                <div key={`${suggestion.tag}:${suggestion.nodeId}`} className="text-xs">
                                  <Badge variant="outline">{suggestion.tag}</Badge>
                                  <p className="mt-1 break-words text-muted-foreground">{suggestion.label}</p>
                                </div>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">没有可唯一反推的旧标签</span>
                            )}
                          </div>
                          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">建议已预填选择器，但尚未写入数据库。</p>
                        </div>
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.035] px-4 py-3">
                          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">映射歧义</p>
                          <div className="mt-2 space-y-2">
                            {programmingTagState.ambiguousTags?.length ? (
                              programmingTagState.ambiguousTags.map((entry) => (
                                <div key={entry.tag} className="text-xs">
                                  <Badge variant="outline">{entry.tag}</Badge>
                                  <p className="mt-1 break-words text-muted-foreground">{entry.candidates.join('；')}</p>
                                </div>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">没有同名节点歧义</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-destructive/25 bg-destructive/[0.025] px-4 py-3">
                          <p className="text-xs font-semibold text-destructive">无法识别的历史标签</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {programmingTagState.unknownTags?.length ? (
                              programmingTagState.unknownTags.map((tag) => (
                                <Badge key={tag} variant="destructive">
                                  {tag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">没有无法识别的标签</span>
                            )}
                          </div>
                          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">确认规范化时，这些标签会列入删除项。</p>
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">算法知识点</label>
                      <MultiSelect
                        options={mindmapOptions}
                        value={selectedMindmapNodes}
                        onChange={(next) => {
                          setSelectedMindmapNodes(next);
                          setTagPreview(null);
                          setTagOperationError('');
                          setTagOperationState('idle');
                        }}
                        getKey={(node) => node.id}
                        getLabel={(node) => node.label}
                        getDescription={(node) => node.tags.join(' / ')}
                        placeholder="按完整导图路径搜索，可多选"
                        emptyText="没有可选的带标签节点"
                        disabled={!canEditTags || tagOperationState === 'previewing' || tagOperationState === 'applying'}
                      />
                      <p className="text-xs text-muted-foreground">服务端会重新读取节点与祖先；这里不接受自由标签文本。</p>
                    </div>

                    {tagOperationError ? (
                      <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {tagOperationError}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span aria-live="polite" className="text-xs text-muted-foreground">
                        {tagOperationState === 'saved'
                          ? '标签已按确认内容原子保存'
                          : tagSelectionDirty
                            ? '节点选择尚未确认'
                            : programmingTagMode === 'unconverted'
                              ? '建议选择尚未写入'
                              : '节点选择与服务器一致'}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={requestTagNormalizationPreview}
                        disabled={
                          !selectedMindmapNodes.length ||
                          tagOperationState === 'previewing' ||
                          tagOperationState === 'applying' ||
                          (programmingTagMode !== 'unconverted' && !tagSelectionDirty)
                        }
                      >
                        {tagOperationState === 'previewing' ? <Loader2 className="mr-1 size-3.5 animate-spin motion-reduce:animate-none" /> : null}
                        {programmingTagMode === 'unconverted' ? '预览并规范化标签' : '预览标签变更'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {managed ? (
                <div className="border-t border-border/60">
                  <header className="px-5 py-4">
                    <h3 className="text-sm font-semibold tracking-tight">来源与归档</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isCreate
                        ? canAssignManagedTraining
                          ? '选择固定来源和知识导图节点；PID 与标签仅由服务端计算。训练选择只记录待审核位置。'
                          : '使用自命题来源并选择知识导图节点；作者、PID、标签与隐藏状态均由服务端固定。'
                        : managedMetadataDraft
                          ? '来源、PID 与系统标签已锁定；发布前由管理员审核。'
                          : '来源、PID 与系统标签已锁定；该题已完成审核并发布。'}
                    </p>
                  </header>
                  {isCreate ? (
                    <div className="space-y-5 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="managed-template">
                            来源模板
                          </label>
                          <SimpleSelect
                            id="managed-template"
                            name="template"
                            value={sourceTemplate}
                            onValueChange={(value) => {
                              setSourceTemplate(value);
                              setSelectedTrainingId('');
                              setSelectedChapterId('');
                            }}
                            options={sourceTemplates.map((template) => ({ value: template.id, label: template.label }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium" htmlFor="managed-year">
                            年份
                          </label>
                          <Input
                            id="managed-year"
                            name="year"
                            type="number"
                            min={2000}
                            max={2100}
                            value={sourceYear}
                            onChange={(event) => setSourceYear(event.target.value)}
                            required
                          />
                        </div>
                        {selectedTemplateDefinition?.fields.includes('season') ? (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="managed-season">
                              季度
                            </label>
                            <SimpleSelect
                              id="managed-season"
                              name="season"
                              value={sourceSeason}
                              onValueChange={setSourceSeason}
                              options={[
                                { value: 'spring', label: '春季' },
                                { value: 'summer', label: '夏季' },
                                { value: 'autumn', label: '秋季' },
                                { value: 'winter', label: '冬季' },
                              ]}
                            />
                          </div>
                        ) : null}
                        {selectedTemplateDefinition?.fields.includes('level') ? (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="managed-level">
                              题目等级
                            </label>
                            <SimpleSelect
                              id="managed-level"
                              name="level"
                              value={sourceLevel}
                              onValueChange={setSourceLevel}
                              options={['L1', 'L2', 'L3'].map((value) => ({ value, label: value }))}
                            />
                          </div>
                        ) : null}
                        {selectedTemplateDefinition?.fields.includes('round') ? (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="managed-round">
                              场次
                            </label>
                            <Input
                              id="managed-round"
                              name="round"
                              type="number"
                              min={1}
                              max={99}
                              value={sourceRound}
                              onChange={(event) => setSourceRound(event.target.value)}
                              required
                            />
                            <p className="text-xs text-muted-foreground">场次只进入来源元数据和训练章节，不生成标签。</p>
                          </div>
                        ) : null}
                        <ManagedProgrammingAuthorControl allowed={canAssignManagedAuthor}>
                          <div className="space-y-1.5" role="group" aria-labelledby="managed-author-label">
                            <span id="managed-author-label" className="text-sm font-medium">
                              代指定出题人（可选）
                            </span>
                            <MultiSelect<DomainUserOption>
                              value={selectedManagedAuthors}
                              onChange={(next) => {
                                setSelectedManagedAuthors(next);
                                setManagedAuthorSearchError('');
                                markDirty();
                              }}
                              loadOptions={searchManagedAuthors}
                              getKey={(user) => String(user._id)}
                              getLabel={domainUserSearchLabel}
                              renderChip={(user) => (
                                <span className="inline-flex items-center gap-1">
                                  <span className="font-medium">{user.uname || `uid:${user._id}`}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">#{user._id}</span>
                                </span>
                              )}
                              renderOption={(user) => <DomainUserSearchOption user={user} />}
                              name="authorUid"
                              maxItems={1}
                              placeholder="输入 UID / 用户名 / 邮箱搜索"
                              emptyText="没有找到域内用户"
                              minHeight={44}
                            />
                            <p className="text-xs text-muted-foreground">
                              不选择时默认为当前管理员；代建时只能选择当前域中的一名用户，服务端会再次校验。
                            </p>
                            {managedAuthorSearchError ? (
                              <p role="alert" className="text-xs text-destructive">
                                {managedAuthorSearchError}
                              </p>
                            ) : null}
                          </div>
                        </ManagedProgrammingAuthorControl>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">算法知识点</label>
                        <MultiSelect
                          options={mindmapOptions}
                          value={selectedMindmapNodes}
                          onChange={setSelectedMindmapNodes}
                          getKey={(node) => node.id}
                          getLabel={(node) => node.label}
                          getDescription={(node) => node.tags.join(' / ')}
                          name="mindmapNodeIds"
                          placeholder="从知识导图选择，可多选"
                          emptyText="没有可选的带标签节点"
                        />
                        <p className="text-xs text-muted-foreground">服务端会同时物化每个节点路径上所有带标签的祖先。</p>
                      </div>

                      <ManagedProgrammingTrainingControl allowed={canAssignManagedTraining}>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="managed-training">
                              待挂训练（可选）
                            </label>
                            <SimpleSelect
                              id="managed-training"
                              name="trainingId"
                              value={selectedTrainingId}
                              onValueChange={(value) => {
                                setSelectedTrainingId(value);
                                setSelectedChapterId('');
                              }}
                              options={[
                                { value: '', label: '暂不加入训练' },
                                ...eligibleTrainings.map((training) => ({ value: training.id, label: training.title })),
                              ]}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium" htmlFor="managed-chapter">
                              现有章节
                            </label>
                            <SimpleSelect
                              id="managed-chapter"
                              name={selectedTrainingId ? 'chapterId' : undefined}
                              value={selectedChapterId}
                              onValueChange={setSelectedChapterId}
                              disabled={!selectedTraining}
                              options={[
                                { value: '', label: selectedTraining ? '请选择章节' : '先选择训练' },
                                ...(selectedTraining?.chapters || []).map((chapter) => ({ value: String(chapter.id), label: chapter.title })),
                              ]}
                            />
                          </div>
                        </div>
                      </ManagedProgrammingTrainingControl>

                      <div className="rounded-xl bg-muted/45 px-4 py-3">
                        <p className="text-xs font-medium text-muted-foreground">服务端将生成的来源标签</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {sourcePreviewTags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 p-5 md:grid-cols-2">
                      <div className="grid gap-3 rounded-xl bg-muted/45 px-4 py-3 sm:grid-cols-2">
                        {persistedSourceFields.map((field) => (
                          <div key={field.label}>
                            <p className="text-xs text-muted-foreground">{field.label}</p>
                            <p className="mt-1 text-sm font-medium">{field.value}</p>
                          </div>
                        ))}
                      </div>
                      {canEditContent || canReviewManaged ? (
                        <ManagedProblemTrainingStatus
                          metadataStatus={pdoc.managedAuthoring?.metadataStatus}
                          pendingPlacement={pdoc.managedAuthoring?.pendingTrainingPlacement}
                          trainingOptions={trainingOptions}
                          placements={managedTrainingPlacements}
                        />
                      ) : null}
                      <div className="space-y-3 rounded-xl bg-muted/45 px-4 py-3 md:col-span-2">
                        <div>
                          <p className="text-xs text-muted-foreground">只读来源与赛事标签</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {programmingTagState.sourceTags.length ? (
                              programmingTagState.sourceTags.map((tag) => (
                                <Badge key={tag} variant="secondary">
                                  {tag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">未识别到来源标签</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">当前知识导图节点</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {selectedMindmapNodes.length ? (
                              selectedMindmapNodes.map((node) => (
                                <Badge key={node.id} variant="outline">
                                  {node.label}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">尚未选择知识节点</span>
                            )}
                          </div>
                          {canEditTags ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">知识节点请在上方“标签与知识导图”中预览并确认。</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="border-t border-border/60">
                <header className="px-5 py-4">
                  <h3 className="text-sm font-semibold tracking-tight">题面正文</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {canEditContent ? 'Markdown 内容；粘贴图片继续使用现有附加文件 API。' : '当前贡献范围仅允许只读查看题面。'}
                  </p>
                </header>
                <div className="p-5">
                  {canEditContent ? (
                    <MarkdownEditor
                      name="content"
                      value={draftContent}
                      onChange={(value) => {
                        setDraftContent(value);
                        markDirty();
                      }}
                      minHeight={440}
                      pasteUpload={
                        filesBase
                          ? {
                              endpoint: filesBase,
                              meta: { type: 'additional_file' },
                              makeUrl: (filename) => `file://${filename}`,
                            }
                          : undefined
                      }
                      previewFileUrl={(filename, original) => {
                        const queryIndex = original.indexOf('?');
                        const query = queryIndex >= 0 ? original.slice(queryIndex) : '';
                        return `${problemUrl}/file/${encodeURIComponent(filename)}${query}`;
                      }}
                    />
                  ) : (
                    <MarkdownView content={draftContent} className="prose max-w-none dark:prose-invert" />
                  )}
                </div>
              </div>

              {!isCreate && canEditContent ? (
                <div className="border-t border-border/60">
                  <header className="px-5 py-4">
                    <h3 className="text-sm font-semibold tracking-tight">可见性</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {managed
                        ? managedMetadataDraft
                          ? '托管草稿保持隐藏；管理员从权限与协作页确认元数据并发布。'
                          : '该题已完成审核并发布；可见性仍由管理员按权限维护。'
                        : '发布与维护权限沿用现有模型。'}
                    </p>
                  </header>
                  <div className="grid gap-4 p-5 sm:grid-cols-2">
                    {!isCreate && canPublish ? <input type="hidden" name="hidden" value={hiddenValue ? 'true' : 'false'} /> : null}
                    {!isCreate && canPublish ? <input type="hidden" name="lockHidden" value={lockHiddenValue ? 'true' : 'false'} /> : null}
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                      <Checkbox checked={hiddenValue} disabled={!canPublish} onCheckedChange={setHiddenValue} aria-label="隐藏题目" />
                      <span className="flex items-center gap-1.5 text-sm">
                        {hiddenValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        隐藏题目
                      </span>
                    </label>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                      <Checkbox
                        checked={lockHiddenValue}
                        disabled={managed && !canPublish}
                        onCheckedChange={setLockHiddenValue}
                        aria-label="锁定隐藏"
                      />
                      <span className="flex items-center gap-1.5 text-sm">
                        <Lock className="size-3.5" />
                        锁定隐藏（比赛结束后不自动公开）
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
            </section>

            {!isCreate && canDelete ? (
              <section aria-labelledby="danger-heading" className="rounded-2xl border border-destructive/25 bg-destructive/[0.025] p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 id="danger-heading" className="text-sm font-semibold text-destructive">
                      危险操作
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">删除将同时移除题目文件、提交记录和讨论。</p>
                  </div>
                  {!showDeleteConfirm ? (
                    <Button type="button" variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="mr-1 size-3.5" />
                      删除题目
                    </Button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-destructive">确认永久删除？</span>
                      <Button type="submit" name="operation" value="delete" variant="destructive" size="sm">
                        确认删除
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                        取消
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {canEditContent ? (
              <footer className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">{saveError ? <p className="text-sm text-destructive">{saveError}</p> : status}</div>
                <Button type="submit" className="min-h-11 gap-1.5 sm:min-w-36" disabled={saveState === 'saving'}>
                  {saveState === 'saving' ? (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  ) : isCreate ? (
                    <ArrowRight className="size-4" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {isCreate ? '创建并进入工作区' : '保存修改'}
                </Button>
              </footer>
            ) : null}
          </form>
        </div>
      )}
      <Dialog
        open={tagPreviewOpen}
        onOpenChange={(open) => {
          if (tagOperationState === 'applying') return;
          setTagPreviewOpen(open);
          if (!open) setTagPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{programmingTagMode === 'unconverted' ? '确认规范化历史标签' : '确认知识标签变更'}</DialogTitle>
          </DialogHeader>
          {tagPreview ? (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                以下结果由服务器根据当前题目与实时导图计算。确认后会一次写入节点引用与完整派生标签；取消不会修改数据库。
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '保留', tags: tagPreview.retainedTags, tone: 'border-border/70' },
                  { label: '新增', tags: tagPreview.addedTags, tone: 'border-emerald-500/30 bg-emerald-500/[0.035]' },
                  { label: '删除', tags: tagPreview.removedTags, tone: 'border-destructive/30 bg-destructive/[0.025]' },
                ].map((group) => (
                  <div key={group.label} className={`rounded-xl border px-4 py-3 ${group.tone}`}>
                    <p className="text-xs font-semibold">{group.label}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {group.tags.length ? (
                        group.tags.map((tag, index) => (
                          <Badge key={`${group.label}:${tag}:${index}`} variant={group.label === '删除' ? 'destructive' : 'secondary'}>
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">无</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {tagPreview.removedTags.length ? (
                <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  确认后，上述“删除”标签不会保留为自由文本；如选择有误，请取消并重新选择完整路径节点。
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={tagOperationState === 'applying'}
                  onClick={() => {
                    setTagPreviewOpen(false);
                    setTagPreview(null);
                  }}
                >
                  取消
                </Button>
                <Button type="button" disabled={tagOperationState === 'applying'} onClick={confirmTagNormalization}>
                  {tagOperationState === 'applying' ? <Loader2 className="mr-1 size-4 animate-spin motion-reduce:animate-none" /> : null}
                  确认并保存标签
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {navigationGuard.guardDialog}
    </ProblemEditorWorkspace>
  );
}
