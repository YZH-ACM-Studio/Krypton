import { ArrowLeft, BookOpen, CheckCircle2, ClipboardPlus, Download, FileText, ListTree, Network, Pencil, Trophy } from 'lucide-react';
import { useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import { CourseMindmapView } from './mindmap';
import type { CourseChapter, CourseFile, CourseMindmapData, CourseRecord } from './types';

function ProblemList({
  chapter,
  problems,
  courseId,
  integrityControlled,
}: {
  chapter: CourseChapter;
  problems: Record<string, CourseRecord>;
  courseId: string;
  integrityControlled: boolean;
}) {
  if (!chapter.pids.length) return null;
  return (
    <section aria-labelledby="course-problems-title" className="space-y-2">
      <h3 id="course-problems-title" className="text-xs font-semibold text-muted-foreground">
        本章题目
      </h3>
      <div className="divide-y divide-border/70 border-y border-border/70">
        {chapter.pids.map((pid, index) => {
          const problem = problems[String(pid)] || {};
          return (
            <a
              key={pid}
              href={
                integrityControlled
                  ? practiceProblemEntryUrl(`/p/${problem.pid || pid}`, {
                      containerKind: 'course',
                      containerId: courseId,
                      scopeKind: 'chapter',
                      scopeId: chapter._id,
                    })
                  : `/p/${problem.pid || pid}`
              }
              className={cn(
                'group flex min-h-11 items-center gap-3 px-1 py-2.5 transition-colors duration-200 hover:text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
              )}
            >
              <span className="w-7 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{problem.title || `P${pid}`}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{problem.pid || `P${pid}`}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function ContestList({ chapter, contests }: { chapter: CourseChapter; contests: Record<string, CourseRecord> }) {
  if (!chapter.tids.length) return null;
  return (
    <section aria-labelledby="course-contests-title" className="space-y-2">
      <h3 id="course-contests-title" className="text-xs font-semibold text-muted-foreground">
        比赛与作业
      </h3>
      <div className="divide-y divide-border/70 border-y border-border/70">
        {chapter.tids.map((contestId) => {
          const contest = contests[contestId] || {};
          const href = contest.rule === 'homework' ? `/homework/${contestId}` : `/contest/${contestId}`;
          return (
            <a
              key={contestId}
              href={href}
              className={cn(
                'flex min-h-11 items-center gap-3 px-1 py-2.5 transition-colors duration-200 hover:text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
              )}
            >
              <Trophy className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{contest.title || '比赛'}</span>
              <span className="text-[11px] text-muted-foreground">{contest.rule || 'contest'}</span>
            </a>
          );
        })}
      </div>
    </section>
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
    canCreateQuiz: boolean;
    canEnroll: boolean;
    canDownloadFiles: boolean;
    tsdoc?: CourseRecord;
    files: CourseFile[];
    view: 'overview' | 'mindmap';
    courseMindmap: CourseMindmapData | null;
    integrityControlled?: boolean;
  };
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id);
  const chapters = data.chapters || [];
  const { activeId, selectChapter } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];
  const activeView = data.view === 'mindmap' ? 'mindmap' : 'overview';
  const [outlineOpen, setOutlineOpen] = useState(false);

  const selectFromMobile = (chapterId: number) => {
    selectChapter(chapterId);
    setOutlineOpen(false);
  };

  return (
    <main className="w-full min-w-0 space-y-6 pb-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-5">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href="/course" aria-label="返回课程列表">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {data.udoc?.uname || '课程'}
            {course.term ? ` · ${course.term}` : ''}
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{course.title}</h1>
        </div>
        {activeView === 'overview' && chapters.length ? (
          <Button type="button" variant="outline" className="min-h-11 gap-1.5 lg:hidden" onClick={() => setOutlineOpen(true)}>
            <ListTree className="size-4" />
            章节
          </Button>
        ) : null}
        {data.canManage ? (
          <Button asChild variant="outline" className="min-h-11 gap-1.5">
            <a
              href={
                activeView === 'mindmap' ? `/course/${tid}/edit#course-mindmap-settings` : `/course/${tid}/edit?chapter=${activeChapter?._id || ''}`
              }
            >
              <Pencil className="size-4" />
              编辑
            </a>
          </Button>
        ) : null}
        {data.canEnroll ? (
          <form method="post" action={`/course/${tid}`}>
            <input type="hidden" name="operation" value="enroll" />
            <Button type="submit" className="min-h-11">
              报名课程
            </Button>
          </form>
        ) : data.tsdoc?.enroll ? (
          <span className={cn('inline-flex min-h-11 items-center gap-1.5 text-xs font-medium', 'text-emerald-700 dark:text-emerald-400')}>
            <CheckCircle2 className="size-4" />
            已报名
          </span>
        ) : null}
      </header>

      <MiniTabs
        value={activeView}
        size="md"
        aria-label="课程视图"
        items={[
          { value: 'overview', label: '课程内容', icon: BookOpen, href: `/course/${tid}` },
          { value: 'mindmap', label: '知识导图', icon: Network, href: `/course/${tid}?view=mindmap` },
        ]}
      />

      {activeView === 'mindmap' ? (
        <CourseMindmapView
          tid={tid}
          data={data.courseMindmap || null}
          canManage={data.canManage}
          integrityControlled={data.integrityControlled === true}
        />
      ) : !chapters.length ? (
        <section className="border-y border-border/70 py-16 text-center">
          <BookOpen className="mx-auto size-6 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">课程还没有章节</h2>
          <p className="mt-1 text-xs text-muted-foreground">课程负责人添加章节后会显示在这里。</p>
        </section>
      ) : (
        <div className="grid min-w-0 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-muted-foreground">课程目录</h2>
              <span className="text-[11px] tabular-nums text-muted-foreground">{chapters.length} 章</span>
            </div>
            <ChapterOutline chapters={chapters} activeId={activeChapter._id} onSelect={selectChapter} />
          </aside>

          <article className="min-w-0 space-y-8">
            <header className="border-b border-border/70 pb-5">
              <p className="text-xs tabular-nums text-muted-foreground">
                第 {chapters.findIndex((chapter) => chapter._id === activeChapter._id) + 1} 章
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{activeChapter.title}</h2>
              <div className="mt-4 flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                <span>
                  {activeChapter.doneCount}/{activeChapter.totalCount} 题完成
                </span>
                <div className="h-1.5 max-w-48 flex-1 overflow-hidden rounded-full bg-muted" aria-label={`完成进度 ${activeChapter.progress}%`}>
                  <div
                    className="h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${activeChapter.progress}%` }}
                  />
                </div>
                <span>{activeChapter.progress}%</span>
              </div>
            </header>

            {course.content ? (
              <section aria-labelledby="course-overview-title" className="max-w-3xl">
                <h3 id="course-overview-title" className="mb-3 text-xs font-semibold text-muted-foreground">
                  课程说明
                </h3>
                <MarkdownView content={course.content} preferredLang={bs.locale} />
              </section>
            ) : null}

            {activeChapter.content ? (
              <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title" className="max-w-3xl">
                <h3 id="chapter-content-title" className="mb-3 text-xs font-semibold text-muted-foreground">
                  章节讲义
                </h3>
                <MarkdownView content={activeChapter.content} preferredLang={bs.locale} />
              </section>
            ) : (
              <div data-course-slot="chapterContent" />
            )}
            <ProblemList chapter={activeChapter} problems={data.pdict || {}} courseId={tid} integrityControlled={data.integrityControlled === true} />
            <ContestList chapter={activeChapter} contests={data.cdict || {}} />
            {data.canDownloadFiles && data.files?.length ? (
              <section data-course-slot="files" aria-labelledby="course-files-title" className="space-y-2">
                <h3 id="course-files-title" className="text-xs font-semibold text-muted-foreground">
                  课程课件
                </h3>
                <div className="divide-y divide-border/70 border-y border-border/70">
                  {data.files.map((file) => (
                    <a
                      key={file.name}
                      href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                      className={cn(
                        'flex min-h-11 items-center gap-3 px-1 py-2.5 text-sm transition-colors duration-200',
                        'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        'motion-reduce:transition-none',
                      )}
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {Math.max(1, Math.ceil(Number(file.size || 0) / 1024))} KB
                      </span>
                      <Download className="size-4" />
                    </a>
                  ))}
                </div>
              </section>
            ) : (
              <div data-course-slot="files" />
            )}
            <section data-course-slot="quiz" className="border-y border-border/70 py-3">
              {data.canCreateQuiz ? (
                <Button asChild variant="outline" className="min-h-11 gap-1.5">
                  <a href={`/homework/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                    <ClipboardPlus className="size-4" />
                    建小测
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">具备作业创建权限的课程教师可建立本章小测。</p>
              )}
            </section>

            {!course.content && !activeChapter.content && !activeChapter.pids.length && !activeChapter.tids.length ? (
              <section className="border-y border-border/70 py-12 text-center text-sm text-muted-foreground">本章暂无内容。</section>
            ) : null}
          </article>
        </div>
      )}

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-[22rem] max-w-[calc(100vw-1rem)]">
          <SheetHeader>
            <SheetTitle>课程目录</SheetTitle>
          </SheetHeader>
          <SheetBody className="p-4">
            <ChapterOutline chapters={chapters} activeId={activeChapter?._id || null} onSelect={selectFromMobile} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}
