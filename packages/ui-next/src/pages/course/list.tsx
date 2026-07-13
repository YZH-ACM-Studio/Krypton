import { BookOpen, ChevronRight, Plus, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';
import type { CourseRecord } from './types';

function CourseRow({ course, status, manageable }: { course: CourseRecord; status?: CourseRecord; manageable: boolean }) {
  const tid = String(course.docId || course._id);
  const chapterCount = Array.isArray(course.dag) ? course.dag.length : 0;
  const summary = formatPlainTextSummary(course.description || course.content || '').slice(0, 120);
  return (
    <article className="group grid gap-3 border-b border-border/70 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <a href={`/course/${tid}`} className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold transition-colors duration-200 group-hover:text-primary">{course.title}</h3>
              {course.term ? (
                <Badge variant="outline" className="rounded-md text-[10px]">
                  {course.term}
                </Badge>
              ) : null}
              {status?.enroll ? <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">已报名</span> : null}
            </div>
            {summary ? <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">{summary}</p> : null}
            <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span>{chapterCount} 章</span>
              {(course.courseGroupIds || []).length ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />
                  限指定班级
                </span>
              ) : (
                <span>全域可见</span>
              )}
            </p>
          </div>
        </div>
      </a>
      <div className="flex items-center justify-end gap-1">
        {manageable ? (
          <Button asChild variant="ghost" size="sm">
            <a href={`/course/${tid}/edit`}>编辑</a>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="icon" className="size-10">
          <a href={`/course/${tid}`} aria-label={`打开${course.title}`}>
            <ChevronRight className="size-4" />
          </a>
        </Button>
      </div>
    </article>
  );
}

function CourseSection({
  title,
  description,
  courses,
  statuses,
  managedIds,
}: {
  title: string;
  description: string;
  courses: CourseRecord[];
  statuses: Record<string, CourseRecord>;
  managedIds: Set<string>;
}) {
  if (!courses.length) return null;
  return (
    <section aria-labelledby={`course-section-${title}`}>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <h2 id={`course-section-${title}`} className="text-sm font-semibold">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{courses.length}</span>
      </div>
      <div className="border-y border-border/70">
        {courses.map((course) => {
          const tid = String(course.docId || course._id);
          return <CourseRow key={tid} course={course} status={statuses[tid]} manageable={managedIds.has(tid)} />;
        })}
      </div>
    </section>
  );
}

export function CoursePage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdocs: CourseRecord[];
    tsdict: Record<string, CourseRecord>;
    managedIds: string[];
    canCreate: boolean;
    q?: string;
    page?: number;
    tpcount?: number;
    tcount?: number;
  };
  const courses = data.tdocs || [];
  const managedIds = new Set((data.managedIds || []).map(String));
  const managed = courses.filter((course) => managedIds.has(String(course.docId || course._id)));
  const learnable = courses.filter((course) => !managedIds.has(String(course.docId || course._id)));
  const q = data.q || '';
  const paginationBase = q ? `/course?q=${encodeURIComponent(q)}` : '/course';

  return (
    <main className="w-full min-w-0 space-y-8 pb-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">学习空间</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance">课程</h1>
          <p className="mt-2 text-sm text-muted-foreground">共 {Number(data.tcount) || 0} 门课程</p>
        </div>
        {data.canCreate ? (
          <Button asChild className="min-h-11 gap-1.5">
            <a href="/course/create">
              <Plus className="size-4" />
              新建课程
            </a>
          </Button>
        ) : null}
      </header>

      <form method="get" action="/course" className="flex flex-col gap-2 sm:flex-row" role="search">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索课程</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} className="min-h-11 pl-10" placeholder="按课程名称搜索" />
        </label>
        <Button type="submit" variant="outline" className="min-h-11 px-5">
          搜索
        </Button>
      </form>

      {!courses.length ? (
        <section className="border-y border-border/70 py-16 text-center">
          <BookOpen className="mx-auto size-6 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-semibold">{q ? '没有匹配的课程' : '暂无可见课程'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{q ? '调整关键词后重新搜索。' : '课程开放后会显示在这里。'}</p>
        </section>
      ) : (
        <div className="space-y-10">
          <CourseSection
            title="我的管理"
            description="你创建或有权维护的课程"
            courses={managed}
            statuses={data.tsdict || {}}
            managedIds={managedIds}
          />
          <CourseSection
            title="我可学习"
            description="当前账号可进入的课程"
            courses={learnable}
            statuses={data.tsdict || {}}
            managedIds={managedIds}
          />
        </div>
      )}

      <Pagination current={Number(data.page) || 1} total={Number(data.tpcount) || 1} baseUrl={paginationBase} />
    </main>
  );
}
