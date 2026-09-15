import { Lock, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CourseChapter, CourseExamBinding, CourseExamContestPreview, CourseStudentVideo } from './types';

export interface CourseExamWatchState {
  locked: boolean;
  remaining: number;
  remainingVideos: CourseStudentVideo[];
}

function chapterVideos(chapter: CourseChapter): CourseStudentVideo[] {
  const videos = [...(chapter.videos || [])];
  for (const section of chapter.sections || []) {
    videos.push(...(section.videos || []));
  }
  return videos;
}

export function collectCourseExamVideos(chapters: CourseChapter[], exam: CourseExamBinding): CourseStudentVideo[] {
  if (exam.gate === 'chapter') {
    const chapter = chapters.find((item) => item._id === exam.chapterId);
    return chapter ? chapterVideos(chapter) : [];
  }
  const videos: CourseStudentVideo[] = [];
  for (const chapter of chapters) {
    videos.push(...chapterVideos(chapter));
  }
  return videos;
}

function requiredDoneForPercent(total: number, percent: number): number {
  return Math.ceil((percent * total) / 100);
}

export function computeCourseExamWatchState(videos: CourseStudentVideo[], exam: CourseExamBinding): CourseExamWatchState {
  const incomplete = videos.filter((video) => video.completed !== true);
  const total = videos.length;
  const done = total - incomplete.length;

  if (exam.gate === 'percent') {
    const percent = exam.percent ?? 100;
    if (total === 0) return { locked: true, remaining: 0, remainingVideos: [] };
    if (Math.floor((100 * done) / total) >= percent) {
      return { locked: false, remaining: 0, remainingVideos: [] };
    }
    const remaining = Math.max(0, requiredDoneForPercent(total, percent) - done);
    return { locked: true, remaining, remainingVideos: incomplete.slice(0, remaining) };
  }

  if (total === 0) return { locked: true, remaining: 0, remainingVideos: [] };
  if (incomplete.length === 0) return { locked: false, remaining: 0, remainingVideos: [] };
  return { locked: true, remaining: incomplete.length, remainingVideos: incomplete };
}

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

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            {state.locked ? <Lock className="size-4" strokeWidth={1.75} /> : <Trophy className="size-4" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">结业考试</p>
            <h3 className="truncate text-sm font-medium">{title}</h3>
            {state.locked ? (
              <>
                <Badge variant="secondary" className="mt-2 font-normal">
                  看完后才能参加考试
                </Badge>
                {state.remaining > 0 ? (
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
          {state.locked ? null : (
            <Button asChild size="sm" className="h-9">
              <a href={href}>进入考试</a>
            </Button>
          )}
          {canManage ? (
            <Button asChild variant="outline" size="sm" className="h-9">
              <a href={href}>预览考试</a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
