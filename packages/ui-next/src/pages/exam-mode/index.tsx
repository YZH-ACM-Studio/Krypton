/**
 * /exam-mode index — card grid of exams the current user can join RIGHT NOW.
 *
 * This page is only reachable from the Qt exam client, so it intentionally
 * surfaces only "live" exams (within their begin/end window). Anything
 * upcoming or finished would be noise — they can't take action on it from
 * the client UI.
 *
 * When no exam is live, we show a friendly waiting state plus the time of
 * the next scheduled exam (if any) so the student knows when to come back.
 */
import { motion } from 'motion/react';
import { Calendar, ChevronRight, Clock, Hourglass, Lock, Swords } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDuration } from '@hydrooj/common';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { ExamHomeShell } from '@/components/layout/exam-shell';

interface ExamCardData {
  _id: string;
  docId: string;
  title: string;
  beginAt: string;
  endAt: string;
  approvalMode?: 'strict' | 'auto';
  lockdownMode?: boolean;
  pids: number[];
  attended: boolean;
  inWindow: boolean;
}

// formatRange replaced by inline `<DateTime>` + formatDuration where used.

export function ExamModeHomePage() {
  const data = useBootstrap().page.data as {
    exams: ExamCardData[];
    user: { name: string; studentId?: string; realName?: string };
  };
  const exams = data.exams || [];
  const live = exams.filter((e) => e.inWindow);
  // We don't render upcoming exams as cards (only live ones are actionable),
  // but we use the nearest one to populate the empty-state hint so students
  // know when to come back.
  const now = Date.now();
  const nextUpcoming = exams
    .filter((e) => new Date(e.beginAt).getTime() > now)
    .sort((a, b) => new Date(a.beginAt).getTime() - new Date(b.beginAt).getTime())[0];

  return (
    <ExamHomeShell>
      <div className="mx-auto max-w-5xl space-y-8 p-6">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Swords className="size-5 text-primary" />
              <h1 className="text-xl font-semibold">考试入口</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {live.length > 0
                ? `当前有 ${live.length} 场考试可进入`
                : '当前没有正在进行的考试'}
            </p>
          </div>
          {data.user.realName && (
            <div className="text-right text-sm">
              <p className="font-semibold">{data.user.realName}</p>
              <p className="text-xs text-muted-foreground">{data.user.studentId}</p>
            </div>
          )}
        </motion.header>

        {live.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-primary">
              进行中 <span className="text-xs font-normal text-muted-foreground">({live.length})</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((e) => (
                <ExamCard key={e._id} exam={e} />
              ))}
            </div>
          </section>
        ) : (
          <EmptyWaitingState next={nextUpcoming} />
        )}
      </div>
    </ExamHomeShell>
  );
}

function EmptyWaitingState({ next }: { next: ExamCardData | undefined }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border bg-card p-10 text-center shadow-sm"
    >
      <Hourglass className="mx-auto size-12 text-muted-foreground/40" />
      <h2 className="mt-4 text-lg font-semibold">等待考试开始</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        当前没有可进入的考试。监考服务正常 — 请保持本机器在线，到点会自动可见。
      </p>
      {next && (
        <div className="mx-auto mt-6 inline-flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <Clock className="size-4 text-muted-foreground" />
          <div className="text-left">
            <p className="text-xs text-muted-foreground">下一场考试</p>
            <p className="font-medium">{next.title}</p>
            <p className="text-xs text-muted-foreground">
              <DateTime value={next.beginAt} mode="both" />
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ExamCard({ exam, disabled }: { exam: ExamCardData; disabled?: boolean }) {
  return (
    <Card className={disabled ? 'opacity-70' : 'transition-shadow hover:shadow-md'}>
      <CardContent className="space-y-3 p-5">
        <div className="space-y-1">
          <h3 className="line-clamp-2 font-semibold">{exam.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Calendar className="size-3" />{exam.pids.length} 题
            </Badge>
            {exam.lockdownMode && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Lock className="size-3" />屏幕锁定
              </Badge>
            )}
            {exam.approvalMode === 'strict' && (
              <Badge variant="outline" className="text-[10px]">人工审核</Badge>
            )}
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" />
          <DateTime value={exam.beginAt} /> · {formatDuration({ from: exam.beginAt, to: exam.endAt })}
        </p>
        <Button asChild disabled={disabled} className="w-full" variant={exam.inWindow ? 'default' : 'outline'}>
          <a href={`/exam-mode/${exam.docId}`}>
            {exam.inWindow ? '进入考试' : exam.attended ? '查看答卷' : '查看详情'}
            <ChevronRight className="size-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
