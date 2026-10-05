/**
 * /permits/inbox — per-problem collaboration inbox.
 *
 * Backed by krypton-permits `MyVerifyInboxHandler` (returns the user's
 * permit rows plus joined problem/granter/contest dicts). Two sections:
 * direct invitations (granted on a single problem) and contest-cascade
 * invitations (granted via a contest's verifier list, tagged with
 * `viaContest`). Direct author/verifier roles may be self-revoked; a managed
 * maintainer role remains administrator-controlled.
 */
import { ChevronRight, Code2, EyeOff, Lock, Mail, Send, Trophy } from 'lucide-react';
import { SendProblemToCph } from '@/components/competitive-companion-bridge';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { confirmDialog } from '@/components/ui/dialog';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { createRequestId } from '@/lib/request-id';

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
  firstCompletedAt?: string;
}

interface UserMini {
  _id: number;
  uname: string;
}
interface ProblemMini {
  docId: number;
  pid?: string;
  title: string;
  hidden?: boolean;
  lockHidden?: boolean;
  authoringMode?: 'managed';
}
interface ContestMini {
  _id: string;
  title: string;
}

export function MyVerifyInboxPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    permits: PermitRow[];
    contributions: ContributionRow[];
    pdict: Record<string, ProblemMini>;
    udict: Record<string, UserMini>;
    tdict: Record<string, ContestMini>;
  };
  const direct = (data.permits || []).filter((p) => !p.viaContest);
  const contributions = (data.contributions || []).filter((row) => row.active);
  const [actionError, setActionError] = useState('');
  const [completing, setCompleting] = useState('');
  const [leavingKey, setLeavingKey] = useState('');
  // Group contest permits by tid
  const byContest = new Map<string, PermitRow[]>();
  for (const p of data.permits || []) {
    if (!p.viaContest) continue;
    if (!byContest.has(p.viaContest)) byContest.set(p.viaContest, []);
    byContest.get(p.viaContest)!.push(p);
  }

  async function revoke(pid: number, permitId: string) {
    if (!(await confirmDialog('退出该题目的协作角色？', { destructive: true }))) return;
    setLeavingKey(permitId);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('permitId', permitId);
      const r = await fetchHydroResponse(`/p/${pid}/permits/revoke`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(await readHydroResponseError(r, '退出协作失败'));
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '退出协作失败');
    } finally {
      setLeavingKey('');
    }
  }

  async function revokeViaContest(tid: string) {
    if (!(await confirmDialog('退出该比赛的验题角色？', { destructive: true }))) return;
    setLeavingKey(`contest:${tid}`);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('uid', String(bs.user.id));
      const r = await fetchHydroResponse(`/contest/${tid}/verifiers/remove`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(await readHydroResponseError(r, '退出协作失败'));
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '退出协作失败');
    } finally {
      setLeavingKey('');
    }
  }

  async function complete(row: ContributionRow) {
    const key = `${row.pid}:${row.scope}`;
    setCompleting(key);
    setActionError('');
    try {
      const fd = new FormData();
      fd.set('scope', row.scope);
      fd.set('status', 'completed');
      fd.set('requestId', createRequestId());
      const response = await fetchHydroResponse(`/p/${row.pid}/contributions/status`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, '标记完成失败'));
      }
      window.location.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '标记完成失败');
      setCompleting('');
    }
  }

  const empty = direct.length === 0 && byContest.size === 0 && contributions.length === 0;

  return (
    <Page width="wide">
      <PageHeader
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <Mail className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0">我的出题协作</span>
          </span>
        )}
        description="出题角色与数据、标签贡献任务都集中在这里；完成仅记录工作进度。"
      />

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {empty ? (
        <Panel>
          <EmptyState title="还没有任何题目协作邀请" />
        </Panel>
      ) : null}

      {(['data', 'tag'] as const).map((scope) => {
        const scoped = contributions.filter((row) => row.scope === scope);
        const pending = scoped.filter((row) => row.status === 'pending');
        const completed = scoped.filter((row) => row.status === 'completed');
        if (!scoped.length) return null;
        const title = scope === 'data' ? '数据贡献任务' : '标签贡献任务';
        return (
          <Panel key={scope} flush title={`${title} (${pending.length} 待完成 / ${completed.length} 已完成)`}>
            {pending.length ? (
              <ul className="divide-y divide-line">
                {pending.map((row) => (
                  <ContributionRowItem
                    key={row._id}
                    row={row}
                    pdict={data.pdict}
                    udict={data.udict}
                    completing={completing === `${row.pid}:${row.scope}`}
                    onComplete={() => complete(row)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-xs text-fg-subtle">当前没有待完成任务</p>
            )}
            {completed.length ? (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-fg-subtle hover:text-fg">
                  查看已完成任务 ({completed.length})
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {completed.map((row) => (
                    <ContributionRowItem key={row._id} row={row} pdict={data.pdict} udict={data.udict} completing={false} />
                  ))}
                </ul>
              </details>
            ) : null}
          </Panel>
        );
      })}

      {direct.length > 0 ? (
        <Panel flush title={`直接邀请 (${direct.length})`}>
          <ul className="divide-y divide-line">
            {direct.map((p) => (
              <PermitRowItem
                key={p._id}
                permit={p}
                pdict={data.pdict}
                udict={data.udict}
                leaving={leavingKey === p._id}
                onRevoke={() => revoke(p.pid, p._id)}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {Array.from(byContest.entries()).map(([tid, rows]) => {
        const t = data.tdict[tid];
        return (
          <Panel
            key={tid}
            flush
            title={(
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Trophy className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                <span className="min-w-0">
                  来自比赛：
                  <a href={`/contest/${tid}`} className="text-brand-fg hover:underline">
                    {t?.title || tid}
                  </a>
                </span>
                <span className="text-xs font-normal text-fg-subtle">({rows.length} 题)</span>
              </span>
            )}
          >
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <PermitRowItem
                  key={p._id}
                  permit={p}
                  pdict={data.pdict}
                  udict={data.udict}
                  leaving={leavingKey === `contest:${tid}`}
                  onRevoke={() => revokeViaContest(tid)}
                />
              ))}
            </ul>
          </Panel>
        );
      })}
    </Page>
  );
}

function ContributionRowItem({
  row,
  pdict,
  udict,
  completing,
  onComplete,
}: {
  row: ContributionRow;
  pdict: Record<string, ProblemMini>;
  udict: Record<string, UserMini>;
  completing: boolean;
  onComplete?: () => void;
}) {
  const p = pdict[row.pid] || ({} as ProblemMini);
  const assigner = udict[row.assignedBy];
  const problemHref = `/p/${p.pid || p.docId || row.pid}`;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <a href={`${problemHref}/edit`} className="block min-w-0 truncate text-sm font-medium text-fg hover:text-brand-fg hover:underline">
          <span className="font-mono text-2xs text-fg-subtle">{p.pid || p.docId || row.pid}</span>
          <span className="ml-1.5">{p.title || '题目'}</span>
        </a>
        <p className="mt-1 text-xs text-fg-subtle">
          {assigner ? `${assigner.uname} 分配` : `UID ${row.assignedBy} 分配`} · {new Date(row.assignedAt).toLocaleString('zh-CN')}
          {row.note ? ` · ${row.note}` : ''}
        </p>
        {row.firstCompletedAt ? (
          <p className="mt-1 text-xs text-fg-subtle">首次完成于 {new Date(row.firstCompletedAt).toLocaleString('zh-CN')}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SendProblemToCph href={problemHref} compact />
        <Button asChild type="button" size="sm" variant="secondary">
          <a href={`${problemHref}?ide=1`}>
            <Code2 />
            IDE
          </a>
        </Button>
        <Button asChild type="button" size="sm" variant="secondary">
          <a href={`${problemHref}/submit`}>
            <Send />
            提交
          </a>
        </Button>
        {onComplete ? (
          <Button type="button" size="sm" variant="soft" onClick={onComplete} disabled={completing}>
            {completing ? '提交中…' : '标记完成'}
          </Button>
        ) : (
          <Badge tone="success">已完成</Badge>
        )}
      </div>
    </li>
  );
}

function PermitRowItem({
  permit,
  pdict,
  udict,
  leaving,
  onRevoke,
}: {
  permit: PermitRow;
  pdict: Record<string, ProblemMini>;
  udict: Record<string, UserMini>;
  leaving: boolean;
  onRevoke: () => void;
}) {
  const p = pdict[permit.pid] || ({} as ProblemMini);
  const granter = udict[permit.grantedBy];
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight className="size-3 shrink-0 text-fg-subtle" aria-hidden="true" />
          <a href={`/p/${p.pid || p.docId}`} className="block min-w-0 truncate text-sm font-medium text-fg hover:text-brand-fg hover:underline">
            <span className="font-mono text-2xs text-fg-subtle">{p.pid || p.docId}</span>
            <span className="ml-1.5">{p.title || '题目'}</span>
          </a>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          {p.hidden ? (
            <Badge tone="warning" size="sm">
              <EyeOff className="size-3" aria-hidden="true" />
              隐藏
            </Badge>
          ) : null}
          {p.lockHidden ? (
            <Badge tone="danger" size="sm">
              <Lock className="size-3" aria-hidden="true" />
              锁定
            </Badge>
          ) : null}
          <Badge variant="outline" size="sm">
            {permit.role === 'maintainer' ? '维护者' : permit.role === 'author' ? '出题人' : '验题人'}
          </Badge>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-xs text-fg-subtle">{granter ? `${granter.uname} 邀请` : `uid:${permit.grantedBy}`}</span>
        {permit.role === 'maintainer' && p.authoringMode === 'managed' ? (
          <span className="text-xs text-fg-subtle">需管理员撤销</span>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={onRevoke} disabled={leaving}>
            退出
          </Button>
        )}
      </div>
    </li>
  );
}
