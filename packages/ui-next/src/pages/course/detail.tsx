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
  EyeOff,
  FileText,
  FolderInput,
  ListTree,
  Pencil,
  Trophy,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import {
  PracticeRosterCard,
  readPracticeRosterExamFact,
  readPracticeRosterExamMeta,
  type PracticeRosterMember,
  type PracticeRosterProblem,
} from '@/components/practice-roster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { EmptyState } from '@/components/ui/empty-state';
import { type MiniTabItem, MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar, Workspace } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import { CourseExamCard } from './course-exam-card';
import { CourseMindmapView } from './mindmap';
import {
  courseAssignsUserGroups,
  readCourseExam,
  readCourseExamContest,
  type CourseChapter,
  type CourseFile,
  type CourseMindmapData,
  type CourseRecord,
} from './types';
import { CourseMark, CourseProgressRing, CourseSectionHeader } from './ui';
import { CourseVideoPlaylist } from './video-player';

const COURSE_COLLECT_STATUSES = ['draft', 'published', 'closed', 'archived'] as const;
type CourseCollectStatus = (typeof COURSE_COLLECT_STATUSES)[number];

interface CourseCollectRequest {
  _id: string;
  title: string;
  dueAt: string;
  status: CourseCollectStatus;
  chapterId: number | null;
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
    if (item.chapterId !== undefined && item.chapterId !== null && (typeof item.chapterId !== 'number' || !Number.isSafeInteger(item.chapterId))) {
      throw new TypeError(`collectRequests[${index}].chapterId must be an integer or null`);
    }
    return {
      _id: id,
      title,
      dueAt,
      status: item.status,
      chapterId: typeof item.chapterId === 'number' ? item.chapterId : null,
    };
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

const ROW_LINK = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

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
    <section aria-labelledby="course-problems-title">
      <Panel flush>
        <CourseSectionHeader id="course-problems-title" title={title} count={count} />
        <ol className="divide-y divide-line-subtle">
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
                  className={cn('flex min-h-11 items-center gap-3 px-3 py-2.5 hover:bg-surface-hover', ROW_LINK)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-md text-2xs font-semibold tabular leading-none',
                      done ? 'bg-success-soft text-success-fg' : 'bg-surface-active text-fg-subtle',
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {problem.title || `P${pid}`}
                  </span>
                  {done ? <span className="sr-only">已完成</span> : null}
                  <span className="shrink-0 font-mono text-2xs text-fg-subtle">{problem.pid || `P${pid}`}</span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                </a>
              </li>
            );
          })}
        </ol>
      </Panel>
    </section>
  );
}

function CollectRequestList({
  requests,
  canManage,
  title = '文件收集',
  className,
}: {
  requests: CourseCollectRequest[];
  canManage: boolean;
  title?: string;
  className?: string;
}) {
  if (!requests.length) return <div data-course-slot="collect" />;
  const headingId = title === '本章收集' ? 'course-chapter-collect-title' : 'course-collect-title';
  return (
    <section data-course-slot="collect" aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <h3 id={headingId} className="text-sm font-semibold text-fg">
        {title}
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {requests.map((request) => {
          const href = canManage ? `/admin/collect/${request._id}` : `/collect/${request._id}`;
          return (
            <li key={request._id}>
              <a
                href={href}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs',
                  'transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard) hover:border-line-strong hover:shadow-sm',
                  ROW_LINK,
                )}
              >
                <FolderInput className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{request.title}</span>
                  <span className="text-xs text-fg-subtle">
                    {collectStatusLabel(request.status, request.dueAt)} · <DateTime value={request.dueAt} mode="datetime" />
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ContestList({ chapter, contests }: { chapter: CourseChapter; contests: Record<string, CourseRecord> }) {
  if (!chapter.tids.length) return null;
  return (
    <section aria-labelledby="course-contests-title" className="flex flex-col gap-3">
      <h3 id="course-contests-title" className="text-sm font-semibold text-fg">
        比赛与作业
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {chapter.tids.map((contestId) => {
          const contest = contests[contestId] || {};
          const homework = contest.rule === 'homework';
          const href = homework ? `/homework/${contestId}` : `/contest/${contestId}`;
          return (
            <li key={contestId}>
              <a
                href={href}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs',
                  'transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard) hover:border-line-strong hover:shadow-sm',
                  ROW_LINK,
                )}
              >
                {homework ? <ClipboardPlus className="size-4 text-fg-subtle" strokeWidth={1.75} /> : <Trophy className="size-4 text-fg-subtle" strokeWidth={1.75} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{contest.title || '比赛'}</span>
                  <span className="text-xs text-fg-subtle">{homework ? '作业' : '比赛'}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
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
    <nav aria-label="章节导航" className="grid gap-2 sm:grid-cols-2">
      {previous ? (
        <Button type="button" variant="secondary" className="w-full min-w-0" onClick={() => onSelect(previous._id)}>
          <ArrowLeft />
          <span className="truncate">上一章 {previous.title}</span>
        </Button>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}
      {next ? (
        <Button type="button" variant="secondary" className="w-full min-w-0" onClick={() => onSelect(next._id)}>
          <span className="truncate">下一章 {next.title}</span>
          <ArrowRight />
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
    view: 'overview' | 'mindmap' | 'roster';
    courseMindmap: CourseMindmapData | null;
    staleReferencedProblemSetIds?: string[];
    integrityControlled?: boolean;
    canViewRoster?: boolean;
    members?: PracticeRosterMember[];
    membersTruncated?: boolean;
    rosterProblems?: PracticeRosterProblem[];
    rosterGroupIds?: string[];
    rosterExam?: unknown;
    rosterExamWarning?: unknown;
    courseExamContest?: unknown;
  };
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id);
  const chapters = data.chapters || [];
  const courseExam = readCourseExam(course.courseExam);
  const courseExamContest = readCourseExamContest(data.courseExamContest);
  const collectRequests = readCourseCollectRequests(data.collectRequests);
  const { activeId, activeSectionId, selectChapter, selectSection } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];
  const chapterSections = activeChapter?.sections || [];
  const activeSection = chapterSections.find((section) => section._id === activeSectionId) || null;
  const activeView = data.view === 'mindmap' ? 'mindmap' : data.view === 'roster' ? 'roster' : 'overview';
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

  const viewItems: MiniTabItem<'overview' | 'mindmap' | 'roster'>[] = [
    { value: 'overview', label: '内容', href: `/course/${tid}` },
    { value: 'mindmap', label: '知识导图', href: `/course/${tid}?view=mindmap` },
  ];
  if (data.canViewRoster) {
    viewItems.push({ value: 'roster', label: '名单', icon: Users, href: `/course/${tid}?view=roster` });
  }

  return (
    <Workspace className="w-full min-w-0">
      <Toolbar className="min-h-10 shrink-0 border-b border-line bg-surface px-2">
        <span className="min-w-0 truncate text-sm font-semibold text-fg">{course.title}</span>
        <Button asChild variant="ghost" size="sm" iconOnly>
          <a href="/course" aria-label="返回课程列表">
            <ArrowLeft strokeWidth={1.75} />
          </a>
        </Button>
        <CourseMark seed={tid} title={course.title || ''} className="size-6 text-xs" />
        <span className="hidden min-w-0 truncate text-xs text-fg-subtle sm:inline">
          {data.udoc?.uname || '课程'}
          {course.term ? ` · ${course.term}` : ''}
        </span>
        {data.canManage && course.courseHidden ? (
          <Badge tone="neutral" className="gap-1">
            <EyeOff className="size-3" strokeWidth={1.75} />
            已对学生隐藏
          </Badge>
        ) : null}
        {data.canManage ? (
          <Button asChild variant="primary" size="sm">
            <a
              href={
                activeView === 'mindmap'
                  ? `/course/${tid}/edit#course-mindmap-settings`
                  : `/course/${tid}/edit?chapter=${activeChapter?._id || ''}`
              }
            >
              <Pencil strokeWidth={1.75} />
              编辑
            </a>
          </Button>
        ) : null}
        {data.canManage ? (
          <Button asChild variant="secondary" size="sm">
            <a href={`/course/${tid}/videos`}>观看统计</a>
          </Button>
        ) : null}
        {data.canCreateCollect ? (
          <Button asChild variant="secondary" size="sm">
            <a href={`/admin/collect/create?fromCourse=${encodeURIComponent(tid)}`}>
              <FolderInput strokeWidth={1.75} />
              布置收集
            </a>
          </Button>
        ) : null}
        {data.canManage && data.canCreate ? (
          <form method="post" action={`/course/${tid}/edit`}>
            <input type="hidden" name="operation" value="copy" />
            <Button type="submit" variant="ghost" size="sm">
              <Copy strokeWidth={1.75} />
              复制为新课程
            </Button>
          </form>
        ) : null}
        {!courseAssignsUserGroups(course) && data.canEnroll ? (
          <form method="post" action={`/course/${tid}`}>
            <input type="hidden" name="operation" value="enroll" />
            <Button type="submit" variant={data.canManage ? 'soft' : 'primary'} size="sm">
              报名
            </Button>
          </form>
        ) : !courseAssignsUserGroups(course) && data.tsdoc?.enroll ? (
          <Badge tone="success" className="gap-1">
            <CheckCircle2 className="size-3.5" strokeWidth={2} />
            已报名
          </Badge>
        ) : null}
      </Toolbar>
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <MiniTabs<'overview' | 'mindmap' | 'roster'> aria-label="课程视图" size="sm" value={activeView} items={viewItems} />
      </div>
      {/* ds-allow DS004: 左栏 18rem 加剩余内容的工作区分栏，间距档位写不出这条轨道 */}
      <div className="grid min-h-0 w-full min-w-0 flex-1 overflow-y-auto lg:grid-cols-[18rem_minmax(0,1fr)] lg:overflow-hidden">
        <aside className="flex min-h-0 flex-col border-b border-line lg:w-72 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-3">
            {totalProblems ? (
              <CourseProgressRing value={overallProgress} size={40} thickness={4} label={`课程完成进度 ${overallProgress}%`} />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">目录</p>
              <p className="text-xs text-fg-subtle">
                {totalProblems ? `${finishedChapters}/${chapters.length} 章完成` : `${chapters.length} 章`}
              </p>
            </div>
          </div>
          <div className="p-1.5">
            <ChapterOutline
              chapters={chapters}
              activeId={activeChapter?._id ?? null}
              activeSectionId={activeSectionId}
              onSelect={(chapterId, sectionId) => (sectionId == null ? selectChapter(chapterId) : selectSection(chapterId, sectionId))}
            />
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col gap-6 p-4 lg:overflow-y-auto">
          {activeView === 'overview' && course.content ? (
            <Panel flush>
              <details>
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">课程说明</summary>
                <div className="border-t border-line-subtle px-4 py-3">
                  <h3 id="course-overview-title" className="sr-only">
                    课程说明
                  </h3>
                  <MarkdownView content={course.content} preferredLang={bs.locale} />
                </div>
              </details>
            </Panel>
          ) : null}

          {Array.isArray(data.staleReferencedProblemSetIds) && data.staleReferencedProblemSetIds.length ? (
            <p role="alert" className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-fg">
              有 {data.staleReferencedProblemSetIds.length} 个章节引用的题集已不可用，这些章节的引用题目暂时不会出现在进度里。
            </p>
          ) : null}

          {activeView === 'overview' ? (
            <>
              <CourseExamCard
                exam={courseExam}
                contest={courseExamContest}
                chapters={chapters}
                canManage={data.canManage}
              />
              <CollectRequestList
                requests={collectRequests.filter((request) => request.chapterId == null)}
                canManage={data.canManage}
                title="本课收集"
              />
            </>
          ) : null}

          {activeView === 'mindmap' ? (
            <CourseMindmapView
              tid={tid}
              data={data.courseMindmap || null}
              canManage={data.canManage}
              integrityControlled={data.integrityControlled === true}
            />
          ) : activeView === 'roster' ? (
            <PracticeRosterCard
              className="mt-0"
              members={(Array.isArray(data.members) ? data.members : []).map((member, index) => {
                const raw = member as PracticeRosterMember & { exam?: unknown };
                if (raw.exam === undefined) return member;
                return { ...member, exam: readPracticeRosterExamFact(raw.exam, `members[${index}].exam`) };
              })}
              problems={Array.isArray(data.rosterProblems) ? data.rosterProblems : []}
              title={course.title || '课程'}
              truncated={!!data.membersTruncated}
              visibleGroupIds={Array.isArray(data.rosterGroupIds) ? data.rosterGroupIds : undefined}
              exam={readPracticeRosterExamMeta(data.rosterExam)}
              examWarning={typeof data.rosterExamWarning === 'string' ? data.rosterExamWarning : undefined}
            />
          ) : !chapters.length ? (
            <EmptyState
              icon={<BookOpen />}
              title="还没有章节"
              action={data.canManage ? (
                <Button asChild variant="secondary">
                  <a href={`/course/${tid}/edit`}>
                    <Pencil strokeWidth={1.75} />
                    去编辑
                  </a>
                </Button>
              ) : undefined}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-fg-subtle">
                    第 {chapterIndex + 1} 章 / 共 {chapters.length} 章
                    {activeSection
                      ? ` · ${chapterSections.findIndex((section) => section._id === activeSection._id) + 1}/${chapterSections.length} 节`
                      : chapterSections.length
                        ? ` · ${chapterSections.length} 节`
                        : ''}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-balance text-fg">
                    {activeSection ? activeSection.title : activeChapter.title}
                  </h2>
                  <Button type="button" variant="secondary" size="sm" className="lg:hidden" onClick={() => setOutlineOpen(true)}>
                    <ListTree strokeWidth={1.75} />
                    切换章节
                  </Button>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {(activeSection ? activeSection.totalCount : activeChapter.totalCount) ? (
                    <div className="flex items-center gap-3 pr-1">
                      <CourseProgressRing
                        value={activeSection ? activeSection.progress : activeChapter.progress}
                        size={48}
                        thickness={5}
                        label={`${activeSection ? '本小节' : '本章'}完成进度 ${activeSection ? activeSection.progress : activeChapter.progress}%`}
                      />
                      <p className="text-sm text-fg-subtle tabular">
                        {activeSection ? activeSection.doneCount : activeChapter.doneCount}/
                        {activeSection ? activeSection.totalCount : activeChapter.totalCount}
                      </p>
                    </div>
                  ) : null}
                  {!activeSection && data.canCreateCollect ? (
                    <Button asChild variant="secondary" size="sm">
                      <a href={`/admin/collect/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                        <FolderInput strokeWidth={1.75} />
                        布置收集
                      </a>
                    </Button>
                  ) : null}
                  <span data-course-slot="quiz">
                    {!activeSection && data.canCreateQuiz ? (
                      <Button asChild variant="secondary" size="sm">
                        <a href={`/homework/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                          <ClipboardPlus strokeWidth={1.75} />
                          创建小测
                        </a>
                      </Button>
                    ) : null}
                  </span>
                </div>
              </div>

              {activeSection ? (
                <>
                  <CourseVideoPlaylist courseId={tid} videos={activeSection.videos || []} />
                  {data.canManage && !(activeSection.videos || []).length ? (
                    <Panel>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-fg-muted">这一节还没有视频</p>
                        <Button asChild variant="secondary" size="sm">
                          <a href={`/course/${tid}/edit?chapter=${activeChapter._id}&section=${activeSection._id}`}>去上传</a>
                        </Button>
                      </div>
                    </Panel>
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
                    <EmptyState compact title="该小节暂无内容" />
                  ) : null}
                </>
              ) : (
                <>
                  <CourseVideoPlaylist courseId={tid} videos={activeChapter.videos || []} />
                  {data.canManage && !(activeChapter.videos || []).length && !chapterSections.length ? (
                    <Panel>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-fg-muted">这一章还没有视频</p>
                        <Button asChild variant="secondary" size="sm">
                          <a href={`/course/${tid}/edit?chapter=${activeChapter._id}`}>去上传</a>
                        </Button>
                      </div>
                    </Panel>
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
                    <section aria-labelledby="course-sections-title">
                      <Panel flush>
                        <CourseSectionHeader id="course-sections-title" title="本章小节" />
                        <ol className="divide-y divide-line-subtle">
                          {chapterSections.map((section, sectionIndex) => (
                            <li key={section._id}>
                              {/* ds-allow DS005: 小节行同时放序号、标题和进度，固定高度的 Button 会裁掉这三列 */}
                              <button
                                type="button"
                                onClick={() => selectSection(activeChapter._id, section._id)}
                                className={cn(
                                  'flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover',
                                  ROW_LINK,
                                )}
                              >
                                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-active text-2xs font-semibold tabular text-fg-subtle">
                                  {sectionIndex + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{section.title}</span>
                                {section.totalCount ? (
                                  <span className="shrink-0 text-xs text-fg-subtle tabular">
                                    {section.doneCount}/{section.totalCount}
                                  </span>
                                ) : (section.videos || []).length ? (
                                  <span className="shrink-0 text-xs text-fg-subtle">{(section.videos || []).length} 个视频</span>
                                ) : null}
                                <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                              </button>
                            </li>
                          ))}
                        </ol>
                      </Panel>
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
                title="本章收集"
              />
              {data.canDownloadFiles && data.files?.length ? (
                <section data-course-slot="files" aria-labelledby="course-files-title">
                  <Panel flush>
                    <CourseSectionHeader id="course-files-title" title="课件" />
                    <ul className="divide-y divide-line-subtle">
                      {data.files.map((file) => (
                        <li key={file.name}>
                          <a
                            href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                            className={cn('flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface-hover', ROW_LINK)}
                          >
                            <FileText className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                            <span className="min-w-0 flex-1 truncate font-medium text-fg">{file.name}</span>
                            <Download className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </section>
              ) : (
                <div data-course-slot="files" />
              )}
              {!course.content &&
              !activeChapter.content &&
              !(activeChapter.videos || []).length &&
              !activeChapter.loosePids.length &&
              !activeChapter.tids.length &&
              !chapterSections.length &&
              !activeSection &&
              !collectRequests.some((request) => request.chapterId === activeChapter._id) &&
              data.canCreateCollect !== true ? (
                <EmptyState compact title="本章暂无内容" />
              ) : null}

              <ChapterPager
                previous={chapterIndex > 0 ? chapters[chapterIndex - 1] : null}
                next={chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null}
                onSelect={selectChapter}
              />
            </>
          )}
        </div>
      </div>

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-80">
          <SheetHeader>
            <SheetTitle>课程目录</SheetTitle>
          </SheetHeader>
          <SheetBody className="p-4">
            <ChapterOutline chapters={chapters} activeId={activeChapter?._id || null} activeSectionId={activeSectionId} onSelect={selectFromMobile} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Workspace>
  );
}
