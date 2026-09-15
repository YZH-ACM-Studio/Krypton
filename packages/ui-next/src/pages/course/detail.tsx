import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardPlus,
  Copy,
  Download,
  FileText,
  FolderInput,
  ListTree,
  Pencil,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { PracticeRosterCard, type PracticeRosterMember, type PracticeRosterProblem } from '@/components/practice-roster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import { CourseMindmapView } from './mindmap';
import type { CourseChapter, CourseFile, CourseMindmapData, CourseRecord } from './types';
import { CourseMark, CourseProgressRing } from './ui';
import { CourseVideoPlaylist } from './video-player';

const COURSE_COLLECT_STATUSES = ['draft', 'published', 'closed', 'archived'] as const;
type CourseCollectStatus = (typeof COURSE_COLLECT_STATUSES)[number];

interface CourseCollectRequest {
  _id: string;
  title: string;
  dueAt: string;
  status: CourseCollectStatus;
  chapterId: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCourseCollectStatus(value: unknown): value is CourseCollectStatus {
  return typeof value === 'string' && (COURSE_COLLECT_STATUSES as readonly string[]).includes(value);
}

function readCourseCollectRequests(value: unknown): CourseCollectRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('collectRequests must be an array');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`collectRequests[${index}] must be an object`);
    const id = typeof item._id === 'string' ? item._id : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const dueAt = typeof item.dueAt === 'string' ? item.dueAt : '';
    if (!id) throw new TypeError(`collectRequests[${index}]._id must be a string`);
    if (!title) throw new TypeError(`collectRequests[${index}].title must be a string`);
    if (!dueAt || Number.isNaN(Date.parse(dueAt))) throw new TypeError(`collectRequests[${index}].dueAt must be an ISO date`);
    if (!isCourseCollectStatus(item.status)) throw new TypeError(`collectRequests[${index}].status is invalid`);
    if (typeof item.chapterId !== 'number' || !Number.isSafeInteger(item.chapterId)) {
      throw new TypeError(`collectRequests[${index}].chapterId must be an integer`);
    }
    return { _id: id, title, dueAt, status: item.status, chapterId: item.chapterId };
  });
}

function collectStatusLabel(status: CourseCollectStatus, dueAt: string): string {
  if (status === 'draft') return '草稿';
  if (status === 'closed') return '已关闭';
  if (status === 'archived') return '已归档';
  const due = Date.parse(dueAt);
  if (Number.isFinite(due) && due <= Date.now()) return '已截止';
  return '收集中';
}

/**
 * Chapter problems.
 *
 * The leading slot carries completion state rather than a bare ordinal:
 * whether a problem is done is the reason a learner scans this list, and
 * the mark comes from the server's scoped completion set so it always
 * agrees with the chapter counter above it.
 */
function ProblemList({
  pids,
  completedPids,
  problems,
  courseId,
  chapterId,
  title = '题目',
  count,
}: {
  pids: number[];
  completedPids: number[];
  problems: Record<string, CourseRecord>;
  courseId: string;
  chapterId: number;
  title?: string;
  description?: string;
  count?: string;
}) {
  if (!pids.length) return null;
  const completed = new Set(completedPids || []);
  return (
    <section aria-labelledby="course-problems-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 id="course-problems-title" className="text-sm font-medium">
          {title}
        </h3>
        {count ? <span className="text-xs text-muted-foreground">{count}</span> : null}
      </div>
      <ol className="overflow-hidden rounded-xl border bg-card">
        {pids.map((pid, index) => {
          const problem = problems[String(pid)] || {};
          const done = completed.has(pid);
          return (
            <li key={pid}>
              <a
                href={practiceProblemEntryUrl(`/p/${problem.pid || pid}`, {
                  containerKind: 'course',
                  containerId: courseId,
                  scopeKind: 'chapter',
                  scopeId: chapterId,
                })}
                className={cn(
                  'group flex min-h-11 items-center gap-3 px-3 py-2.5 hover:bg-muted/50',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums leading-none',
                    done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium transition-colors duration-150 group-hover:text-primary motion-reduce:transition-none">
                  {problem.title || `P${pid}`}
                </span>
                {done ? <span className="sr-only">已完成</span> : null}
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{problem.pid || `P${pid}`}</span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground motion-reduce:transition-none"
                  strokeWidth={1.75}
                />
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CollectRequestList({
  requests,
  canManage,
  canCreate,
  courseId,
  chapterId,
}: {
  requests: CourseCollectRequest[];
  canManage: boolean;
  canCreate: boolean;
  courseId: string;
  chapterId: number;
}) {
  if (!requests.length && !canCreate) return null;
  return (
    <section data-course-slot="collect" aria-labelledby="course-collect-title" className="space-y-3">
      {requests.length ? (
        <>
          <h3 id="course-collect-title" className="text-sm font-medium">
            文件收集
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {requests.map((request) => {
              const href = canManage ? `/admin/collect/${request._id}` : `/collect/${request._id}`;
              return (
                <li key={request._id}>
                  <a href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="transition-colors hover:bg-muted/40">
                      <CardContent className="flex min-h-11 items-center gap-3 p-3">
                        <FolderInput className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{request.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {collectStatusLabel(request.status, request.dueAt)} · <DateTime value={request.dueAt} mode="datetime" />
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
                      </CardContent>
                    </Card>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <h3 id="course-collect-title" className="sr-only">
          文件收集
        </h3>
      )}
      {canCreate ? (
        <Button asChild variant="ghost" size="sm" className="h-9 gap-1.5">
          <a href={`/admin/collect/create?fromCourse=${encodeURIComponent(courseId)}&chapter=${chapterId}`}>
            <FolderInput className="size-4" strokeWidth={1.75} />
            布置文件收集
          </a>
        </Button>
      ) : null}
    </section>
  );
}

function ContestList({ chapter, contests }: { chapter: CourseChapter; contests: Record<string, CourseRecord> }) {
  if (!chapter.tids.length) return null;
  return (
    <section aria-labelledby="course-contests-title" className="space-y-3">
      <h3 id="course-contests-title" className="text-sm font-medium">
        比赛与作业
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {chapter.tids.map((contestId) => {
          const contest = contests[contestId] || {};
          const homework = contest.rule === 'homework';
          const href = homework ? `/homework/${contestId}` : `/contest/${contestId}`;
          return (
            <li key={contestId}>
              <a href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex min-h-11 items-center gap-3 p-3">
                    {homework ? <ClipboardPlus className="size-4 text-muted-foreground" strokeWidth={1.75} /> : <Trophy className="size-4 text-muted-foreground" strokeWidth={1.75} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{contest.title || '比赛'}</span>
                      <span className="text-xs text-muted-foreground">{homework ? '作业' : '比赛'}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
                  </CardContent>
                </Card>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Linear courses need a way forward; the previous page ended in a dead stop. */
function ChapterPager({
  previous,
  next,
  onSelect,
}: {
  previous: CourseChapter | null;
  next: CourseChapter | null;
  onSelect: (chapterId: number) => void;
}) {
  if (!previous && !next) return null;
  return (
    <nav aria-label="章节导航" className="grid gap-2 pt-2 sm:grid-cols-2">
      {previous ? (
        <Button type="button" variant="outline" className="h-auto justify-start px-4 py-3" onClick={() => onSelect(previous._id)}>
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              上一章
            </span>
            <span className="truncate text-sm font-medium">{previous.title}</span>
          </span>
        </Button>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}
      {next ? (
        <Button type="button" variant="outline" className="h-auto justify-end px-4 py-3" onClick={() => onSelect(next._id)}>
          <span className="flex min-w-0 flex-col items-end gap-0.5">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              下一章
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </span>
            <span className="truncate text-sm font-medium">{next.title}</span>
          </span>
        </Button>
      ) : null}
    </nav>
  );
}

export function CourseDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: CourseRecord;
    chapters: CourseChapter[];
    pdict: Record<string, CourseRecord>;
    cdict: Record<string, CourseRecord>;
    udoc?: CourseRecord;
    canManage: boolean;
    canCreate?: boolean;
    canCreateQuiz: boolean;
    canCreateCollect?: boolean;
    collectRequests?: unknown;
    canEnroll: boolean;
    canDownloadFiles: boolean;
    tsdoc?: CourseRecord;
    files: CourseFile[];
    view: 'overview' | 'mindmap';
    courseMindmap: CourseMindmapData | null;
    integrityControlled?: boolean;
    members?: PracticeRosterMember[];
    membersTruncated?: boolean;
    rosterProblems?: PracticeRosterProblem[];
    rosterGroupIds?: string[];
  };
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id);
  const chapters = data.chapters || [];
  const collectRequests = readCourseCollectRequests(data.collectRequests);
  const { activeId, activeSectionId, selectChapter, selectSection } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];
  const chapterSections = activeChapter?.sections || [];
  const activeSection = chapterSections.find((section) => section._id === activeSectionId) || null;
  const activeView = data.view === 'mindmap' ? 'mindmap' : 'overview';
  const [outlineOpen, setOutlineOpen] = useState(false);
  const chapterIndex = chapters.findIndex((chapter) => chapter._id === activeChapter?._id);

  // Course-level totals, derived from the same scoped chapter figures.
  const totalProblems = chapters.reduce((sum, chapter) => sum + chapter.totalCount, 0);
  const doneProblems = chapters.reduce((sum, chapter) => sum + chapter.doneCount, 0);
  const overallProgress = totalProblems ? Math.floor((100 * doneProblems) / totalProblems) : 0;
  const finishedChapters = chapters.filter((chapter) => chapter.totalCount > 0 && chapter.doneCount === chapter.totalCount).length;

  const selectFromMobile = (chapterId: number, sectionId?: number | null) => {
    if (sectionId == null) selectChapter(chapterId);
    else selectSection(chapterId, sectionId);
    setOutlineOpen(false);
  };

  return (
    <main className="w-full min-w-0 pb-10">
      {/* Masthead is chrome: it holds identity and actions, and deliberately
          stays below the chapter in visual weight. Two 2xl headings fighting
          each other is what made the old page read as centre-less. */}
      <header className="mb-6 flex flex-wrap items-center gap-3 border-b pb-5">
        <Button asChild variant="ghost" size="icon" className="-ml-2 size-10 shrink-0">
          <a href="/course" aria-label="返回课程列表">
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </a>
        </Button>
        <CourseMark seed={tid} title={course.title || ''} className="size-10 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{course.title}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {data.udoc?.uname || '课程'}
            {course.term ? ` · ${course.term}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {data.canManage ? (
            <Button asChild size="sm" className="h-9 gap-1.5">
              <a
                href={
                  activeView === 'mindmap'
                    ? `/course/${tid}/edit#course-mindmap-settings`
                    : `/course/${tid}/edit?chapter=${activeChapter?._id || ''}`
                }
              >
                <Pencil className="size-3.5" strokeWidth={1.75} />
                编辑
              </a>
            </Button>
          ) : null}
          {data.canManage ? (
            <Button asChild variant="outline" size="sm" className="h-9">
              <a href={`/course/${tid}/videos`}>观看统计</a>
            </Button>
          ) : null}
          {data.canManage && data.canCreate ? (
            <form method="post" action={`/course/${tid}/edit`}>
              <input type="hidden" name="operation" value="copy" />
              <Button type="submit" variant="ghost" size="sm" className="h-9 gap-1.5">
                <Copy className="size-3.5" strokeWidth={1.75} />
                复制为新课程
              </Button>
            </form>
          ) : null}
          {data.canEnroll ? (
            <form method="post" action={`/course/${tid}`}>
              <input type="hidden" name="operation" value="enroll" />
              <Button type="submit" size="sm" className="h-9">
                报名
              </Button>
            </form>
          ) : data.tsdoc?.enroll ? (
            <Badge variant="secondary" className="h-9 gap-1 px-3 font-normal">
              <CheckCircle2 className="size-3.5" strokeWidth={2} />
              已报名
            </Badge>
          ) : null}
        </div>
      </header>

      {activeView === 'overview' && course.content ? (
        <details className="mb-6 rounded-xl border bg-card shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">课程说明</summary>
          <div className="border-t px-4 py-3">
            <h3 id="course-overview-title" className="sr-only">
              课程说明
            </h3>
            <MarkdownView content={course.content} preferredLang={bs.locale} />
          </div>
        </details>
      ) : null}

      <div className="mb-6 inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground" aria-label="课程视图">
        <a
          href={`/course/${tid}`}
          className={cn(
            'inline-flex items-center rounded-md px-3 py-1 text-sm font-medium',
            activeView === 'overview' && 'bg-background text-foreground shadow',
          )}
        >
          内容
        </a>
        <a
          href={`/course/${tid}?view=mindmap`}
          className={cn(
            'inline-flex items-center rounded-md px-3 py-1 text-sm font-medium',
            activeView === 'mindmap' && 'bg-background text-foreground shadow',
          )}
        >
          知识导图
        </a>
      </div>

      {activeView === 'mindmap' ? (
        <CourseMindmapView
          tid={tid}
          data={data.courseMindmap || null}
          canManage={data.canManage}
          integrityControlled={data.integrityControlled === true}
        />
      ) : !chapters.length ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BookOpen className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="mt-4 text-sm font-medium">还没有章节</p>
            {data.canManage ? (
              <Button asChild className="mt-4 gap-1.5">
                <a href={`/course/${tid}/edit`}>
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  去编辑
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 w-full gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] xl:gap-8">
          <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
            <Card className="overflow-hidden py-0">
              <div className="flex items-center gap-3 border-b px-4 py-3">
                {totalProblems ? (
                  <CourseProgressRing value={overallProgress} size={40} thickness={4} label={`课程完成进度 ${overallProgress}%`} />
                ) : null}
                <div className="min-w-0">
                  <p className="text-sm font-medium">目录</p>
                  <p className="text-xs text-muted-foreground">
                    {totalProblems ? `${finishedChapters}/${chapters.length} 章完成` : `${chapters.length} 章`}
                  </p>
                </div>
              </div>
              <div className="p-1.5">
                <ChapterOutline
                  chapters={chapters}
                  activeId={activeChapter._id}
                  activeSectionId={activeSectionId}
                  onSelect={(chapterId, sectionId) => (sectionId == null ? selectChapter(chapterId) : selectSection(chapterId, sectionId))}
                />
              </div>
            </Card>
          </aside>

          <article className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  第 {chapterIndex + 1} 章 / 共 {chapters.length} 章
                  {activeSection
                    ? ` · ${chapterSections.findIndex((section) => section._id === activeSection._id) + 1}/${chapterSections.length} 节`
                    : chapterSections.length
                      ? ` · ${chapterSections.length} 节`
                      : ''}
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight">
                  {activeSection ? activeSection.title : activeChapter.title}
                </h2>
                <Button type="button" variant="outline" size="sm" className="mt-3 h-9 gap-1.5 lg:hidden" onClick={() => setOutlineOpen(true)}>
                  <ListTree className="size-3.5" strokeWidth={1.75} />
                  切换章节
                </Button>
              </div>
              {(activeSection ? activeSection.totalCount : activeChapter.totalCount) ? (
                <div className="flex shrink-0 items-center gap-3">
                  <CourseProgressRing
                    value={activeSection ? activeSection.progress : activeChapter.progress}
                    size={48}
                    thickness={5}
                    label={`${activeSection ? '本小节' : '本章'}完成进度 ${activeSection ? activeSection.progress : activeChapter.progress}%`}
                  />
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {activeSection ? activeSection.doneCount : activeChapter.doneCount}/
                    {activeSection ? activeSection.totalCount : activeChapter.totalCount}
                  </p>
                </div>
              ) : null}
            </div>

            {activeSection ? (
              <>
                <CourseVideoPlaylist courseId={tid} videos={activeSection.videos || []} />
                {data.canManage && !(activeSection.videos || []).length ? (
                  <Card>
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <p className="text-sm text-muted-foreground">这一节还没有视频</p>
                      <Button asChild size="sm">
                        <a href={`/course/${tid}/edit?chapter=${activeChapter._id}&section=${activeSection._id}`}>去上传</a>
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}
                {activeSection.content ? (
                  <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title">
                    <h3 id="chapter-content-title" className="sr-only">
                      小节讲义
                    </h3>
                    <div className="text-pretty leading-relaxed">
                      <MarkdownView content={activeSection.content} preferredLang={bs.locale} />
                    </div>
                  </section>
                ) : (
                  <div data-course-slot="chapterContent" />
                )}
                <ProblemList
                  pids={activeSection.pids}
                  completedPids={activeSection.completedPids}
                  problems={data.pdict || {}}
                  courseId={tid}
                  chapterId={activeChapter._id}
                  title="小节小测"
                  count={`${activeSection.doneCount}/${activeSection.totalCount}`}
                />
                {!activeSection.content && !activeSection.pids.length && !(activeSection.videos || []).length ? (
                  <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">该小节暂无内容</CardContent>
                  </Card>
                ) : null}
              </>
            ) : (
              <>
                <CourseVideoPlaylist courseId={tid} videos={activeChapter.videos || []} />
                {data.canManage && !(activeChapter.videos || []).length && !chapterSections.length ? (
                  <Card>
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <p className="text-sm text-muted-foreground">这一章还没有视频</p>
                      <Button asChild size="sm">
                        <a href={`/course/${tid}/edit?chapter=${activeChapter._id}`}>去上传</a>
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}
                {activeChapter.content ? (
                  <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title">
                    <h3 id="chapter-content-title" className="sr-only">
                      章节讲义
                    </h3>
                    <div className="text-pretty leading-relaxed">
                      <MarkdownView content={activeChapter.content} preferredLang={bs.locale} />
                    </div>
                  </section>
                ) : (
                  <div data-course-slot="chapterContent" />
                )}
                {chapterSections.length ? (
                  <section aria-labelledby="course-sections-title" className="space-y-3">
                    <h3 id="course-sections-title" className="text-sm font-medium">
                      本章小节
                    </h3>
                    <ol className="overflow-hidden rounded-xl border bg-card">
                      {chapterSections.map((section, sectionIndex) => (
                        <li key={section._id} className="border-b last:border-b-0">
                          <button
                            type="button"
                            onClick={() => selectSection(activeChapter._id, section._id)}
                            className="group flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {sectionIndex + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.title}</span>
                            {section.totalCount ? (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {section.doneCount}/{section.totalCount}
                              </span>
                            ) : (section.videos || []).length ? (
                              <span className="shrink-0 text-xs text-muted-foreground">{(section.videos || []).length} 个视频</span>
                            ) : null}
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                <ProblemList
                  pids={activeChapter.loosePids}
                  completedPids={activeChapter.completedPids}
                  problems={data.pdict || {}}
                  courseId={tid}
                  chapterId={activeChapter._id}
                  title={chapterSections.length ? '本章题目' : '课堂小测'}
                  count={`${activeChapter.loosePids.filter((pid) => activeChapter.completedPids.includes(pid)).length}/${activeChapter.loosePids.length}`}
                />
                <ContestList chapter={activeChapter} contests={data.cdict || {}} />
              </>
            )}
            <CollectRequestList
              requests={collectRequests.filter((request) => request.chapterId === activeChapter._id)}
              canManage={data.canManage}
              canCreate={data.canCreateCollect === true}
              courseId={tid}
              chapterId={activeChapter._id}
            />
            {data.canDownloadFiles && data.files?.length ? (
              <section data-course-slot="files" aria-labelledby="course-files-title" className="space-y-3">
                <h3 id="course-files-title" className="text-sm font-medium">
                  课件
                </h3>
                <ul className="overflow-hidden rounded-xl border bg-card">
                  {data.files.map((file) => (
                    <li key={file.name} className="border-b last:border-b-0">
                      <a
                        href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                        className="flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                        <Download className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <div data-course-slot="files" />
            )}
            <section data-course-slot="quiz">
              {data.canCreateQuiz ? (
                <Button asChild variant="ghost" size="sm" className="h-9 gap-1.5">
                  <a href={`/homework/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                    <ClipboardPlus className="size-4" strokeWidth={1.75} />
                    创建本章小测
                  </a>
                </Button>
              ) : null}
            </section>

            {!course.content &&
            !activeChapter.content &&
            !(activeChapter.videos || []).length &&
            !activeChapter.loosePids.length &&
            !activeChapter.tids.length &&
            !chapterSections.length &&
            !activeSection &&
            !collectRequests.some((request) => request.chapterId === activeChapter._id) &&
            data.canCreateCollect !== true ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">本章暂无内容</CardContent>
              </Card>
            ) : null}

            <ChapterPager
              previous={chapterIndex > 0 ? chapters[chapterIndex - 1] : null}
              next={chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null}
              onSelect={selectChapter}
            />
          </article>
        </div>
      )}

      {activeView === 'overview' && Array.isArray(data.members) ? (
        <PracticeRosterCard
          members={data.members}
          problems={Array.isArray(data.rosterProblems) ? data.rosterProblems : []}
          title={course.title || '课程'}
          truncated={!!data.membersTruncated}
          visibleGroupIds={Array.isArray(data.rosterGroupIds) ? data.rosterGroupIds : undefined}
        />
      ) : null}

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-[22rem] max-w-[calc(100vw-1rem)]">
          <SheetHeader>
            <SheetTitle>课程目录</SheetTitle>
          </SheetHeader>
          <SheetBody className="p-4">
            <ChapterOutline chapters={chapters} activeId={activeChapter?._id || null} activeSectionId={activeSectionId} onSelect={selectFromMobile} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}
