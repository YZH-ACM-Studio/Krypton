/**
 * /tasks/verify — "我的验题任务" inbox.
 *
 * Backed by krypton-permits `MyVerifyInboxHandler` (returns the user's
 * permit rows plus joined problem/granter/contest dicts). Two sections:
 * direct invitations (granted on a single problem) and contest-cascade
 * invitations (granted via a contest's verifier list, tagged with
 * `viaContest`). Each row supports "退出验题" (revoke own permit).
 */
import { ChevronRight, EyeOff, Lock, Mail, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBootstrap } from '@/lib/bootstrap';

interface PermitRow {
  _id: string;
  pid: number;
  uid: number;
  role: 'verifier' | 'maintainer';
  grantedBy: number;
  grantedAt: string;
  viaContest: string | null;
  note: string;
}

interface UserMini { _id: number; uname: string }
interface ProblemMini { docId: number; pid?: string; title: string; hidden?: boolean; lockHidden?: boolean }
interface ContestMini { _id: string; title: string }

export function MyVerifyInboxPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    permits: PermitRow[];
    pdict: Record<string, ProblemMini>;
    udict: Record<string, UserMini>;
    tdict: Record<string, ContestMini>;
  };
  const direct = (data.permits || []).filter((p) => !p.viaContest);
  // Group contest permits by tid
  const byContest = new Map<string, PermitRow[]>();
  for (const p of (data.permits || [])) {
    if (!p.viaContest) continue;
    if (!byContest.has(p.viaContest)) byContest.set(p.viaContest, []);
    byContest.get(p.viaContest)!.push(p);
  }

  async function revoke(pid: number, permitId: string) {
    if (!confirm('退出验题？')) return;
    const fd = new FormData();
    fd.set('permitId', permitId);
    const r = await fetch(`/p/${pid}/permits/revoke`, { method: 'POST', body: fd, credentials: 'include' });
    if (r.ok) window.location.reload();
  }

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Mail className="size-6 text-primary" />
            我的验题任务
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            被邀请验题的所有题目都会出现在这里。直接邀请和通过比赛邀请分开列出。
          </p>
        </div>
      </div>

      {direct.length === 0 && byContest.size === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            还没有任何验题邀请
          </CardContent>
        </Card>
      ) : null}

      {direct.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">直接邀请 ({direct.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {direct.map((p) => (
                <PermitRowItem
                  key={p._id} permit={p}
                  pdict={data.pdict} udict={data.udict}
                  onRevoke={() => revoke(p.pid, p._id)}
                />
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
                  <PermitRowItem
                    key={p._id} permit={p}
                    pdict={data.pdict} udict={data.udict}
                    onRevoke={() => revoke(p.pid, p._id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </motion.div>
  );
}

function PermitRowItem({
  permit, pdict, udict, onRevoke,
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
        <a
          href={`/p/${p.pid || p.docId}`}
          className="truncate text-sm font-medium hover:text-primary hover:underline"
        >
          <span className="font-mono text-[11px] text-muted-foreground">{p.pid || p.docId}</span>
          <span className="ml-1.5">{p.title || '题目'}</span>
        </a>
        {p.hidden ? (
          <Badge variant="outline" className="gap-0.5 border-amber-500/40 bg-amber-50 px-1 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <EyeOff className="size-2.5" />
            隐藏
          </Badge>
        ) : null}
        {p.lockHidden ? (
          <Badge variant="outline" className="gap-0.5 border-rose-500/40 bg-rose-50 px-1 py-0 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <Lock className="size-2.5" />
            锁定
          </Badge>
        ) : null}
        <Badge variant={permit.role === 'maintainer' ? 'default' : 'secondary'} className="text-[10px]">
          {permit.role === 'maintainer' ? '维护者' : '验题人'}
        </Badge>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground">
          {granter ? `${granter.uname} 邀请` : `uid:${permit.grantedBy}`}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={onRevoke}>退出</Button>
      </div>
    </li>
  );
}
