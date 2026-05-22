/**
 * Exam SPA section components: Overview / Announcements / Ranking.
 * Used by pages/exam-mode/paper.tsx when section is non-`problems`.
 */
import type { ReactNode } from 'react';
import { Calendar, Clock, Lock, MegaphoneIcon, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownView } from '@/components/markdown-renderer';
import { Countdown, KIND_LABELS, type PaperCell, type QuestionKind } from '@/components/paper/paper-shell';

// ─── Overview ─────────────────────────────────────────────────────────────

interface OverviewData {
  tdoc: any;
  cells: PaperCell[];
  owner: { uid: number; uname: string } | null;
  inWindow: boolean;
  now: number;
  signedInUser: { name: string; studentId?: string; realName?: string };
  attended?: boolean;
}

export function OverviewSection({ data, onEnterProblems }: { data: OverviewData; onEnterProblems: () => void }) {
  const { tdoc, cells, owner, inWindow, now, signedInUser } = data;
  const beginAt = new Date(tdoc.beginAt).getTime();
  const endAt = new Date(tdoc.endAt).getTime();
  const durationMin = Math.round((endAt - beginAt) / 60000);
  const isUpcoming = now < beginAt;
  const isEnded = now > endAt;

  // Count cells by kind.
  const byKind = new Map<QuestionKind, number>();
  for (const c of cells) byKind.set(c.kind, (byKind.get(c.kind) || 0) + 1);
  const totalScore = cells.reduce((sum, c) => sum + (c.score || 0), 0);

  const ruleLabel: Record<string, string> = {
    exam: '考试 Exam', acm: 'ACM', oi: 'OI', ioi: 'IOI',
  };

  return (
    <div className="space-y-5 p-6">
      {/* Hero */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">{tdoc.title}</h1>
              <div className="flex flex-wrap gap-2">
                {inWindow && <Badge>进行中</Badge>}
                {isUpcoming && <Badge variant="outline">即将开始</Badge>}
                {isEnded && <Badge variant="secondary">已结束</Badge>}
                <Badge variant="outline">{ruleLabel[tdoc.rule] || tdoc.rule}</Badge>
                {tdoc.lockdownMode && (
                  <Badge variant="outline" className="gap-1"><Lock className="size-3" />屏幕锁定</Badge>
                )}
                {tdoc.approvalMode === 'strict' && (
                  <Badge variant="outline">人工审核入场</Badge>
                )}
              </div>
            </div>
            <div className="space-y-2 text-right">
              {inWindow ? (
                <>
                  <p className="text-xs text-muted-foreground">剩余时间</p>
                  <Countdown endAt={endAt} />
                </>
              ) : isUpcoming ? (
                <>
                  <p className="text-xs text-muted-foreground">距开始还有</p>
                  <Countdown endAt={beginAt} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">已结束 <DateTime value={endAt} /></p>
              )}
              {inWindow && (
                <button
                  type="button"
                  onClick={onEnterProblems}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  开始答题
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-sm">考试时间</CardTitle></CardHeader>
          <CardContent className="space-y-2 px-5 pb-5 text-sm">
            <InfoRow icon={Calendar} label="开始" value={<DateTime value={beginAt} />} />
            <InfoRow icon={Calendar} label="结束" value={<DateTime value={endAt} />} />
            <InfoRow icon={Clock} label="时长" value={`${durationMin} 分钟`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-sm">管理员</CardTitle></CardHeader>
          <CardContent className="space-y-2 px-5 pb-5 text-sm">
            {owner ? (
              <InfoRow icon={User} label="主管" value={owner.uname || `UID ${owner.uid}`} />
            ) : (
              <p className="text-muted-foreground">未知</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Problem set */}
      <Card>
        <CardHeader className="px-5 pb-3 pt-5">
          <CardTitle className="text-sm">题目集（共 {cells.length} 道 · {totalScore} 分）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          <div className="flex flex-wrap gap-2">
            {Array.from(byKind.entries()).map(([kind, count]) => (
              <Badge key={kind} variant="outline" className="text-xs">
                {KIND_LABELS[kind]} · {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* You */}
      <Card>
        <CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-sm">你的状态</CardTitle></CardHeader>
        <CardContent className="space-y-1 px-5 pb-5 text-sm">
          <InfoRow icon={User} label="账号" value={signedInUser.name} />
          {signedInUser.studentId && (
            <InfoRow icon={User} label="学号" value={`${signedInUser.studentId} ${signedInUser.realName || ''}`} />
          )}
        </CardContent>
      </Card>

      {/* Description / markdown */}
      {tdoc.content && (
        <Card>
          <CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-sm">说明</CardTitle></CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownView value={tdoc.content} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ─── Announcements ───────────────────────────────────────────────────────

export function AnnouncementsSection({ broadcasts }: { broadcasts: Array<{ _id: string; content: string; createdAt: string | Date }> }) {
  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MegaphoneIcon className="size-5 text-primary" />
          考试公告
        </h2>
        <p className="text-sm text-muted-foreground">管理员发布的全场广播。新公告会显示在最上方。</p>
      </header>
      {broadcasts.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <MegaphoneIcon className="mx-auto mb-2 size-8 opacity-30" />
            暂无公告。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {broadcasts.map((b) => {
            const ts = new Date(b.createdAt);
            return (
              <Card key={b._id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5 pb-2 pt-4">
                  <CardTitle className="text-xs font-normal text-muted-foreground">
                    管理员 · <DateTime value={ts} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <MarkdownView value={b.content} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Ranking ──────────────────────────────────────────────────────────────

export function RankingSection({
  scoreboard, showScoreboard, signedInUid,
}: {
  scoreboard: Array<{ rank: number; uid: number; uname: string; realName?: string; studentId?: string; score: number }>;
  showScoreboard: boolean;
  signedInUid: number;
}) {
  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Trophy className="size-5 text-primary" />
          排名
        </h2>
        <p className="text-sm text-muted-foreground">仅展示前 100 名。</p>
      </header>
      {!showScoreboard ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <Trophy className="mx-auto mb-2 size-8 opacity-30" />
            考试进行中暂不展示排名。结束后或管理员开启实时排名时可见。
          </CardContent>
        </Card>
      ) : scoreboard.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <Trophy className="mx-auto mb-2 size-8 opacity-30" />
            暂无排名数据。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 pl-5">名次</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>学号 / 姓名</TableHead>
                  <TableHead className="pr-5 text-right">总分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scoreboard.map((r) => {
                  const isSelf = r.uid === signedInUid;
                  return (
                    <TableRow key={r.uid} className={cn(isSelf && 'bg-primary/5')}>
                      <TableCell className="pl-5 font-mono">{r.rank}</TableCell>
                      <TableCell>
                        <span className={cn(isSelf && 'font-semibold text-primary')}>{r.uname}</span>
                        {isSelf && <Badge variant="outline" className="ml-2 text-[10px]">你</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.studentId || ''} {r.realName || ''}
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono font-semibold">{r.score}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
