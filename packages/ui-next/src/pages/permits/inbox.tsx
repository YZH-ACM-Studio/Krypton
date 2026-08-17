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
import { motion } from 'motion/react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  // Group contest permits by tid
  const byContest = new Map<string, PermitRow[]>();
  for (const p of data.permits || []) {
    if (!p.viaContest) continue;
    if (!byContest.has(p.viaContest)) byContest.set(p.viaContest, []);
    byContest.get(p.viaContest)!.push(p);
  }

  async function revoke(pid: number, permitId: string) {
    if (!confirm('退出该题目的协作角色？')) return;
    setActionError('');
    const fd = new FormData();
    fd.set('permitId', permitId);
    const r = await fetchHydroResponse(`/p/${pid}/permits/revoke`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      setActionError(await readHydroResponseError(r, '退出协作失败'));
      return;
    }
    window.location.reload();
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

  return (
    <motion.div className="space-y-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Mail className="size-6 text-primary" />
            我的出题协作
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">出题角色与数据、标签贡献任务都集中在这里；完成仅记录工作进度。</p>
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {direct.length === 0 && byContest.size === 0 && contributions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">还没有任何题目协作邀请</CardContent>
        </Card>
      ) : null}

      {(['data', 'tag'] as const).map((scope) => {
        const scoped = contributions.filter((row) => row.scope === scope);
        const pending = scoped.filter((row) => row.status === 'pending');
        const completed = scoped.filter((row) => row.status === 'completed');
        if (!scoped.length) return null;
        const title = scope === 'data' ? '数据贡献任务' : '标签贡献任务';
        return (
          <Card key={scope}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {title} ({pending.length} 待完成 / {completed.length} 已完成)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pending.length ? (
                <ul className="divide-y">
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
                <p className="px-5 py-4 text-xs text-muted-foreground">当前没有待完成任务</p>
              )}
              {completed.length ? (
                <details className="border-t border-border/70">
                  <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                    查看已完成任务 ({completed.length})
                  </summary>
                  <ul className="divide-y border-t border-border/70">
                    {completed.map((row) => (
                      <ContributionRowItem key={row._id} row={row} pdict={data.pdict} udict={data.udict} completing={false} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {direct.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">直接邀请 ({direct.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {direct.map((p) => (
                <PermitRowItem key={p._id} permit={p} pdict={data.pdict} udict={data.udict} onRevoke={() => revoke(p.pid, p._id)} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {Array.from(byContest.entries()).map(([tid, rows]) => {
        const t = data.tdict[tid];
        return (
          <Card key={tid}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Trophy className="size-4 text-amber-500" />
                来自比赛：
                <a href={`/contest/${tid}`} className="text-primary hover:underline">
                  {t?.title || tid}
                </a>
                <span className="text-xs font-normal text-muted-foreground">({rows.length} 题)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {rows.map((p) => (
                  <PermitRowItem key={p._id} permit={p} pdict={data.pdict} udict={data.udict} onRevoke={() => revoke(p.pid, p._id)} />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </motion.div>
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
    <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <a href={`${problemHref}/edit`} className="truncate text-sm font-medium hover:text-primary hover:underline">
          <span className="font-mono text-[11px] text-muted-foreground">{p.pid || p.docId || row.pid}</span>
          <span className="ml-1.5">{p.title || '题目'}</span>
        </a>
        <p className="mt-1 text-xs text-muted-foreground">
          {assigner ? `${assigner.uname} 分配` : `UID ${row.assignedBy} 分配`} · {new Date(row.assignedAt).toLocaleString('zh-CN')}
          {row.note ? ` · ${row.note}` : ''}
        </p>
        {row.firstCompletedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">首次完成于 {new Date(row.firstCompletedAt).toLocaleString('zh-CN')}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <SendProblemToCph href={problemHref} compact />
        <Button asChild type="button" size="sm" variant="outline">
          <a href={`${problemHref}?ide=1`}>
            <Code2 className="mr-1 size-3.5" />
            IDE
          </a>
        </Button>
        <Button asChild type="button" size="sm" variant="outline">
          <a href={`${problemHref}/submit`}>
            <Send className="mr-1 size-3.5" />
            提交
          </a>
        </Button>
        {onComplete ? (
          <Button type="button" size="sm" onClick={onComplete} disabled={completing}>
            {completing ? '提交中…' : '标记完成'}
          </Button>
        ) : (
          <Badge variant="secondary">已完成</Badge>
        )}
      </div>
    </li>
  );
}

function PermitRowItem({
  permit,
  pdict,
  udict,
  onRevoke,
}: {
  permit: PermitRow;
  pdict: Record<string, ProblemMini>;
  udict: Record<string, UserMini>;
  onRevoke: () => void;
}) {
  const p = pdict[permit.pid] || ({} as ProblemMini);
  const granter = udict[permit.grantedBy];
  return (
    <li className="flex items-center justify-between px-5 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        <a href={`/p/${p.pid || p.docId}`} className="truncate text-sm font-medium hover:text-primary hover:underline">
          <span className="font-mono text-[11px] text-muted-foreground">{p.pid || p.docId}</span>
          <span className="ml-1.5">{p.title || '题目'}</span>
        </a>
        {p.hidden ? (
          <Badge
            variant="outline"
            className="gap-0.5 border-amber-500/40 bg-amber-50 px-1 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <EyeOff className="size-2.5" />
            隐藏
          </Badge>
        ) : null}
        {p.lockHidden ? (
          <Badge
            variant="outline"
            className="gap-0.5 border-rose-500/40 bg-rose-50 px-1 py-0 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <Lock className="size-2.5" />
            锁定
          </Badge>
        ) : null}
        <Badge variant={permit.role === 'maintainer' ? 'default' : 'secondary'} className="text-[10px]">
          {permit.role === 'maintainer' ? '维护者' : permit.role === 'author' ? '出题人' : '验题人'}
        </Badge>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground">{granter ? `${granter.uname} 邀请` : `uid:${permit.grantedBy}`}</span>
        {permit.role === 'maintainer' && p.authoringMode === 'managed' ? (
          <span className="text-xs text-muted-foreground">需管理员撤销</span>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={onRevoke}>
            退出
          </Button>
        )}
      </div>
    </li>
  );
}
