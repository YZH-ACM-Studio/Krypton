import { Lock, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CourseChapter, CourseExamBinding, CourseExamContestPreview } from './types';
import {
  canEnterCourseExam,
  collectCourseExamVideos,
  computeCourseExamWatchState,
  isCourseExamEnterClosed,
} from './course-exam-watch';

export {
  COURSE_EXAM_ENTER_GRACE_MS,
  canEnterCourseExam,
  collectCourseExamVideos,
  computeCourseExamWatchState,
  isCourseExamEnterClosed,
} from './course-exam-watch';
export type { CourseExamWatchState } from './course-exam-watch';

const TITLE_LIMIT = 8;

export function CourseExamCard({
  exam,
  contest,
  chapters,
  canManage,
  className,
}: {
  exam: CourseExamBinding | null;
  contest: CourseExamContestPreview | null;
  chapters: CourseChapter[];
  canManage: boolean;
  className?: string;
}) {
  const contestId = exam?.contestId;
  if (!exam || !contestId) return null;

  const title = contest?.title || '结业考试';
  const href = `/exam-mode/${encodeURIComponent(contestId)}`;
  const state = computeCourseExamWatchState(collectCourseExamVideos(chapters, exam), exam);
  const listed = state.remainingVideos.slice(0, TITLE_LIMIT);
  const noOpenVideos = state.locked && state.remaining === 0 && state.remainingVideos.length === 0;
  const examClock = {
    attend: contest?.attend,
    endAt: contest?.endAt,
    beginAt: contest?.beginAt,
    startAt: contest?.startAt,
    paperFinalizedAt: contest?.paperFinalizedAt,
    complete: contest?.complete,
    durationHours: contest?.duration,
  };
  const paperFinalized = contest?.complete === true || Boolean(contest?.paperFinalizedAt);
  const canRetake = contest?.canRetake === true;
  const judging = contest?.examJudging === true;
  const passed = contest?.examPassed === true || contest?.complete === true;
  const canEnter = canEnterCourseExam({
    watchLocked: state.locked,
    missing: contest?.missing,
    ...examClock,
  });
  const windowClosed = isCourseExamEnterClosed({
    missing: contest?.missing,
    ...examClock,
  }) && !canRetake;
  const showWatchLock = !canEnter && !windowClosed && !paperFinalized && contest?.missing !== true && state.locked;
  const remainingAttempts = Math.max(
    0,
    (contest?.examAttemptLimit || 1) - (contest?.examAttemptsUsed || (paperFinalized ? 1 : 0)),
  );

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            {canEnter ? <Trophy className="size-4" strokeWidth={1.75} /> : <Lock className="size-4" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">结业考试</p>
            <h3 className="truncate text-sm font-medium">{title}</h3>
            {contest?.missing === true ? (
              <p className="mt-2 text-sm text-muted-foreground">考试不存在</p>
            ) : canManage ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {windowClosed ? '考试已结束。' : ''}
                学生需看完规定视频后才能参加。预览不能交卷。
              </p>
            ) : judging ? (
              <p className="mt-2 text-sm text-muted-foreground">已交卷，正在评测。</p>
            ) : passed && paperFinalized ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {contest?.examPassScore ? '已及格。' : '已交卷，不能再答。'}
              </p>
            ) : paperFinalized && canRetake ? (
              <p className="mt-2 text-sm text-muted-foreground">
                未及格{typeof contest?.examScore === 'number' ? `（${contest.examScore} 分）` : ''}，还可再考 {remainingAttempts} 次。
              </p>
            ) : paperFinalized ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {contest?.examPassScore ? '未及格，不能再考。' : '已交卷，不能再答。'}
              </p>
            ) : !canEnter && windowClosed ? (
              <p className="mt-2 text-sm text-muted-foreground">考试已结束</p>
            ) : showWatchLock ? (
              <>
                <Badge variant="secondary" className="mt-2 font-normal">
                  看完后才能参加考试
                </Badge>
                {noOpenVideos ? (
                  <p className="mt-2 text-sm text-muted-foreground">老师还没开放视频，还不能参加考试</p>
                ) : state.remaining > 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">还需看完 {state.remaining} 个视频</p>
                ) : null}
                {listed.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {listed.map((video) => (
                      <li key={video.id} className="truncate">
                        {video.title}
                      </li>
                    ))}
                    {state.remainingVideos.length > listed.length ? <li>…</li> : null}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canManage ? (
            <Button asChild variant="outline" size="sm" className="h-9">
              <a href={href}>预览考试</a>
            </Button>
          ) : paperFinalized ? (
            <>
              <Button asChild variant="outline" size="sm" className="h-9">
                <a href={href}>查看答卷</a>
              </Button>
              {canRetake ? (
                <Button asChild size="sm" className="h-9">
                  <a href={href}>再考一次</a>
                </Button>
              ) : null}
            </>
          ) : canEnter ? (
            <Button asChild size="sm" className="h-9">
              <a href={href}>进入考试</a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
