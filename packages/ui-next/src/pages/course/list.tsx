import { useState } from 'react';
import { ArrowRight, BookOpen, ChevronRight, Layers, Pencil, Plus, Search, UserPlus, Users } from 'lucide-react';
import type { DomainUserOption } from '@/components/domain-user-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';
import { cn } from '@/lib/cn';
import { CourseAssignDialog } from './assign';
import type { CourseRecord } from './types';
import { CourseMark, CourseSectionHeader, riseStyle, useSpotlight } from './ui';

function courseId(course: CourseRecord): string {
  return String(course.docId || course._id);
}

function chapterCount(course: CourseRecord): number {
  return Array.isArray(course.dag) ? course.dag.length : 0;
}

function summaryOf(course: CourseRecord): string {
  return formatPlainTextSummary(course.description || course.content || '').slice(0, 160);
}

function ScopeChip({ course, className }: { course: CourseRecord; className?: string }) {
  const restricted = (course.courseGroupIds || []).length > 0;
  return (
    <span className={cn('krypton-course-meta inline-flex items-center gap-1', className)}>
      {restricted ? (
        <>
          <Users className="size-3" strokeWidth={1.75} />
          限指定班级
        </>
      ) : (
        '全域可见'
      )}
    </span>
  );
}

/**
 * The single featured entry. The old list was an undifferentiated run of
 * identical rows, so the page had nowhere for the eye to land — one
 * committed course gets real scale, everything else stays quiet.
 */
function FeaturedCourse({ course }: { course: CourseRecord }) {
  const tid = courseId(course);
  const summary = summaryOf(course);
  const { spotlightProps } = useSpotlight();
  return (
    <a
      href={`/course/${tid}`}
      {...spotlightProps}
      className={cn(
        'krypton-course-hero krypton-course-grain krypton-course-spotlight group block px-5 py-6 sm:px-7 sm:py-7',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      <div className="relative z-10 flex flex-wrap items-start gap-x-6 gap-y-5">
        <CourseMark seed={tid} title={course.title || ''} className="size-14 rounded-2xl text-2xl" />
        <div className="min-w-0 flex-1 basis-72">
          <p className="krypton-course-eyebrow">继续学习</p>
          <h3 className="krypton-course-display mt-1.5">{course.title}</h3>
          <p className="krypton-course-meta mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {course.term ? <span>{course.term}</span> : null}
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3" strokeWidth={1.75} />
              {chapterCount(course)} 章
            </span>
            <ScopeChip course={course} />
          </p>
          {summary ? <p className="krypton-course-measure mt-3 line-clamp-2 text-sm leading-6 text-pretty text-muted-foreground">{summary}</p> : null}
        </div>
        <span
          className={cn(
            'inline-flex min-h-11 shrink-0 self-center items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium',
            'text-primary-foreground shadow transition-transform duration-200 group-hover:scale-[1.02]',
            'group-active:scale-[0.98] motion-reduce:transition-none',
          )}
        >
          进入课程
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
            strokeWidth={1.75}
          />
        </span>
      </div>
    </a>
  );
}

function CourseCard({ course, index }: { course: CourseRecord; index: number }) {
  const tid = courseId(course);
  const summary = summaryOf(course);
  return (
    <a
      href={`/course/${tid}`}
      style={riseStyle(index)}
      className={cn(
        'krypton-course-panel krypton-course-lift krypton-course-rise group flex min-h-full flex-col gap-3 p-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      <div className="flex items-start gap-3">
        <CourseMark seed={tid} title={course.title || ''} className="size-10 text-base" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-5 transition-colors duration-150 group-hover:text-primary motion-reduce:transition-none">
            {course.title}
          </h3>
          <p className="krypton-course-meta mt-0.5 truncate">{course.term || '未标注学期'}</p>
        </div>
      </div>
      {summary ? <p className="line-clamp-2 flex-1 text-xs leading-5 text-pretty text-muted-foreground">{summary}</p> : <span className="flex-1" />}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <span className="krypton-course-meta inline-flex items-center gap-1">
          <Layers className="size-3" strokeWidth={1.75} />
          {chapterCount(course)} 章
        </span>
        <ScopeChip course={course} />
      </div>
    </a>
  );
}

/**
 * Managed courses read as a workbench, not a catalogue: a left accent rail
 * marks ownership and the edit affordance sits on the row instead of being
 * an equal-weight sibling of the title link.
 */
function ManagedCourseRow({
  course,
  enrolled,
  index,
  canAssign,
  onAssign,
}: {
  course: CourseRecord;
  enrolled: boolean;
  index: number;
  canAssign: boolean;
  onAssign: (course: CourseRecord) => void;
}) {
  const tid = courseId(course);
  return (
    <div
      style={riseStyle(index, 30, 10)}
      className={cn(
        'krypton-course-rise group relative flex items-center gap-3 overflow-hidden rounded-[0.625rem] py-2 pl-4 pr-2',
        'transition-colors duration-150 hover:bg-muted/55 motion-reduce:transition-none',
      )}
    >
      <span aria-hidden="true" className="absolute left-0 top-1/2 h-[54%] w-[3px] -translate-y-1/2 rounded-r-full bg-primary/45" />
      <a
        href={`/course/${tid}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <CourseMark seed={tid} title={course.title || ''} className="size-9 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold transition-colors duration-150 group-hover:text-primary motion-reduce:transition-none">
              {course.title}
            </span>
            {enrolled ? <span className="krypton-course-meta shrink-0 text-emerald-700 dark:text-emerald-400">已报名</span> : null}
          </span>
          <span className="krypton-course-meta mt-0.5 flex flex-wrap items-center gap-x-3">
            {course.term ? <span>{course.term}</span> : null}
            <span>{chapterCount(course)} 章</span>
            <ScopeChip course={course} />
          </span>
        </span>
      </a>
      {canAssign ? (
        <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => onAssign(course)}>
          <UserPlus className="size-3.5" strokeWidth={1.75} />
          分配
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5">
        <a href={`/course/${tid}/edit`}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
          编辑
        </a>
      </Button>
    </div>
  );
}

export function CoursePage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdocs: CourseRecord[];
    tsdict: Record<string, CourseRecord>;
    managedIds: string[];
    canCreate: boolean;
    canAssign?: boolean;
    assignUsers?: Record<string, DomainUserOption>;
    q?: string;
    page?: number;
    tpcount?: number;
    tcount?: number;
  };
  const courses = data.tdocs || [];
  const statuses = data.tsdict || {};
  const managedIds = new Set((data.managedIds || []).map(String));
  const q = data.q || '';
  const paginationBase = q ? `/course?q=${encodeURIComponent(q)}` : '/course';
  const canAssign = data.canAssign === true;
  const [assigning, setAssigning] = useState<CourseRecord | null>(null);

  // Bucketed by the viewer's relationship to the course. Managed wins over
  // enrolled so a teacher's own courses never scatter across two sections.
  const managed = courses.filter((course) => managedIds.has(courseId(course)));
  const enrolled = courses.filter((course) => !managedIds.has(courseId(course)) && statuses[courseId(course)]?.enroll);
  const available = courses.filter((course) => !managedIds.has(courseId(course)) && !statuses[courseId(course)]?.enroll);
  const [featured, ...otherEnrolled] = enrolled;

  return (
    <main className="w-full min-w-0 pb-10">
      <header className="mb-8 flex w-full flex-col gap-5 border-b border-border/60 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="krypton-course-eyebrow">学习空间</p>
          <h1 className="krypton-course-display mt-1.5">课程</h1>
          <p className="krypton-course-meta mt-2">
            共 {Number(data.tcount) || 0} 门课程
            {managed.length ? ` · 你管理 ${managed.length} 门` : ''}
            {enrolled.length ? ` · 已报名 ${enrolled.length} 门` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form method="get" action="/course" role="search" className="flex min-w-0 gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64">
              <span className="sr-only">搜索课程</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <Input name="q" defaultValue={q} className="min-h-11 pl-10 text-base sm:text-sm" placeholder="搜索课程名称" />
            </label>
            <Button type="submit" variant="outline" className="min-h-11 shrink-0 px-4 active:scale-[0.97]">
              搜索
            </Button>
          </form>
          {data.canCreate ? (
            <Button asChild className="min-h-11 shrink-0 gap-1.5 active:scale-[0.97]">
              <a href="/course/create">
                <Plus className="size-4" strokeWidth={2} />
                新建课程
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      {!courses.length ? (
        <section className="krypton-course-hero krypton-course-grain w-full px-6 py-20 text-center">
          <span aria-hidden="true" className="relative z-10 mx-auto grid size-14 place-items-center rounded-2xl bg-background/80 text-muted-foreground shadow-sm">
            <BookOpen className="size-6" strokeWidth={1.5} />
          </span>
          <h2 className="krypton-course-section relative z-10 mt-5">{q ? `没有匹配「${q}」的课程` : '暂无可见课程'}</h2>
          <p className="krypton-course-meta relative z-10 mx-auto mt-1.5 max-w-sm text-pretty">
            {q ? '换一个课程名称再试，或清除搜索查看全部课程。' : '课程开放后会显示在这里。'}
          </p>
          {q ? (
            <Button asChild variant="outline" className="relative z-10 mt-6 min-h-11">
              <a href="/course">清除搜索</a>
            </Button>
          ) : data.canCreate ? (
            <Button asChild className="relative z-10 mt-6 min-h-11 gap-1.5">
              <a href="/course/create">
                <Plus className="size-4" strokeWidth={2} />
                新建课程
              </a>
            </Button>
          ) : null}
        </section>
      ) : (
        <div className="w-full space-y-12">
          {featured ? (
            <section aria-labelledby="course-section-enrolled" className="space-y-4">
              <h2 id="course-section-enrolled" className="sr-only">
                已报名课程
              </h2>
              <FeaturedCourse course={featured} />
              {otherEnrolled.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {otherEnrolled.map((course, index) => (
                    <CourseCard key={courseId(course)} course={course} index={index} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {managed.length ? (
            <section aria-labelledby="course-section-managed" className="space-y-3">
              <CourseSectionHeader
                id="course-section-managed"
                level={2}
                title="我的管理"
                description="你创建或有权维护的课程"
                count={managed.length}
              />
              <div className="krypton-course-panel space-y-0.5 p-2">
                {managed.map((course, index) => (
                  <ManagedCourseRow
                    key={courseId(course)}
                    course={course}
                    enrolled={Boolean(statuses[courseId(course)]?.enroll)}
                    index={index}
                    canAssign={canAssign}
                    onAssign={setAssigning}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {available.length ? (
            <section aria-labelledby="course-section-available" className="space-y-3">
              <CourseSectionHeader
                id="course-section-available"
                level={2}
                title={featured ? '其它可选课程' : '我可学习'}
                description="当前账号可进入的课程"
                count={available.length}
                action={
                  <span className="krypton-course-meta hidden items-center gap-1 sm:inline-flex">
                    点击卡片查看章节
                    <ChevronRight className="size-3" strokeWidth={1.75} />
                  </span>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {available.map((course, index) => (
                  <CourseCard key={courseId(course)} course={course} index={index} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <div className="mt-10 w-full">
        <Pagination current={Number(data.page) || 1} total={Number(data.tpcount) || 1} baseUrl={paginationBase} />
      </div>
      {assigning ? (
        <CourseAssignDialog
          open
          onOpenChange={(open) => {
            if (!open) setAssigning(null);
          }}
          domainId={bs.domain.id}
          course={assigning}
          users={data.assignUsers || {}}
        />
      ) : null}
    </main>
  );
}
