import { type FormEvent, useCallback, useState } from 'react';
import { Activity, BookKey, Hash, Pencil, Plus, Power, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { readHydroResponseError } from '@/lib/problem-save-response';

type MemberRole = 'author' | 'manager';

interface PidNamespaceMember {
  uid: number;
  role: MemberRole;
  editAll: boolean;
}

interface PidNamespaceView {
  namespaceId: string;
  kind: 'builtin' | 'custom';
  name: string;
  enabled: boolean;
  revision: number;
  members: PidNamespaceMember[];
  sourceTemplates: string[];
  pidPattern: string;
  prefix?: string;
  start?: number;
  counter: number | null;
  allocated: boolean;
  counterEntries: Array<{ scope: string; value: number }>;
}

interface NamespaceAudit {
  _id: string;
  operation?: string;
  action?: string;
  namespaceId: string;
  operator: number;
  problemId?: number;
  result: 'attempt' | 'success' | 'rejected' | 'incomplete';
  requestId: string;
  time: string;
}

interface PidNamespacesPageData {
  pidNamespaces?: PidNamespaceView[];
  namespaceAudits?: NamespaceAudit[];
  memberUsers?: Record<string, DomainUserOption>;
  pidNamespaceUrl?: string;
  canAdministerPidNamespaces?: boolean;
  problemReviewUrl?: string;
}

type NamespaceDialog =
  | { type: 'create' }
  | { type: 'config'; namespace: PidNamespaceView }
  | { type: 'member'; namespace: PidNamespaceView; member?: PidNamespaceMember }
  | { type: 'delete'; namespace: PidNamespaceView }
  | null;

async function postNamespaceOperation(endpoint: string, fields: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '题号命名空间操作失败'));
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('服务器未返回明确的 JSON 成功结果');
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || payload.ok !== true) throw new Error('服务器未确认题号命名空间操作成功');
  return payload as Record<string, unknown>;
}

function namespaceCounterLabel(namespace: PidNamespaceView) {
  if (namespace.counter === null) return '尚未初始化';
  if (namespace.counterEntries.length <= 1) return String(namespace.counter);
  return `${namespace.counterEntries.length} 个年度范围 · 最大 ${namespace.counter}`;
}

function memberName(memberUsers: Record<string, DomainUserOption>, uid: number) {
  const profile = memberUsers[String(uid)];
  if (!profile) return `UID ${uid}`;
  return profile.displayName && profile.displayName !== profile.uname
    ? `${profile.displayName}（${profile.uname || `UID ${uid}`}）`
    : profile.uname || `UID ${uid}`;
}

function auditOperationLabel(operation = '') {
  const labels: Record<string, string> = {
    create: '创建命名空间',
    'config.update': '更新配置',
    'member.set': '更新成员',
    'member.remove': '移除成员',
    delete: '删除命名空间',
    'pid.allocate': '分配题号',
    'problem.correct': '纠正题目归属',
    'review.update': '保存审核信息',
    'review.return': '退回题目',
    'review.publish': '发布题目',
  };
  return labels[operation] || operation || '命名空间操作';
}

export function ProblemPidNamespacesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as PidNamespacesPageData;
  const namespaces = data.pidNamespaces || [];
  const namespaceAudits = data.namespaceAudits || [];
  const memberUsers = data.memberUsers || {};
  const endpoint = String(data.pidNamespaceUrl || '');
  const isAdmin = data.canAdministerPidNamespaces === true;
  const [dialog, setDialog] = useState<NamespaceDialog>(null);
  const [selectedUsers, setSelectedUsers] = useState<DomainUserOption[]>([]);
  const [role, setRole] = useState<MemberRole>('author');
  const [editAll, setEditAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!endpoint) throw new Error('题号命名空间接口缺失');

  const searchUsers = useCallback((query: string) => loadDomainUsers(bs.domain?.id || 'system', query), [bs.domain?.id]);

  function openMember(namespace: PidNamespaceView, member?: PidNamespaceMember) {
    const profile = member ? memberUsers[String(member.uid)] : undefined;
    setSelectedUsers(member ? [profile || { _id: member.uid, uname: `UID ${member.uid}` }] : []);
    setRole(member?.role || 'author');
    setEditAll(member?.editAll || false);
    setError('');
    setDialog({ type: 'member', namespace, member });
  }

  async function submit(event: FormEvent<HTMLFormElement>, fields: Record<string, string>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postNamespaceOperation(endpoint, fields);
      window.location.reload();
    } catch (cause) {
      console.error('PID namespace operation failed', cause);
      setError(cause instanceof Error ? cause.message : '题号命名空间操作失败');
      setBusy(false);
    }
  }

  return (
    <main className="w-full min-w-0 space-y-6 overflow-x-clip pb-12">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">统一题库 · 作用域权限</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">题号命名空间</h1>
          <p className="max-w-[68ch] text-sm leading-6 text-muted-foreground">
            统一管理题号规则、出题范围与命名空间负责人。命名空间只控制编号、筛选和权限，不会自动挂课程、训练或标签。
          </p>
        </div>
        {isAdmin ? (
          <Button type="button" className="min-h-11 active:scale-[0.96] transition-transform" onClick={() => setDialog({ type: 'create' })}>
            <Plus className="size-4" />
            新建命名空间
          </Button>
        ) : null}
      </header>

      <ProblemBankNav
        active="namespaces"
        problemsUrl={bs.urls.problems}
        reviewUrl={String(data.problemReviewUrl || '')}
        canReview={!!data.problemReviewUrl}
        namespaceUrl={endpoint}
        canManageNamespaces
      />

      <section aria-label="权限说明" className="grid gap-3 md:grid-cols-3">
        {[
          {
            icon: BookKey,
            title: '出题人',
            body: '具备基础出题权限后，可在该命名空间创建新题；撤销后只阻止以后创建。',
          },
          {
            icon: ShieldCheck,
            title: '负责人',
            body: '包含出题人能力，可管理普通出题人，并审核、退回或发布本范围内的托管题。',
          },
          {
            icon: Pencil,
            title: '编辑全部题目',
            body: '独立开关，可维护本范围全部题目；不会同时获得成员管理或发布能力。',
          },
        ].map((item) => (
          <article key={item.title} className="rounded-2xl bg-muted/45 p-4 shadow-[0_0_0_1px_hsl(var(--border)/0.65)]">
            <div className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-background text-primary shadow-[0_0_0_1px_hsl(var(--border)/0.7)]">
                <item.icon className="size-4" />
              </span>
              <h2 className="font-semibold tracking-tight">{item.title}</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
          </article>
        ))}
      </section>

      {namespaces.length ? (
        <section aria-label="命名空间列表" className="grid gap-4 xl:grid-cols-2">
          {namespaces.map((namespace) => (
            <article
              key={namespace.namespaceId}
              className="overflow-hidden rounded-3xl bg-background shadow-[0_0_0_1px_hsl(var(--border)/0.8),0_8px_24px_-20px_hsl(var(--foreground)/0.35)]"
            >
              <header className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">{namespace.name}</h2>
                    <Badge variant={namespace.kind === 'builtin' ? 'secondary' : 'outline'}>
                      {namespace.kind === 'builtin' ? '系统规则' : '自定义'}
                    </Badge>
                    <Badge variant={namespace.enabled ? 'default' : 'outline'}>{namespace.enabled ? '已启用' : '已停用'}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Hash className="size-3.5" />
                      {namespace.pidPattern}
                    </span>
                    <span className="tabular-nums">当前计数 · {namespaceCounterLabel(namespace)}</span>
                    <span className="tabular-nums">rev.{namespace.revision}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {isAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-10 active:scale-[0.96] transition-transform"
                      onClick={() => setDialog({ type: 'config', namespace })}
                    >
                      <Pencil className="size-3.5" />
                      配置
                    </Button>
                  ) : null}
                  {isAdmin && namespace.kind === 'custom' && !namespace.allocated ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-10 text-destructive hover:text-destructive active:scale-[0.96] transition-transform"
                      onClick={() => setDialog({ type: 'delete', namespace })}
                    >
                      <Trash2 className="size-3.5" />
                      删除
                    </Button>
                  ) : null}
                </div>
              </header>

              <div className="border-t border-border/70 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">成员</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{namespace.members.length} 人</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10 active:scale-[0.96] transition-transform"
                    onClick={() => openMember(namespace)}
                  >
                    <UserPlus className="size-3.5" />
                    添加
                  </Button>
                </div>
                {namespace.members.length ? (
                  <ul className="divide-y divide-border/65 overflow-hidden rounded-2xl bg-muted/35 px-3">
                    {namespace.members.map((member) => (
                      <li key={member.uid} className="flex min-w-0 items-center gap-3 py-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-sm font-semibold shadow-[0_0_0_1px_hsl(var(--border)/0.7)]">
                          {memberName(memberUsers, member.uid).slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{memberName(memberUsers, member.uid)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[11px] text-muted-foreground">UID {member.uid}</span>
                            <Badge variant="outline">{member.role === 'manager' ? '负责人' : '出题人'}</Badge>
                            {member.editAll ? <Badge variant="secondary">编辑全部</Badge> : null}
                          </div>
                        </div>
                        {isAdmin || (member.role === 'author' && !member.editAll) ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-10 shrink-0 active:scale-[0.96] transition-transform"
                            aria-label={`编辑 UID ${member.uid}`}
                            onClick={() => openMember(namespace, member)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed border-border px-5 text-center">
                    <p className="text-sm text-muted-foreground">尚未分配成员；系统管理员仍可管理该命名空间。</p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <div className="space-y-2">
            <Users className="mx-auto size-6 text-muted-foreground" />
            <p className="font-medium">没有可管理的题号命名空间</p>
            <p className="text-sm text-muted-foreground">请联系系统管理员分配负责人身份。</p>
          </div>
        </section>
      )}

      <section aria-labelledby="namespace-audit-heading" className="space-y-3 border-t border-border/70 pt-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Activity className="size-4" />
          </span>
          <div>
            <h2 id="namespace-audit-heading" className="font-semibold tracking-tight">
              最近操作
            </h2>
            <p className="text-xs text-muted-foreground">最多展示当前可管理范围最近 30 条结构化审计。</p>
          </div>
        </div>
        {namespaceAudits.length ? (
          <ul className="divide-y divide-border/65 overflow-hidden rounded-2xl bg-muted/35 px-4">
            {namespaceAudits.map((entry) => {
              const namespace = namespaces.find((candidate) => candidate.namespaceId === entry.namespaceId);
              return (
                <li key={entry._id || entry.requestId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {auditOperationLabel(entry.operation || (entry.action === 'publish' ? 'review.publish' : ''))} ·{' '}
                      {namespace?.name || entry.namespaceId}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={entry.requestId}>
                      {memberName(memberUsers, entry.operator)} · {entry.problemId ? `题目 #${entry.problemId} · ` : ''}
                      {entry.requestId}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={entry.result === 'success' ? 'secondary' : entry.result === 'rejected' ? 'destructive' : 'outline'}
                      className={entry.result === 'incomplete' ? 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300' : undefined}
                    >
                      {entry.result === 'success'
                        ? '成功'
                        : entry.result === 'rejected'
                          ? '已拒绝'
                          : entry.result === 'incomplete'
                            ? '已提交但收尾异常'
                            : '执行中'}
                    </Badge>
                    <time className="text-xs tabular-nums text-muted-foreground" dateTime={entry.time}>
                      {new Date(entry.time).toLocaleString('zh-CN', { hour12: false })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            当前范围还没有命名空间审计记录。
          </div>
        )}
      </section>

      <Dialog open={dialog?.type === 'create'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="w-full sm:w-[520px]">
          <DialogHeader>
            <DialogTitle>新建自定义命名空间</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              const form = new FormData(event.currentTarget);
              return submit(event, {
                operation: 'create',
                name: String(form.get('name') || ''),
                prefix: String(form.get('prefix') || ''),
                start: String(form.get('start') || ''),
              });
            }}
          >
            <DialogBody className="space-y-4 p-5">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">名称</span>
                <Input name="name" maxLength={64} required placeholder="例如：操作系统" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">题号前缀</span>
                  <Input name="prefix" minLength={2} maxLength={8} pattern="[A-Za-z]{2,8}" required placeholder="OS" />
                  <span className="block text-xs text-muted-foreground">2–8 个英文字母，服务端统一转大写。</span>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">起始编号</span>
                  <Input name="start" type="number" min={1} max={9999} defaultValue={1001} required />
                  <span className="block text-xs text-muted-foreground">题号固定补齐四位，例如 OS1001。</span>
                </label>
              </div>
              <p className="rounded-xl bg-amber-500/[0.08] px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
                分配首道题后，前缀和起始编号将永久锁定；后续只能停用，不能删除或回退计数器。
              </p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </DialogBody>
            <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-3">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button type="submit" className="min-h-11 active:scale-[0.96] transition-transform" disabled={busy}>
                <Plus className="size-4" />
                创建
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'config'} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.type === 'config' ? (
          <DialogContent className="w-full sm:w-[520px]">
            <DialogHeader>
              <DialogTitle>配置「{dialog.namespace.name}」</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                const form = new FormData(event.currentTarget);
                return submit(event, {
                  operation: 'updateConfig',
                  namespaceId: dialog.namespace.namespaceId,
                  expectedRevision: String(dialog.namespace.revision),
                  name: String(form.get('name') || ''),
                  enabled: String(form.get('enabled') === 'true'),
                  ...(dialog.namespace.kind === 'custom' && !dialog.namespace.allocated
                    ? {
                        prefix: String(form.get('prefix') || ''),
                        start: String(form.get('start') || ''),
                      }
                    : {}),
                });
              }}
            >
              <DialogBody className="space-y-4 p-5">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">名称</span>
                  <Input name="name" maxLength={64} required defaultValue={dialog.namespace.name} readOnly={dialog.namespace.kind === 'builtin'} />
                </label>
                {dialog.namespace.kind === 'custom' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">前缀</span>
                      <Input name="prefix" defaultValue={dialog.namespace.prefix} disabled={dialog.namespace.allocated} required />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">起始编号</span>
                      <Input
                        name="start"
                        type="number"
                        min={1}
                        max={9999}
                        defaultValue={dialog.namespace.start}
                        disabled={dialog.namespace.allocated}
                        required
                      />
                    </label>
                  </div>
                ) : null}
                <label className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/50 px-3">
                  <Checkbox name="enabled" value="true" defaultChecked={dialog.namespace.enabled} />
                  <span>
                    <span className="block text-sm font-medium">启用命名空间</span>
                    <span className="block text-xs text-muted-foreground">停用后不能创建新题，既有题目和权限不受影响。</span>
                  </span>
                </label>
                {dialog.namespace.allocated ? (
                  <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    已经分配过题号，前缀、起始编号和历史计数器均已锁定。
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </DialogBody>
              <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-3">
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog(null)}>
                  取消
                </Button>
                <Button type="submit" className="min-h-11 active:scale-[0.96] transition-transform" disabled={busy}>
                  <Power className="size-4" />
                  保存配置
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog?.type === 'member'} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.type === 'member' ? (
          <DialogContent className="w-full sm:w-[560px]">
            <DialogHeader>
              <DialogTitle>{dialog.member ? '编辑成员权限' : '添加命名空间成员'}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                const target = selectedUsers[0];
                if (!target) {
                  event.preventDefault();
                  setError('请选择一名域用户');
                  return;
                }
                return submit(event, {
                  operation: 'setMember',
                  namespaceId: dialog.namespace.namespaceId,
                  expectedRevision: String(dialog.namespace.revision),
                  targetUid: String(target._id),
                  role,
                  editAll: String(isAdmin && editAll),
                });
              }}
            >
              <DialogBody className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">用户</span>
                  <MultiSelect<DomainUserOption>
                    value={selectedUsers}
                    onChange={(next) => {
                      setSelectedUsers(next);
                      setError('');
                    }}
                    loadOptions={searchUsers}
                    getKey={(option) => String(option._id)}
                    getLabel={domainUserSearchLabel}
                    renderOption={(option) => <DomainUserSearchOption user={option} />}
                    renderChip={(option) => <span>{option.uname || `UID ${option._id}`}</span>}
                    maxItems={1}
                    disabled={!!dialog.member}
                    placeholder="按 OJ 用户、学号或姓名搜索"
                    emptyText="没有找到域内用户"
                    minHeight={44}
                  />
                </div>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">身份</span>
                  <SimpleSelect
                    value={role}
                    onValueChange={(value) => setRole(value as MemberRole)}
                    options={[{ value: 'author', label: '出题人' }, ...(isAdmin ? [{ value: 'manager', label: '负责人' }] : [])]}
                  />
                  {!isAdmin ? <span className="block text-xs text-muted-foreground">负责人只能添加或移除普通出题人。</span> : null}
                </label>
                {isAdmin ? (
                  <label className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/50 px-3">
                    <Checkbox checked={editAll} onCheckedChange={setEditAll} />
                    <span>
                      <span className="block text-sm font-medium">可编辑该命名空间全部题目</span>
                      <span className="block text-xs text-muted-foreground">独立于负责人身份，不授予发布或成员管理能力。</span>
                    </span>
                  </label>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </DialogBody>
              <div className="flex flex-wrap justify-between gap-2 border-t border-border/70 px-5 py-3">
                {dialog.member ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11 active:scale-[0.96] transition-transform"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await postNamespaceOperation(endpoint, {
                          operation: 'removeMember',
                          namespaceId: dialog.namespace.namespaceId,
                          expectedRevision: String(dialog.namespace.revision),
                          targetUid: String(dialog.member!.uid),
                        });
                        window.location.reload();
                      } catch (cause) {
                        console.error('PID namespace member removal failed', cause);
                        setError(cause instanceof Error ? cause.message : '移除成员失败');
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    移除成员
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog(null)}>
                    取消
                  </Button>
                  <Button type="submit" className="min-h-11 active:scale-[0.96] transition-transform" disabled={busy || !selectedUsers.length}>
                    <ShieldCheck className="size-4" />
                    保存权限
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog?.type === 'delete'} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.type === 'delete' ? (
          <DialogContent className="w-full sm:w-[480px]">
            <DialogHeader>
              <DialogTitle>删除「{dialog.namespace.name}」</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-3 p-5">
              <p className="text-sm leading-6 text-muted-foreground">该命名空间尚未分配题号，可以安全删除。删除后成员关系与预留配置一并移除。</p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </DialogBody>
            <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-3">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="min-h-11 active:scale-[0.96] transition-transform"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await postNamespaceOperation(endpoint, {
                      operation: 'delete',
                      namespaceId: dialog.namespace.namespaceId,
                      expectedRevision: String(dialog.namespace.revision),
                    });
                    window.location.reload();
                  } catch (cause) {
                    console.error('PID namespace delete failed', cause);
                    setError(cause instanceof Error ? cause.message : '删除命名空间失败');
                    setBusy(false);
                  }
                }}
              >
                <Trash2 className="size-4" />
                确认删除
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </main>
  );
}
