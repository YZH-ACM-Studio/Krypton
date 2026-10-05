/**
 * Exam SPA section components: Overview / Announcements / Ranking.
 * Used by pages/exam-mode/paper.tsx when section is non-`problems`.
 */
import type { ReactNode } from 'react';
import { Calendar, Clock, FileText, Lock, MegaphoneIcon, Trophy, User, type LucideIcon } from 'lucide-react';
import { MarkdownView } from '@/components/markdown-renderer';
import { KIND_LABELS, type PaperCell, type QuestionKind } from '@/components/paper/paper-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';

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
  examShowVerdict?: boolean;
  examPassScore?: number | null;
  examAttemptLimit?: number;
  examAttemptsUsed?: number;
  examScore?: number;
  examJudging?: boolean;
  examPassed?: boolean;
  canRetake?: boolean;
  examMinProblemsToPass?: number | null;
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
  const canRetake = data.canRetake === true;
  const startNext = !paperPreview && ((canStartPaper === true && !paperStarted) || canRetake);
  const ctaLabel = paperPreview
    ? '预览题目'
    : canRetake
      ? '再考一次'
      : paperFinalized
        ? '查看答卷'
        : paperStarted
          ? '进入答题'
          : '开始答题';
  const ctaEnabled = paperPreview || paperFinalized || paperStarted || canStartPaper === true;
  const onCta = startNext ? onStartPaper : paperPreview || paperFinalized || paperStarted ? onEnterProblems : onStartPaper;
  const passScore = typeof data.examPassScore === 'number' && data.examPassScore > 0 ? data.examPassScore : null;
  const showVerdict = data.examShowVerdict !== false;
  const panelTitle = paperPreview
    ? '预览试卷'
    : canRetake
      ? '可以再考'
      : paperFinalized
        ? '答卷已提交'
        : paperStarted
          ? '继续考试'
          : '准备开考';
  const panelDescription = paperPreview
    ? '预览可以看到题库，但不会写入开考时间。'
    : canRetake
      ? '先查看上一轮，或确认后再开一轮完整时长。'
      : paperFinalized
        ? '再次打开只是查阅，不会生成新的评测记录。'
        : paperStarted
          ? '试卷已冻结，倒计时按个人时长计算。'
          : '点击下方按钮后需再次确认。确认前看不见题目。';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto p-6 sm:p-10">
      <div className="flex w-full min-w-0 max-w-xl flex-col gap-6">
        <div className="min-w-0 space-y-3 text-center">
          <div className="flex flex-wrap justify-center gap-2">
            {paperPreview && <Badge variant="outline">预览</Badge>}
            {paperFinalized && !paperPreview && data.examJudging && <Badge tone="info" dot>评测中</Badge>}
            {paperFinalized && !paperPreview && data.examPassed && <Badge tone="success">已及格</Badge>}
            {paperFinalized && !paperPreview && !data.examJudging && !data.examPassed && passScore && <Badge tone="danger">未及格</Badge>}
            {paperFinalized && !paperPreview && !passScore && <Badge tone="neutral">已交卷</Badge>}
            {paperStarted && !paperFinalized && !paperPreview && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg">
                <StatusDot tone="success" pulse />
                答题中
              </span>
            )}
            {!paperStarted && !paperFinalized && !paperPreview && data.inWindow && <Badge tone="success">可开考</Badge>}
            {isUpcoming && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg">
                <StatusDot tone="info" />
                即将开始
              </span>
            )}
            {isEnded && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg">
                <StatusDot />
                已结束
              </span>
            )}
            {tdoc.lockdownMode && (
              <Badge variant="outline">
                <Lock className="size-3" />
                屏幕锁定
              </Badge>
            )}
          </div>
          <h2 className="text-lg font-semibold">{tdoc.title}</h2>
          <p className="break-words text-sm text-fg-muted">
            {paperPreview
              ? '管理员预览不会计时，也不能交卷。'
              : paperFinalized && canRetake
                ? '上一轮未及格。再考会清空本场答卷并重新计时。'
                : paperFinalized
                ? data.examJudging
                  ? '已交卷，正在评测，出分前不能再考。'
                  : data.examPassed
                    ? '已经及格。可以查看答卷，不能再考。'
                    : '已经交卷。可以查看答卷，不能再改、不能再交。'
                : paperStarted
                  ? '个人计时已开始。进入答题后继续作答。'
                  : '开始答题后才会抽卷并开始个人倒计时。'}
          </p>
        </div>

        <Panel title={panelTitle}>
          <div className="flex flex-col gap-6">
            <p className="break-words text-sm text-fg-muted">{panelDescription}</p>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="h-14 w-full"
                disabled={!ctaEnabled || starting}
                onClick={onCta}
              >
                {starting ? '正在开始…' : ctaLabel}
              </Button>
              {canRetake ? (
                <Button type="button" variant="secondary" className="w-full" onClick={onEnterProblems}>
                  查看上一轮答卷
                </Button>
              ) : null}
            </div>
            {!ctaEnabled && !paperPreview && (
              <p className="text-center text-sm text-fg-muted">{isUpcoming ? '整场开始后才能开考。' : '现在不能开始答题。'}</p>
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
            {passScore !== null && (
              <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-4 text-sm text-fg">
                <p>
                  及格分 <span className="font-medium tabular">{passScore}</span>
                  {typeof data.examScore === 'number' && paperFinalized ? (
                    <>
                      ，本轮 <span className="font-medium tabular">{data.examScore}</span>
                    </>
                  ) : null}
                </p>
                {showVerdict && paperStarted && typeof data.examMinProblemsToPass === 'number' ? (
                  <p className="text-xs text-fg-subtle">按当前卷面，至少全对 {data.examMinProblemsToPass} 题才够及格。</p>
                ) : null}
                <p className="text-xs text-fg-subtle tabular">
                  已考 {data.examAttemptsUsed || (paperFinalized ? 1 : 0)} / {data.examAttemptLimit || 1} 次
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-4">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                <FileText className="size-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 break-words">题量 {questionCount} 道</span>
              </div>
              {byKind.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Array.from(byKind.entries()).map(([kind, count]) => (
                    <Badge key={kind} variant="outline">
                      {kindLabel(kind)} · {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <InfoRow icon={User} label="账号" value={signedInUser.name} />
              {signedInUser.studentId && <InfoRow icon={User} label="学号" value={`${signedInUser.studentId} ${signedInUser.realName || ''}`} />}
              {owner && <InfoRow icon={User} label="主管" value={owner.uname || `UID ${owner.uid}`} />}
            </div>
          </div>
        </Panel>

        {tdoc.content && (
          <Panel title="考生说明">
            <MarkdownView content={tdoc.content} className="min-w-0" />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-sunken p-3 text-center">
      <div className="mb-1 flex min-w-0 items-center justify-center gap-1 text-2xs text-fg-subtle">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="min-w-0 break-words text-sm font-medium tabular">{value}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-fg-subtle" />
      <span className="w-20 shrink-0 text-xs text-fg-subtle">{label}</span>
      <span className="min-w-0 break-words font-medium text-fg">{value}</span>
    </div>
  );
}

// ─── Announcements ───────────────────────────────────────────────────────

export function AnnouncementsSection({ broadcasts }: { broadcasts: Array<{ _id: string; content: string; createdAt: string | Date }> }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
      <header className="min-w-0 space-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-fg">
          <MegaphoneIcon className="size-5 shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate">考试公告</span>
        </h2>
        <p className="break-words text-sm text-fg-muted">管理员发布的全场广播。新公告会显示在最上方。</p>
      </header>
      {broadcasts.length === 0 ? (
        <Panel>
          <EmptyState compact icon={<MegaphoneIcon />} title="暂无公告。" />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {broadcasts.map((b) => {
            const ts = new Date(b.createdAt);
            return (
              <Panel key={b._id}>
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-fg-subtle">
                    管理员 · <DateTime value={ts} />
                  </p>
                  <MarkdownView content={b.content} className="min-w-0" />
                </div>
              </Panel>
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
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
      <header className="min-w-0 space-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-fg">
          <Trophy className="size-5 shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate">排名</span>
        </h2>
        <p className="text-sm text-fg-muted">仅展示前 100 名。</p>
      </header>
      {!showScoreboard ? (
        <Panel>
          <EmptyState compact icon={<Trophy />} title="考试进行中暂不展示排名。结束后或管理员开启实时排名时可见。" />
        </Panel>
      ) : scoreboard.length === 0 ? (
        <Panel>
          <EmptyState compact icon={<Trophy />} title="暂无排名数据。" />
        </Panel>
      ) : (
        <Panel flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">名次</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>学号 / 姓名</TableHead>
                <TableHead className="text-right">总分</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scoreboard.map((r) => {
                const isSelf = r.uid === signedInUid;
                return (
                  <TableRow key={r.uid} data-state={isSelf ? 'selected' : undefined}>
                    <TableCell className="font-mono tabular">{r.rank}</TableCell>
                    <TableCell>
                      <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                        <span className={cn('min-w-0 break-words', isSelf && 'font-semibold text-brand-fg')}>{r.uname}</span>
                        {isSelf && <Badge variant="outline" size="sm">你</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 break-words text-fg-muted">
                      {r.studentId || ''} {r.realName || ''}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular">{r.score}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
