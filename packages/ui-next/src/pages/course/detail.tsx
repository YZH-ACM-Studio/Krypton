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
  Network,
  Paperclip,
  Pencil,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { PracticeRosterCard, type PracticeRosterMember, type PracticeRosterProblem } from '@/components/practice-roster';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import { CourseMindmapView } from './mindmap';
import type { CourseChapter, CourseFile, CourseMindmapData, CourseRecord } from './types';
import { CourseMark, CourseProgressRing, CourseSectionHeader, riseStyle } from './ui';

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
  title = '课堂小测',
  description = '按当前顺序作答，完成后进度会记在本课里。',
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
      <CourseSectionHeader id="course-problems-title" title={title} description={description} count={count} />
      <ol className="krypton-course-panel overflow-hidden p-1.5">
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
                  'krypton-course-row group flex min-h-11 items-center gap-3 px-3 py-2.5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
                <span className="krypton-course-meta shrink-0 font-mono text-[11px]">{problem.pid || `P${pid}`}</span>
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
      <CourseSectionHeader id="course-collect-title" title="文件收集" description="本章布置的文件收集。不写入章节结构。" count={requests.length || undefined} />
      {requests.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {requests.map((request, index) => {
            const href = canManage ? `/admin/collect/${request._id}` : `/collect/${request._id}`;
            return (
              <li key={request._id} style={riseStyle(index)} className="krypton-course-rise">
                <a
                  href={href}
                  className={cn(
                    'krypton-course-panel krypton-course-lift flex min-h-11 items-center gap-3 px-3.5 py-3',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  )}
                >
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FolderInput className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{request.title}</span>
                    <span className="krypton-course-meta block">
                      {collectStatusLabel(request.status, request.dueAt)} · 截止 <DateTime value={request.dueAt} mode="datetime" />
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="krypton-course-meta">本章还没有文件收集。</p>
      )}
      {canCreate ? (
        <Button asChild variant="outline" className="min-h-11 gap-1.5">
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
      <CourseSectionHeader id="course-contests-title" title="比赛与作业" description="本章引用的正式评测活动。" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {chapter.tids.map((contestId, index) => {
          const contest = contests[contestId] || {};
          const homework = contest.rule === 'homework';
          const href = homework ? `/homework/${contestId}` : `/contest/${contestId}`;
          return (
            <li key={contestId} style={riseStyle(index)} className="krypton-course-rise">
              <a
                href={href}
                className={cn(
                  'krypton-course-panel krypton-course-lift flex min-h-11 items-center gap-3 px-3.5 py-3',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg',
                    homework ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400' : 'bg-primary/10 text-primary',
                  )}
                >
                  {homework ? <ClipboardPlus className="size-4" strokeWidth={1.75} /> : <Trophy className="size-4" strokeWidth={1.75} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{contest.title || '比赛'}</span>
                  <span className="krypton-course-meta block">{homework ? '作业' : '比赛'}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
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
    <nav aria-label="章节导航" className="grid gap-2 border-t border-border/60 pt-6 sm:grid-cols-2">
      {previous ? (
        <button
          type="button"
          onClick={() => onSelect(previous._id)}
          className={cn(
            'krypton-course-inset group flex min-h-16 flex-col justify-center gap-1 px-4 py-3 text-left',
            'transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-primary motion-reduce:transition-none',
          )}
        >
          <span className="krypton-course-meta inline-flex items-center gap-1.5">
            <ArrowLeft
              className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5 motion-reduce:transition-none"
              strokeWidth={1.75}
            />
            上一章
          </span>
          <span className="truncate text-sm font-medium">{previous.title}</span>
        </button>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => onSelect(next._id)}
          className={cn(
            'krypton-course-inset group flex min-h-16 flex-col justify-center gap-1 px-4 py-3 text-right',
            'transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-primary motion-reduce:transition-none',
          )}
        >
          <span className="krypton-course-meta inline-flex items-center justify-end gap-1.5">
            下一章
            <ArrowRight
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
              strokeWidth={1.75}
            />
          </span>
          <span className="truncate text-sm font-medium">{next.title}</span>
        </button>
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
      <header className="mb-6 border-b border-border/60 pb-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <Button asChild variant="ghost" size="icon" className="-ml-2 size-10 shrink-0">
            <a href="/course" aria-label="返回课程列表">
              <ArrowLeft className="size-4" strokeWidth={1.75} />
            </a>
          </Button>
          <CourseMark seed={tid} title={course.title || ''} className="size-11 text-lg" />
          <div className="min-w-0 flex-1">
            <p className="krypton-course-eyebrow truncate">
              {data.udoc?.uname || '课程'}
              {course.term ? ` · ${course.term}` : ''}
            </p>
            <h1 className="krypton-course-title mt-1 truncate">{course.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.canManage ? (
              <Button asChild variant="outline" size="sm" className="h-10 gap-1.5">
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
            {data.canManage && data.canCreate ? (
              <form method="post" action={`/course/${tid}/edit`}>
                <input type="hidden" name="operation" value="copy" />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-10 gap-1.5"
                  title="复制已保存的章节与设置到新课程，不复制课件、报名和真实性策略。"
                >
                  <Copy className="size-3.5" strokeWidth={1.75} />
                  复制为新课程
                </Button>
              </form>
            ) : null}
            {data.canEnroll ? (
              <form method="post" action={`/course/${tid}`}>
                <input type="hidden" name="operation" value="enroll" />
                <Button type="submit" size="sm" className="h-10 px-4 active:scale-[0.97]">
                  报名课程
                </Button>
              </form>
            ) : data.tsdoc?.enroll ? (
              <span
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 text-xs font-medium',
                  'text-emerald-700 dark:text-emerald-400',
                )}
              >
                <CheckCircle2 className="size-3.5" strokeWidth={2} />
                已报名
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <MiniTabs
            value={activeView}
            size="md"
            aria-label="课程视图"
            items={[
              { value: 'overview', label: '课程内容', icon: BookOpen, href: `/course/${tid}` },
              { value: 'mindmap', label: '知识导图', icon: Network, href: `/course/${tid}?view=mindmap` },
            ]}
          />
          {activeView === 'overview' && chapters.length ? (
            <p className="krypton-course-meta">
              {chapters.length} 章
              {chapters.reduce((sum, chapter) => sum + (chapter.sections?.length || 0), 0)
                ? ` · ${chapters.reduce((sum, chapter) => sum + (chapter.sections?.length || 0), 0)} 节`
                : ''}{' '}
              · {totalProblems} 题{totalProblems ? ` · 已完成 ${doneProblems}` : ''}
            </p>
          ) : null}
        </div>
      </header>

      {activeView === 'overview' && course.content ? (
        <details className="krypton-course-inset group mb-6 px-4 py-3">
          <summary
            className={cn(
              'flex cursor-pointer list-none items-center gap-2 text-sm font-medium marker:content-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            )}
          >
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
              strokeWidth={1.75}
            />
            课程说明
            <span className="krypton-course-meta group-open:hidden">展开介绍</span>
          </summary>
          <div className="krypton-course-measure mt-3 border-t border-border/50 pt-3">
            <h3 id="course-overview-title" className="sr-only">
              课程说明
            </h3>
            <MarkdownView content={course.content} preferredLang={bs.locale} />
          </div>
        </details>
      ) : null}

      {activeView === 'mindmap' ? (
        <CourseMindmapView
          tid={tid}
          data={data.courseMindmap || null}
          canManage={data.canManage}
          integrityControlled={data.integrityControlled === true}
        />
      ) : !chapters.length ? (
        <section className="krypton-course-hero krypton-course-grain px-6 py-20 text-center">
          <span className="relative z-10 mx-auto grid size-14 place-items-center rounded-2xl bg-background/80 text-muted-foreground shadow-sm">
            <BookOpen className="size-6" strokeWidth={1.5} />
          </span>
          <h2 className="krypton-course-section relative z-10 mt-5">课程还没有章节</h2>
          <p className="krypton-course-meta relative z-10 mt-1.5">课程负责人添加章节后会显示在这里。</p>
        </section>
      ) : (
        <div className="grid min-w-0 w-full gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] xl:gap-8">
          <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
            <div className="krypton-course-panel overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3.5">
                <CourseProgressRing value={overallProgress} size={44} thickness={4} label={`课程完成进度 ${overallProgress}%`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-5">课程目录</p>
                  <p className="krypton-course-meta">
                    {finishedChapters}/{chapters.length} 章完成
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
            </div>
          </aside>

          <article className="min-w-0 space-y-9">
            {/* The chapter is the subject of this page, so it gets the only
                display-scale type and the only ambient surface. */}
            <section className="krypton-course-hero krypton-course-grain px-5 py-6 sm:px-7 sm:py-7">
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="krypton-course-eyebrow">
                    第 {chapterIndex + 1} 章 / 共 {chapters.length} 章
                    {activeSection
                      ? ` · ${chapterSections.findIndex((section) => section._id === activeSection._id) + 1}/${chapterSections.length} 节`
                      : chapterSections.length
                        ? ` · ${chapterSections.length} 节`
                        : ''}
                  </p>
                  <h2 className="krypton-course-display mt-2">{activeSection ? activeSection.title : activeChapter.title}</h2>
                  <button
                    type="button"
                    onClick={() => setOutlineOpen(true)}
                    className={cn(
                      'mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-background/70 px-2.5 text-xs font-medium',
                      'shadow-sm transition-colors duration-150 hover:bg-background focus-visible:outline-none',
                      'focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none lg:hidden',
                    )}
                  >
                    <ListTree className="size-3.5" strokeWidth={1.75} />
                    切换章节
                  </button>
                </div>
                {(activeSection ? activeSection.totalCount : activeChapter.totalCount) ? (
                  <div className="flex shrink-0 items-center gap-3.5">
                    <CourseProgressRing
                      value={activeSection ? activeSection.progress : activeChapter.progress}
                      size={64}
                      thickness={6}
                      label={`${activeSection ? '本小节' : '本章'}完成进度 ${activeSection ? activeSection.progress : activeChapter.progress}%`}
                    />
                    <div>
                      <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
                        {activeSection ? activeSection.doneCount : activeChapter.doneCount}
                        <span className="text-base font-normal text-muted-foreground">
                          /{activeSection ? activeSection.totalCount : activeChapter.totalCount}
                        </span>
                      </p>
                      <p className="krypton-course-meta mt-1.5">{activeSection ? '本小节已完成' : '本章已完成'}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {activeSection ? (
              <>
                {activeSection.content ? (
                  <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title" className="space-y-3">
                    <CourseSectionHeader id="chapter-content-title" title="小节讲义" />
                    <div className="krypton-course-measure text-pretty leading-relaxed">
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
                {!activeSection.content && !activeSection.pids.length ? (
                  <section className="krypton-course-inset px-6 py-14 text-center">
                    <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-xl bg-background/70 text-muted-foreground">
                      <Paperclip className="size-5" strokeWidth={1.5} />
                    </span>
                    <p className="krypton-course-section mt-4">该小节暂无内容</p>
                    <p className="krypton-course-meta mt-1">讲义和题目都还没有挂上来。</p>
                  </section>
                ) : null}
              </>
            ) : (
              <>
                {activeChapter.content ? (
                  <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title" className="space-y-3">
                    <CourseSectionHeader id="chapter-content-title" title="章节讲义" />
                    <div className="krypton-course-measure text-pretty leading-relaxed">
                      <MarkdownView content={activeChapter.content} preferredLang={bs.locale} />
                    </div>
                  </section>
                ) : (
                  <div data-course-slot="chapterContent" />
                )}
                {chapterSections.length ? (
                  <section aria-labelledby="course-sections-title" className="space-y-3">
                    <CourseSectionHeader id="course-sections-title" title="本章小节" count={chapterSections.length} />
                    <ol className="krypton-course-panel overflow-hidden p-1.5">
                      {chapterSections.map((section, sectionIndex) => (
                        <li key={section._id}>
                          <button
                            type="button"
                            onClick={() => selectSection(activeChapter._id, section._id)}
                            className={cn(
                              'krypton-course-row group flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
                            >
                              {sectionIndex + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">{section.title}</span>
                            {section.totalCount ? (
                              <span className="krypton-course-meta shrink-0">
                                {section.doneCount}/{section.totalCount}
                              </span>
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
                <CourseSectionHeader id="course-files-title" title="课程课件" count={data.files.length} />
                <ul className="krypton-course-panel p-1.5">
                  {data.files.map((file) => (
                    <li key={file.name}>
                      <a
                        href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                        className={cn(
                          'krypton-course-row group flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        )}
                      >
                        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                          <FileText className="size-3.5" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                        <span className="krypton-course-meta shrink-0">{Math.max(1, Math.ceil(Number(file.size || 0) / 1024))} KB</span>
                        <Download
                          className="size-4 shrink-0 text-muted-foreground/60 transition-colors duration-150 group-hover:text-primary motion-reduce:transition-none"
                          strokeWidth={1.75}
                        />
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
                <Button asChild variant="outline" className="min-h-11 gap-1.5">
                  <a href={`/homework/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                    <ClipboardPlus className="size-4" strokeWidth={1.75} />
                    创建本章小测
                  </a>
                </Button>
              ) : null}
            </section>

            {!course.content &&
            !activeChapter.content &&
            !activeChapter.loosePids.length &&
            !activeChapter.tids.length &&
            !chapterSections.length &&
            !activeSection &&
            !collectRequests.some((request) => request.chapterId === activeChapter._id) &&
            data.canCreateCollect !== true ? (
              <section className="krypton-course-inset px-6 py-14 text-center">
                <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-xl bg-background/70 text-muted-foreground">
                  <Paperclip className="size-5" strokeWidth={1.5} />
                </span>
                <p className="krypton-course-section mt-4">本章暂无内容</p>
                <p className="krypton-course-meta mt-1">讲义、小测和比赛都还没有挂上来。</p>
              </section>
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
