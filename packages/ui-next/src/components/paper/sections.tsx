/**
 * Exam SPA section components: Overview / Announcements / Ranking.
 * Used by pages/exam-mode/paper.tsx when section is non-`problems`.
 */
import type { ReactNode } from 'react';
import { Calendar, Clock, FileText, Lock, MegaphoneIcon, Trophy, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownView } from '@/components/markdown-renderer';
import { KIND_LABELS, type PaperCell, type QuestionKind } from '@/components/paper/paper-shell';

// ─── Overview ─────────────────────────────────────────────────────────────

interface PaperOutline {
  questionCount: number;
  kinds: Array<{ kind: string; count: number }>;
}

interface OverviewData {
  tdoc: {
    title: string;
    rule: string;
    beginAt: string | Date;
    endAt: string | Date;
    content?: string;
    lockdownMode?: boolean;
    approvalMode?: string;
  };
  cells: PaperCell[];
  owner: { uid: number; uname: string } | null;
  inWindow: boolean;
  now: number;
  signedInUser: { name: string; studentId?: string; realName?: string };
  attended?: boolean;
  paperStarted?: boolean;
  paperFinalized?: boolean;
  paperPreview?: boolean;
  canStartPaper?: boolean;
  contestBeginAt?: string | Date;
  contestEndAt?: string | Date;
  durationHours?: number | null;
  paperOutline?: PaperOutline;
  starting?: boolean;
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind as QuestionKind] || kind;
}

export function OverviewSection({
  data,
  onEnterProblems,
  onStartPaper,
}: {
  data: OverviewData;
  onEnterProblems: () => void;
  onStartPaper?: () => void;
}) {
  const { tdoc, cells, owner, now, signedInUser, paperStarted, paperFinalized, paperPreview, canStartPaper, durationHours, paperOutline, starting } = data;
  const wallBegin = new Date(data.contestBeginAt || tdoc.beginAt).getTime();
  const wallEnd = new Date(data.contestEndAt || tdoc.endAt).getTime();
  const isUpcoming = now < wallBegin;
  const isEnded = now > wallEnd;
  const wallMinutes = Math.round((wallEnd - wallBegin) / 60000);
  const byKind = new Map<string, number>();
  if (cells.length) {
    for (const cell of cells) byKind.set(cell.kind, (byKind.get(cell.kind) || 0) + 1);
  } else {
    for (const item of paperOutline?.kinds || []) byKind.set(item.kind, item.count);
  }
  const questionCount = cells.length || paperOutline?.questionCount || 0;
  const ctaLabel = paperPreview ? '预览题目' : paperFinalized ? '查看答卷' : paperStarted ? '进入答题' : '开始答题';
  const ctaEnabled = paperPreview || paperFinalized || paperStarted || canStartPaper === true;
  const onCta = paperPreview || paperFinalized || paperStarted ? onEnterProblems : onStartPaper;

  return (
    <div className="flex min-h-full justify-center p-6 sm:p-10">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="space-y-3 text-center">
          <div className="flex flex-wrap justify-center gap-2">
            {paperPreview && <Badge variant="outline">预览</Badge>}
            {paperFinalized && !paperPreview && <Badge variant="secondary">已交卷</Badge>}
            {paperStarted && !paperFinalized && !paperPreview && <Badge>答题中</Badge>}
            {!paperStarted && !paperFinalized && !paperPreview && data.inWindow && <Badge>可开考</Badge>}
            {isUpcoming && <Badge variant="outline">即将开始</Badge>}
            {isEnded && <Badge variant="secondary">已结束</Badge>}
            {tdoc.lockdownMode && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                屏幕锁定
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{tdoc.title}</h1>
          <p className="text-sm text-muted-foreground">
            {paperPreview
              ? '管理员预览不会计时，也不能交卷。'
              : paperFinalized
                ? '已经交卷。可以查看对错，不能再改、不能再交。'
                : paperStarted
                  ? '个人计时已开始。进入答题后继续作答。'
                  : '开始答题后才会抽卷并开始个人倒计时。'}
          </p>
        </div>

        <Card>
          <CardHeader className="items-center space-y-1 pb-4 text-center">
            <CardTitle className="text-lg">{paperPreview ? '预览试卷' : paperFinalized ? '答卷已提交' : paperStarted ? '继续考试' : '准备开考'}</CardTitle>
            <CardDescription>
              {paperPreview
                ? '预览可以看到题库，但不会写入开考时间。'
                : paperFinalized
                  ? '再次打开只是查阅，不会生成新的评测记录。'
                  : paperStarted
                    ? '试卷已冻结，倒计时按个人时长计算。'
                    : '点击下方按钮后需再次确认。确认前看不见题目。'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base font-semibold"
              disabled={!ctaEnabled || starting}
              onClick={onCta}
            >
              {starting ? '正在开始…' : ctaLabel}
            </Button>
            {!ctaEnabled && !paperPreview && (
              <p className="text-center text-sm text-muted-foreground">{isUpcoming ? '整场开始后才能开考。' : '现在不能开始答题。'}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact icon={Calendar} label="整场开始" value={<DateTime value={wallBegin} />} />
              <Fact icon={Calendar} label="整场结束" value={<DateTime value={wallEnd} />} />
              <Fact
                icon={Clock}
                label="个人时长"
                value={typeof durationHours === 'number' && durationHours > 0 ? `${durationHours} 小时` : `${wallMinutes} 分钟（整场）`}
              />
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" />
                题量 {questionCount} 道
              </div>
              {byKind.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Array.from(byKind.entries()).map(([kind, count]) => (
                    <Badge key={kind} variant="outline" className="text-xs">
                      {kindLabel(kind)} · {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <InfoRow icon={User} label="账号" value={signedInUser.name} />
              {signedInUser.studentId && <InfoRow icon={User} label="学号" value={`${signedInUser.studentId} ${signedInUser.realName || ''}`} />}
              {owner && <InfoRow icon={User} label="主管" value={owner.uname || `UID ${owner.uid}`} />}
            </div>
          </CardContent>
        </Card>

        {tdoc.content && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">考生说明</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownView content={tdoc.content} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <div className="mb-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
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
                    <MarkdownView content={b.content} />
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
  scoreboard,
  showScoreboard,
  signedInUid,
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
                        {isSelf && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            你
                          </Badge>
                        )}
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
