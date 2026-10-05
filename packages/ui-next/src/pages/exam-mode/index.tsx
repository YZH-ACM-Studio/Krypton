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
import { Calendar, ChevronRight, Clock, Hourglass, Lock, Swords } from 'lucide-react';
import { formatDuration } from '@hydrooj/common';
import { ExamHomeShell } from '@/components/layout/exam-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

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
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <Swords className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <h2 className="text-lg font-semibold">考试入口</h2>
            </div>
            <p className="text-sm text-fg-muted">{live.length > 0 ? `当前有 ${live.length} 场考试可进入` : '当前没有正在进行的考试'}</p>
          </div>
          {data.user.realName ? (
            <div className="max-w-full min-w-0 text-right text-sm">
              <p className="truncate font-semibold text-fg">{data.user.realName}</p>
              <p className="truncate text-xs text-fg-subtle">{data.user.studentId}</p>
            </div>
          ) : null}
        </div>

        {live.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-fg">
              进行中 <span className="text-xs font-normal text-fg-subtle tabular">({live.length})</span>
            </h3>
            <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((e) => (
                <ExamCard key={e._id} exam={e} emphasize={live.length === 1} />
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
    <Panel>
      <EmptyState
        compact
        icon={<Hourglass />}
        title="等待考试开始"
        description="当前没有可进入的考试。监考服务正常 — 请保持本机器在线，到点会自动可见。"
      />
      {next ? (
        <div className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-md bg-surface-sunken px-4 py-3 text-sm">
          <Clock className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <div className="min-w-0 text-left">
            <p className="text-xs text-fg-subtle">下一场考试</p>
            <p className="truncate font-medium text-fg">{next.title}</p>
            <p className="text-xs text-fg-subtle">
              <DateTime value={next.beginAt} mode="both" />
            </p>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function examEntryVariant(exam: ExamCardData, emphasize: boolean): 'primary' | 'soft' | 'secondary' {
  if (!exam.inWindow) return 'secondary';
  return emphasize ? 'primary' : 'soft';
}

function ExamCard({ exam, disabled, emphasize }: { exam: ExamCardData; disabled?: boolean; emphasize?: boolean }) {
  return (
    <Panel className="w-full min-w-0">
      <div className="min-w-0 space-y-3">
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 min-w-0 font-semibold text-fg">{exam.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" size="sm">
              <Calendar className="size-3" aria-hidden="true" />
              {exam.pids.length} 题
            </Badge>
            {exam.lockdownMode ? (
              <Badge variant="outline" size="sm">
                <Lock className="size-3" aria-hidden="true" />
                屏幕锁定
              </Badge>
            ) : null}
            {exam.approvalMode === 'strict' ? (
              <Badge variant="outline" size="sm">
                人工审核
              </Badge>
            ) : null}
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle tabular">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <DateTime value={exam.beginAt} /> · {formatDuration({ from: exam.beginAt, to: exam.endAt })}
        </p>
        <Button asChild disabled={disabled} className="w-full" variant={disabled ? 'secondary' : examEntryVariant(exam, emphasize === true)}>
          <a href={`/exam-mode/${exam.docId}`}>
            {exam.inWindow ? '进入考试' : exam.attended ? '查看答卷' : '查看详情'}
            <ChevronRight />
          </a>
        </Button>
      </div>
    </Panel>
  );
}
