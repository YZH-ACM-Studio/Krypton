/**
 * Public /contest/:tid landing for rule=exam.
 * Same attend / exam-mode / scoreboard / manage routes as the old shared
 * contest detail page; ACM and homework stay on ContestDetailPage.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  ChevronRight,
  Clock,
  Code,
  Download,
  FileText,
  Flag,
  Lock,
  MessageSquare,
  Pencil,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { postContestProblemEntryUrl } from '@/lib/contest-exam-display';
import { replaceRouteTokens, toDate } from '@/lib/format';

interface ExamDetailTdoc {
  docId: string;
  title: string;
  content?: string | Record<string, string>;
  beginAt?: unknown;
  endAt?: unknown;
  lockAt?: unknown;
  attend: number;
  entryMode?: string;
  hidden?: boolean;
  allowPrint?: boolean;
  allowViewCode?: boolean;
  pids: Array<string | number>;
  durationHours: number | null;
  examPassScore: number | null;
  examAttemptLimit: number | null;
}

interface ExamDetailTsdoc {
  attend?: number;
  rank?: number;
  score?: number;
  startAt?: unknown;
  endAt?: unknown;
}

interface ExamDetailData {
  tdoc: ExamDetailTdoc;
  tsdoc: ExamDetailTsdoc;
  pids: Array<string | number>;
  attended: boolean;
  canManageContest: boolean;
  canViewRecord: boolean;
  files: Array<{ name: string }>;
  postContestPracticeSupported: boolean;
  postContestPracticeOpen: boolean;
  virtualAllowed: boolean;
  virtualAttemptStatus: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalInt(value: unknown, min: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) return null;
  return value;
}

function readOptionalHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function readExamDetailData(raw: unknown): ExamDetailData {
  const page = isRecord(raw) ? raw : {};
  const tdocRaw = isRecord(page.tdoc) ? page.tdoc : {};
  const tsdocRaw = isRecord(page.tsdoc) ? page.tsdoc : {};
  const pidsRaw = Array.isArray(page.pids) ? page.pids : Array.isArray(tdocRaw.pids) ? tdocRaw.pids : [];
  const pids = pidsRaw.filter((pid): pid is string | number => typeof pid === 'string' || typeof pid === 'number');
  const filesRaw = Array.isArray(page.files) ? page.files : [];
  const practice = isRecord(page.postContestPractice) ? page.postContestPractice : {};
  const virtual = isRecord(page.virtualContest) ? page.virtualContest : {};
  const eligibility = isRecord(virtual.eligibility) ? virtual.eligibility : {};
  const attempt = isRecord(virtual.attempt) ? virtual.attempt : null;
  const attendFlag = page.attended === true || page.attended === 1 || tsdocRaw.attend === 1 || tsdocRaw.attend === true;
  return {
    tdoc: {
      docId: tdocRaw.docId == null ? '' : String(tdocRaw.docId),
      title: typeof tdocRaw.title === 'string' && tdocRaw.title ? tdocRaw.title : '考试',
      content: typeof tdocRaw.content === 'string' || isRecord(tdocRaw.content) ? tdocRaw.content : undefined,
      beginAt: tdocRaw.beginAt,
      endAt: tdocRaw.endAt,
      lockAt: tdocRaw.lockAt,
      attend: typeof tdocRaw.attend === 'number' && Number.isFinite(tdocRaw.attend) ? tdocRaw.attend : 0,
      entryMode: typeof tdocRaw.entryMode === 'string' ? tdocRaw.entryMode : undefined,
      hidden: tdocRaw.hidden === true,
      allowPrint: tdocRaw.allowPrint === true,
      allowViewCode: tdocRaw.allowViewCode === true,
      pids,
      durationHours: readOptionalHours(tdocRaw.duration),
      examPassScore: readOptionalInt(tdocRaw.examPassScore, 1),
      examAttemptLimit: readOptionalInt(tdocRaw.examAttemptLimit, 2),
    },
    tsdoc: {
      attend: typeof tsdocRaw.attend === 'number' ? tsdocRaw.attend : undefined,
      rank: typeof tsdocRaw.rank === 'number' ? tsdocRaw.rank : undefined,
      score: typeof tsdocRaw.score === 'number' ? tsdocRaw.score : undefined,
      startAt: tsdocRaw.startAt,
      endAt: tsdocRaw.endAt,
    },
    pids,
    attended: attendFlag,
    canManageContest: page.canManageContest === true,
    canViewRecord: page.canViewRecord === true,
    files: filesRaw.flatMap((file) => {
      if (!isRecord(file) || typeof file.name !== 'string' || !file.name) return [];
      return [{ name: file.name }];
    }),
    postContestPracticeSupported: practice.supported === true,
    postContestPracticeOpen: practice.open === true,
    virtualAllowed: eligibility.allowed === true || attempt !== null,
    virtualAttemptStatus: attempt && typeof attempt.status === 'string' ? attempt.status : null,
  };
}

function examPhase(beginAt: number, endAt: number) {
  const now = Date.now();
  if (!beginAt || !endAt) return 'draft' as const;
  if (now < beginAt) return 'upcoming' as const;
  if (now > endAt) return 'ended' as const;
  return 'running' as const;
}

function formatSpan(begin: number, end: number): string {
  if (!begin || !end || end <= begin) return '—';
  const minutes = Math.round((end - begin) / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
  return `${mins} 分`;
}

function formatPersonalHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} 小时 ${m} 分`;
  if (h > 0) return `${h} 小时`;
  return `${m} 分`;
}

function useCountdown(target: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);
  if (!target) return null;
  const remaining = target - now;
  if (remaining <= 0) return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    expired: false,
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor((remaining / 3_600_000) % 24),
    minutes: Math.floor((remaining / 60_000) % 60),
    seconds: Math.floor((remaining / 1000) % 60),
  };
}

function formatCountdown(cd: ReturnType<typeof useCountdown>): string {
  if (!cd || cd.expired) return '00:00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(cd.hours)}:${pad(cd.minutes)}:${pad(cd.seconds)}`;
  return cd.days > 0 ? `${cd.days} 天 ${clock}` : clock;
}

function windowProgress(phase: ReturnType<typeof examPhase>, beginAt: number, endAt: number) {
  if (!beginAt || !endAt || endAt <= beginAt) return 0;
  if (phase === 'upcoming' || phase === 'draft') return 0;
  if (phase === 'ended') return 100;
  return Math.min(100, Math.max(0, ((Date.now() - beginAt) / (endAt - beginAt)) * 100));
}

function phaseCopy(phase: ReturnType<typeof examPhase>) {
  if (phase === 'upcoming') return { badge: '即将开考', variant: 'outline' as const };
  if (phase === 'running') return { badge: '进行中', variant: 'default' as const };
  if (phase === 'ended') return { badge: '已结束', variant: 'secondary' as const };
  return { badge: '待发布', variant: 'secondary' as const };
}

export function ExamContestDetailPage() {
  const bs = useBootstrap();
  const data = readExamDetailData(bs.page.data);
  const { tdoc, tsdoc } = data;
  const beginAt = toDate(tdoc.beginAt)?.getTime() || 0;
  const endAt = toDate(tdoc.endAt)?.getTime() || 0;
  const phase = examPhase(beginAt, endAt);
  const status = phaseCopy(phase);
  const locale = bs.locale;
  const isClientRequired = tdoc.entryMode === 'client_required';
  const postContestPracticeWaiting =
    !data.canManageContest && data.postContestPracticeSupported && phase === 'ended' && !data.postContestPracticeOpen;
  const detailUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: tdoc.docId });
  const entryUrl = postContestProblemEntryUrl({
    rule: 'exam',
    clientRequired: isClientRequired,
    practiceSupported: data.postContestPracticeSupported,
    practiceOpen: data.postContestPracticeOpen,
    ended: phase === 'ended',
    detailUrl,
    contestId: tdoc.docId,
  });
  const canOpenExam = !postContestPracticeWaiting && (data.canManageContest || phase === 'ended' || (data.attended && phase !== 'upcoming'));
  const discussionUrl = replaceRouteTokens(bs.urls.discussionNode, { TYPE: 'contest', NAME: tdoc.docId });
  const myRecordUrl = `${bs.urls.records}?tid=${encodeURIComponent(tdoc.docId)}&uidOrName=${encodeURIComponent(String(bs.user.id))}`;
  const allRecordUrl = `${bs.urls.records}?tid=${encodeURIComponent(tdoc.docId)}`;
  const countdownTarget = phase === 'upcoming' ? beginAt : phase === 'running' ? endAt : null;
  const cd = useCountdown(countdownTarget);
  const progress = windowProgress(phase, beginAt, endAt);
  const primaryLabel = phase === 'ended' ? '查看考试' : '进入考试';
  const waitLabel = postContestPracticeWaiting ? '补题尚未开放' : '等待开考';
  const heroHint =
    postContestPracticeWaiting
      ? '客户端锁定期结束后才能查看题目。'
      : phase === 'upcoming'
        ? data.attended
          ? '整场开始后才能进入答题。'
          : '整场开始前先报名。开始后进入考试工作台。'
        : phase === 'ended'
          ? '整场已结束。可以查看考试与排行。'
          : data.attended
            ? '已报名。进入考试后开始或继续答题。'
            : '考试进行中。报名后进入答题。';

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href={bs.urls.contests} className="hover:text-primary">
          比赛
        </a>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{tdoc.title}</span>
      </div>

      <Card>
        <CardContent className="space-y-6 p-5 sm:p-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>{status.badge}</Badge>
              <Badge variant="outline">考试</Badge>
              {tdoc.hidden ? <Badge variant="outline">已隐藏</Badge> : null}
              {isClientRequired ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <ShieldCheck className="size-3" />
                  须用客户端
                </Badge>
              ) : null}
              {tdoc.allowViewCode ? <Badge variant="outline">代码可见</Badge> : null}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{tdoc.title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{heroHint}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="已报名" value={`${tdoc.attend} 人`} />
            <Fact label="整场时长" value={formatSpan(beginAt, endAt)} />
            <Fact
              label="个人时长"
              value={tdoc.durationHours ? formatPersonalHours(tdoc.durationHours) : '随整场关门'}
            />
            {data.canManageContest || data.pids.length > 0 ? (
              <Fact label="题量" value={`${data.pids.length} 题`} />
            ) : (
              <Fact label="题量" value="开考后可见" />
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!data.attended && phase !== 'ended' ? (
              <form method="post">
                <input type="hidden" name="operation" value="attend" />
                <Button type="submit" className="h-10 active:scale-[0.96] motion-reduce:transform-none">
                  报名考试
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            ) : canOpenExam ? (
              <Button asChild className="h-10 active:scale-[0.96] motion-reduce:transform-none">
                <a href={entryUrl}>
                  {primaryLabel}
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            ) : (
              <Button type="button" disabled className="h-10">
                <Lock className="size-4" />
                {waitLabel}
              </Button>
            )}
            <Button asChild variant="outline" className="h-10 active:scale-[0.96] motion-reduce:transform-none">
              <a href={`${detailUrl}/scoreboard`}>
                <Trophy className="size-4" />
                排行榜
              </a>
            </Button>
            {data.canManageContest ? (
              <Button asChild variant="outline" className="h-10 active:scale-[0.96] motion-reduce:transform-none">
                <a href={`${detailUrl}/management`}>
                  <Settings className="size-4" />
                  管理
                </a>
              </Button>
            ) : null}
            {data.virtualAllowed ? (
              <Button asChild variant="outline" className="h-10 active:scale-[0.96] motion-reduce:transform-none">
                <a href={`${detailUrl}/virtual`}>
                  {data.virtualAttemptStatus === 'active'
                    ? '继续虚拟参赛'
                    : data.virtualAttemptStatus === 'ended'
                      ? '查看虚拟参赛'
                      : '开始虚拟参赛'}
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {phase !== 'draft' ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {phase === 'upcoming' ? '距离开考' : phase === 'running' ? '距离整场结束' : '整场已结束'}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight">
                {phase === 'ended' ? '00:00:00' : formatCountdown(cd)}
              </p>
            </div>
            <div className="w-full space-y-1.5 sm:max-w-xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{phase === 'upcoming' ? '尚未开始' : phase === 'running' ? '整场进度' : '已结束'}</span>
                <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {tdoc.content ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="size-4" />
                  考生说明
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <MarkdownView content={tdoc.content} preferredLang={locale?.startsWith('zh') ? 'zh' : 'en'} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">考试入口</CardTitle>
              <CardDescription>进入答题工作台，或查看排行与讨论。题目不会出现在这个页面。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <DetailLink
                href={entryUrl}
                icon={<FileText className="size-4" />}
                title={canOpenExam ? (phase === 'ended' ? '查看考试' : '进入考试') : '考试未开放'}
                muted={!canOpenExam}
              >
                {postContestPracticeWaiting
                  ? '客户端锁定期结束后开放'
                  : isClientRequired && !data.postContestPracticeOpen
                    ? '客户端工作台'
                    : phase === 'ended'
                      ? '结束后查看题目与答卷'
                      : '进入答题工作台'}
              </DetailLink>
              <DetailLink href={`${detailUrl}/scoreboard`} icon={<Trophy className="size-4" />} title="排行榜">
                查看排名与分数
              </DetailLink>
              {data.virtualAllowed ? (
                <DetailLink href={`${detailUrl}/virtual`} icon={<Clock className="size-4" />} title="虚拟参赛">
                  计时训练入口，与正式考试分开
                </DetailLink>
              ) : null}
              {data.canManageContest ? (
                <DetailLink href={`${detailUrl}/clarification`} icon={<MessageSquare className="size-4" />} title="澄清答疑">
                  查看公告与提交提问
                </DetailLink>
              ) : null}
              <DetailLink href={discussionUrl} icon={<MessageSquare className="size-4" />} title="讨论区">
                考试相关公开讨论
              </DetailLink>
              {tdoc.allowPrint ? (
                <DetailLink href={`${detailUrl}/print`} icon={<FileText className="size-4" />} title="打印服务">
                  提交或查看打印请求
                </DetailLink>
              ) : null}
              {data.attended && data.canViewRecord ? (
                <DetailLink href={myRecordUrl} icon={<Code className="size-4" />} title="我的提交">
                  查看本场个人提交
                </DetailLink>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">考试安排</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0 text-sm">
              <MetaRow icon={<Calendar className="size-3.5" />} label="整场开始">
                <DateTime value={tdoc.beginAt} />
              </MetaRow>
              <MetaRow icon={<Calendar className="size-3.5" />} label="整场结束">
                <DateTime value={tdoc.endAt} />
              </MetaRow>
              <MetaRow icon={<Clock className="size-3.5" />} label="整场时长">
                {formatSpan(beginAt, endAt)}
              </MetaRow>
              <MetaRow icon={<Clock className="size-3.5" />} label="个人时长">
                {tdoc.durationHours ? formatPersonalHours(tdoc.durationHours) : '随整场关门'}
              </MetaRow>
              {tdoc.examPassScore !== null ? (
                <MetaRow icon={<Trophy className="size-3.5" />} label="及格分">
                  {tdoc.examPassScore}
                </MetaRow>
              ) : null}
              {tdoc.examAttemptLimit !== null ? (
                <MetaRow icon={<Flag className="size-3.5" />} label="最多考几次">
                  {tdoc.examAttemptLimit} 次
                </MetaRow>
              ) : null}
              {tdoc.lockAt ? (
                <MetaRow icon={<Lock className="size-3.5" />} label="封榜">
                  <DateTime value={tdoc.lockAt} />
                </MetaRow>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">报名状态</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0 text-sm">
              {data.attended ? (
                <>
                  <MetaRow label="状态">已报名</MetaRow>
                  {typeof tsdoc.rank === 'number' && tsdoc.rank > 0 ? <MetaRow label="当前排名"># {tsdoc.rank}</MetaRow> : null}
                  {typeof tsdoc.score === 'number' ? <MetaRow label="总得分">{String(tsdoc.score)}</MetaRow> : null}
                  {tsdoc.startAt ? (
                    <MetaRow label="开考时间">
                      <DateTime value={tsdoc.startAt} />
                    </MetaRow>
                  ) : null}
                  {tsdoc.endAt ? (
                    <MetaRow label="个人截止">
                      <DateTime value={tsdoc.endAt} />
                    </MetaRow>
                  ) : null}
                  <a href={`${detailUrl}/scoreboard`} className="block pt-1 text-xs text-primary hover:underline">
                    查看完整排行
                  </a>
                </>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">报名后显示个人状态。这个页面看不到题库。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {data.canManageContest ? (
                <>
                  <SidebarLink href={`${detailUrl}/edit`} icon={<Pencil className="size-3.5" />}>
                    编辑考试
                  </SidebarLink>
                  <SidebarLink href={`${detailUrl}/management`} icon={<Settings className="size-3.5" />}>
                    管理考试
                  </SidebarLink>
                </>
              ) : null}
              <SidebarLink href={`${detailUrl}/scoreboard`} icon={<Trophy className="size-3.5" />}>
                排行榜
              </SidebarLink>
              {data.canManageContest ? (
                <SidebarLink href={`${detailUrl}/clarification`} icon={<MessageSquare className="size-3.5" />}>
                  澄清答疑
                </SidebarLink>
              ) : null}
              <SidebarLink href={discussionUrl} icon={<MessageSquare className="size-3.5" />}>
                讨论
              </SidebarLink>
              {data.canManageContest ? (
                <SidebarLink href={`${detailUrl}/code`} icon={<Code className="size-3.5" />}>
                  代码浏览
                </SidebarLink>
              ) : null}
              {data.attended && data.canViewRecord ? (
                <SidebarLink href={myRecordUrl} icon={<Code className="size-3.5" />}>
                  我的提交
                </SidebarLink>
              ) : null}
              {data.canManageContest ? (
                <SidebarLink href={allRecordUrl} icon={<Flag className="size-3.5" />}>
                  全部提交
                </SidebarLink>
              ) : null}
              {tdoc.allowPrint ? (
                <SidebarLink href={`${detailUrl}/print`} icon={<FileText className="size-3.5" />}>
                  打印题面
                </SidebarLink>
              ) : null}
              {data.canManageContest ? (
                <SidebarLink href={`${detailUrl}/user`} icon={<Users className="size-3.5" />}>
                  考生名单
                </SidebarLink>
              ) : null}
            </CardContent>
          </Card>

          {data.files.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">附件</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {data.files.map((file) => (
                  <a
                    key={file.name}
                    href={`${detailUrl}/file/private/${encodeURIComponent(file.name)}`}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Download className="size-3" />
                    <span className="truncate">{file.name}</span>
                  </a>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function DetailLink({
  href,
  icon,
  title,
  muted,
  children,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  muted?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{children}</span>
      </span>
      {muted ? <Lock className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = cn(
    'flex items-center gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color] duration-150',
    muted ? 'cursor-not-allowed bg-muted/30 opacity-70' : 'hover:border-primary/40 hover:bg-accent/30',
  );
  if (muted) return <div className={className}>{body}</div>;
  return (
    <a href={href} className={className}>
      {body}
    </a>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums">{children}</span>
    </div>
  );
}

function SidebarLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      <span>{children}</span>
    </a>
  );
}
