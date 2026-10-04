import { type FormEvent, useCallback, useRef, useState } from 'react';
import { Activity, BookKey, Hash, Pencil, Plus, Power, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel, loadDomainUsers } from '@/components/domain-user-search';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { confirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

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
  const response = await fetchHydroResponse(endpoint, {
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

function auditTone(result: NamespaceAudit['result']) {
  if (result === 'success') return 'success' as const;
  if (result === 'rejected') return 'danger' as const;
  if (result === 'incomplete') return 'warning' as const;
  return 'info' as const;
}

function auditLabel(result: NamespaceAudit['result']) {
  if (result === 'success') return '成功';
  if (result === 'rejected') return '已拒绝';
  if (result === 'incomplete') return '已提交但收尾异常';
  return '执行中';
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
  const operationEpoch = useRef(0);

  if (!endpoint) throw new Error('题号命名空间接口缺失');

  const searchUsers = useCallback((query: string) => loadDomainUsers(bs.domain?.id || 'system', query), [bs.domain?.id]);

  function retireDialogOperation() {
    operationEpoch.current += 1;
    setError('');
    setBusy(false);
  }

  function openDialog(next: Exclude<NamespaceDialog, null>) {
    retireDialogOperation();
    setDialog(next);
  }

  function dismissDialog() {
    retireDialogOperation();
    setDialog(null);
  }

  function openMember(namespace: PidNamespaceView, member?: PidNamespaceMember) {
    const profile = member ? memberUsers[String(member.uid)] : undefined;
    setSelectedUsers(member ? [profile || { _id: member.uid, uname: `UID ${member.uid}` }] : []);
    setRole(member?.role || 'author');
    setEditAll(member?.editAll || false);
    openDialog({ type: 'member', namespace, member });
  }

  async function submit(event: FormEvent<HTMLFormElement>, fields: Record<string, string>) {
    const epoch = operationEpoch.current;
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postNamespaceOperation(endpoint, fields);
      window.location.reload();
    } catch (cause) {
      console.error('PID namespace operation failed', cause);
      if (epoch !== operationEpoch.current) return;
      setError(cause instanceof Error ? cause.message : '题号命名空间操作失败');
      setBusy(false);
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={<p className="text-xs font-medium text-fg-subtle">统一题库 · 作用域权限</p>}
        title="题号命名空间"
        description="统一管理题号规则、出题范围与命名空间负责人。命名空间只控制编号、筛选和权限，不会自动挂课程、训练或标签。"
        actions={isAdmin ? (
          <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={() => openDialog({ type: 'create' })}>
            <Plus />
            新建命名空间
          </Button>
        ) : undefined}
      />

      <ProblemBankNav
        active="namespaces"
        problemsUrl={bs.urls.problems}
        reviewUrl={String(data.problemReviewUrl || '')}
        canReview={!!data.problemReviewUrl}
        namespaceUrl={endpoint}
        canManageNamespaces
      />

      <section aria-label="权限说明" className="grid gap-4 md:grid-cols-3">
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
          <article key={item.title} className="rounded-lg border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-active text-fg">
                <item.icon className="size-4" aria-hidden="true" />
              </span>
              <h2 className="min-w-0 text-sm font-semibold text-fg">{item.title}</h2>
            </div>
            <p className="mt-3 text-sm text-fg-muted">{item.body}</p>
          </article>
        ))}
      </section>

      {namespaces.length ? (
        <section aria-label="命名空间列表" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {namespaces.map((namespace) => (
            <Panel key={namespace.namespaceId}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 text-lg font-semibold text-fg">{namespace.name}</h2>
                    <Badge variant="outline">
                      {namespace.kind === 'builtin' ? '系统规则' : '自定义'}
                    </Badge>
                    <Badge tone={namespace.enabled ? 'success' : 'warning'}>{namespace.enabled ? '已启用' : '已停用'}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
                    <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                      <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{namespace.pidPattern}</span>
                    </span>
                    <span className="tabular">当前计数 · {namespaceCounterLabel(namespace)}</span>
                    <span className="tabular">rev.{namespace.revision}</span>
                  </div>
                </div>
                <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                  {isAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="w-full sm:w-auto"
                      onClick={() => openDialog({ type: 'config', namespace })}
                    >
                      <Pencil />
                      配置
                    </Button>
                  ) : null}
                  {isAdmin && namespace.kind === 'custom' && !namespace.allocated ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger-soft"
                      className="w-full sm:w-auto"
                      onClick={() => openDialog({ type: 'delete', namespace })}
                    >
                      <Trash2 />
                      删除
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg">成员</h3>
                    <p className="mt-0.5 text-xs text-fg-subtle tabular">{namespace.members.length} 人</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => openMember(namespace)}
                  >
                    <UserPlus />
                    添加
                  </Button>
                </div>
                {namespace.members.length ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg bg-surface-sunken px-3">
                    {namespace.members.map((member) => (
                      <li key={member.uid} className="flex min-w-0 items-center gap-3 py-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface text-sm font-semibold text-fg">
                          {memberName(memberUsers, member.uid).slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{memberName(memberUsers, member.uid)}</p>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="font-mono text-2xs text-fg-subtle">UID {member.uid}</span>
                            <Badge variant="outline">{member.role === 'manager' ? '负责人' : '出题人'}</Badge>
                            {member.editAll ? <Badge tone="neutral">编辑全部</Badge> : null}
                          </div>
                        </div>
                        {isAdmin || (member.role === 'author' && !member.editAll) ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="shrink-0"
                            aria-label={`编辑 UID ${member.uid}`}
                            onClick={() => openMember(namespace, member)}
                          >
                            <Pencil />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-fg-muted">
                    尚未分配成员；系统管理员仍可管理该命名空间。
                  </p>
                )}
              </div>
            </Panel>
          ))}
        </section>
      ) : (
        <Panel>
          <EmptyState
            icon={<Users />}
            title="没有可管理的题号命名空间"
            description="请联系系统管理员分配负责人身份。"
          />
        </Panel>
      )}

      <section aria-labelledby="namespace-audit-heading" className="flex flex-col gap-3 border-t border-line pt-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-active text-fg-subtle">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="namespace-audit-heading" className="text-lg font-semibold text-fg">
              最近操作
            </h2>
            <p className="text-xs text-fg-subtle">最多展示当前可管理范围最近 30 条结构化审计。</p>
          </div>
        </div>
        {namespaceAudits.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-lg bg-surface-sunken px-4">
            {namespaceAudits.map((entry) => {
              const namespace = namespaces.find((candidate) => candidate.namespaceId === entry.namespaceId);
              return (
                <li key={entry._id || entry.requestId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">
                      {auditOperationLabel(entry.operation || (entry.action === 'publish' ? 'review.publish' : ''))} ·{' '}
                      {namespace?.name || entry.namespaceId}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-2xs text-fg-subtle" title={entry.requestId}>
                      {memberName(memberUsers, entry.operator)} · {entry.problemId ? `题目 #${entry.problemId} · ` : ''}
                      {entry.requestId}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={auditTone(entry.result)}>
                      {auditLabel(entry.result)}
                    </Badge>
                    <time className="text-xs text-fg-subtle tabular" dateTime={entry.time}>
                      {new Date(entry.time).toLocaleString('zh-CN', { hour12: false })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-fg-muted">
            当前范围还没有命名空间审计记录。
          </p>
        )}
      </section>

      <Dialog open={dialog?.type === 'create'} onOpenChange={(open) => !open && dismissDialog()}>
        <DialogContent size="md">
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
            <DialogBody className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">名称</span>
                <Input name="name" maxLength={64} required placeholder="例如：操作系统" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">题号前缀</span>
                  <Input name="prefix" minLength={2} maxLength={8} pattern="[A-Za-z]{2,8}" required placeholder="OS" />
                  <span className="text-xs text-fg-subtle">2–8 个英文字母，服务端统一转大写。</span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">起始编号</span>
                  <Input name="start" type="number" min={1} max={9999} defaultValue={1001} required />
                  <span className="text-xs text-fg-subtle">题号固定补齐四位，例如 OS1001。</span>
                </label>
              </div>
              <Alert tone="warning">
                分配首道题后，前缀和起始编号将永久锁定；后续只能停用，不能删除或回退计数器。
              </Alert>
              {error ? <Alert tone="danger">{error}</Alert> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => dismissDialog()}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                <Plus />
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.type === 'config'} onOpenChange={(open) => !open && dismissDialog()}>
        {dialog?.type === 'config' ? (
          <DialogContent size="md">
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
              <DialogBody className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">名称</span>
                  <Input name="name" maxLength={64} required defaultValue={dialog.namespace.name} readOnly={dialog.namespace.kind === 'builtin'} />
                </label>
                {dialog.namespace.kind === 'custom' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-fg">前缀</span>
                      <Input name="prefix" defaultValue={dialog.namespace.prefix} disabled={dialog.namespace.allocated} required />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-fg">起始编号</span>
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
                <label className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-sunken px-3">
                  <Switch name="enabled" value="true" defaultChecked={dialog.namespace.enabled} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">启用命名空间</span>
                    <span className="block text-xs text-fg-subtle">停用后不能创建新题，既有题目和权限不受影响。</span>
                  </span>
                </label>
                {dialog.namespace.allocated ? (
                  <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-fg-subtle">
                    已经分配过题号，前缀、起始编号和历史计数器均已锁定。
                  </p>
                ) : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => dismissDialog()}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  <Power />
                  保存配置
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog?.type === 'member'} onOpenChange={(open) => !open && dismissDialog()}>
        {dialog?.type === 'member' ? (
          <DialogContent size="lg">
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
              <DialogBody className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">用户</span>
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
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">身份</span>
                  <SimpleSelect
                    value={role}
                    onValueChange={(value) => setRole(value as MemberRole)}
                    options={[{ value: 'author', label: '出题人' }, ...(isAdmin ? [{ value: 'manager', label: '负责人' }] : [])]}
                  />
                  {!isAdmin ? <span className="text-xs text-fg-subtle">负责人只能添加或移除普通出题人。</span> : null}
                </label>
                {isAdmin ? (
                  <label className="flex min-h-12 items-center gap-3 rounded-lg bg-surface-sunken px-3">
                    <Checkbox checked={editAll} onCheckedChange={setEditAll} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">可编辑该命名空间全部题目</span>
                      <span className="block text-xs text-fg-subtle">独立于负责人身份，不授予发布或成员管理能力。</span>
                    </span>
                  </label>
                ) : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </DialogBody>
              <DialogFooter>
                {dialog.member ? (
                  <Button
                    type="button"
                    variant="danger-soft"
                    disabled={busy}
                    onClick={async () => {
                      const member = dialog.member;
                      if (!member) return;
                      const namespaceId = dialog.namespace.namespaceId;
                      const expectedRevision = String(dialog.namespace.revision);
                      const epoch = operationEpoch.current;
                      if (!(await confirmDialog('移除该命名空间成员？', { destructive: true, confirmLabel: '移除成员' }))) return;
                      if (epoch !== operationEpoch.current) return;
                      setBusy(true);
                      setError('');
                      try {
                        await postNamespaceOperation(endpoint, {
                          operation: 'removeMember',
                          namespaceId,
                          expectedRevision,
                          targetUid: String(member.uid),
                        });
                        window.location.reload();
                      } catch (cause) {
                        console.error('PID namespace member removal failed', cause);
                        if (epoch !== operationEpoch.current) return;
                        setError(cause instanceof Error ? cause.message : '移除成员失败');
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 />
                    移除成员
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" onClick={() => dismissDialog()}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !selectedUsers.length}>
                  <ShieldCheck />
                  保存权限
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog?.type === 'delete'} onOpenChange={(open) => !open && dismissDialog()}>
        {dialog?.type === 'delete' ? (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>删除「{dialog.namespace.name}」</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3">
              <p className="text-sm text-fg-muted">该命名空间尚未分配题号，可以安全删除。删除后成员关系与预留配置一并移除。</p>
              {error ? <Alert tone="danger">{error}</Alert> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => dismissDialog()}>
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  const epoch = operationEpoch.current;
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
                    if (epoch !== operationEpoch.current) return;
                    setError(cause instanceof Error ? cause.message : '删除命名空间失败');
                    setBusy(false);
                  }
                }}
              >
                <Trash2 />
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Page>
  );
}
