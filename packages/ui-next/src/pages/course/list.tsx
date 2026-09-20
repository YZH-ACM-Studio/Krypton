import { useState } from 'react';
import { BookOpen, EyeOff, Layers, Pencil, Plus, Search, UserPlus, Users } from 'lucide-react';
import type { DomainUserOption } from '@/components/domain-user-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';
import { CourseAssignDialog } from './assign';
import { courseAssignsUserGroups, type CourseRecord } from './types';
import { CourseMark } from './ui';

function courseId(course: CourseRecord): string {
  return String(course.docId || course._id);
}

function chapterCount(course: CourseRecord): number {
  return Array.isArray(course.dag) ? course.dag.length : 0;
}

function summaryOf(course: CourseRecord): string {
  return formatPlainTextSummary(course.description || course.content || '').slice(0, 120);
}

function ScopeBadge({ course }: { course: CourseRecord }) {
  const restricted = (course.courseGroupIds || []).length > 0;
  if (course.courseHidden) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge variant="secondary" className="gap-1 font-normal">
          <EyeOff className="size-3" strokeWidth={1.75} />
          已隐藏
        </Badge>
        {restricted ? (
          <Badge variant="outline" className="gap-1 font-normal">
            <Users className="size-3" strokeWidth={1.75} />
            指定班级
          </Badge>
        ) : null}
      </span>
    );
  }
  return restricted ? (
    <Badge variant="secondary" className="gap-1 font-normal">
      <Users className="size-3" strokeWidth={1.75} />
      指定班级
    </Badge>
  ) : (
    <Badge variant="outline" className="font-normal">
      全站可见
    </Badge>
  );
}

function CourseCard({ course }: { course: CourseRecord }) {
  const tid = courseId(course);
  const summary = summaryOf(course);
  return (
    <a href={`/course/${tid}`} className="block h-full w-full min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full w-full min-w-0 transition-colors hover:bg-muted/40">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <CourseMark seed={tid} title={course.title || ''} className="size-10 text-base" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold leading-5">{course.title}</h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{course.term || '未标注学期'}</p>
            </div>
          </div>
          {summary ? <p className="line-clamp-2 flex-1 text-sm leading-5 text-muted-foreground">{summary}</p> : <span className="flex-1" />}
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Layers className="size-3" strokeWidth={1.75} />
              {chapterCount(course)} 章
            </span>
            <ScopeBadge course={course} />
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

function ManagedCourseRow({
  course,
  enrolled,
  canAssign,
  onAssign,
}: {
  course: CourseRecord;
  enrolled: boolean;
  canAssign: boolean;
  onAssign: (course: CourseRecord) => void;
}) {
  const tid = courseId(course);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
      <a
        href={`/course/${tid}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CourseMark seed={tid} title={course.title || ''} className="size-9 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{course.title}</span>
            {enrolled && !courseAssignsUserGroups(course) ? (
              <Badge variant="secondary" className="shrink-0 font-normal">
                已报名
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {course.term ? <span>{course.term}</span> : null}
            <span>{chapterCount(course)} 章</span>
            <ScopeBadge course={course} />
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

  const managed = courses.filter((course) => managedIds.has(courseId(course)));
  const enrolled = courses.filter(
    (course) =>
      !managedIds.has(courseId(course)) && !courseAssignsUserGroups(course) && statuses[courseId(course)]?.enroll,
  );
  const available = courses.filter(
    (course) =>
      !managedIds.has(courseId(course)) && (courseAssignsUserGroups(course) || !statuses[courseId(course)]?.enroll),
  );

  return (
    <main className="w-full min-w-0 pb-10">
      <header className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">课程</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {Number(data.tcount) || 0} 门
            {managed.length ? ` · 管理 ${managed.length}` : ''}
            {enrolled.length ? ` · 已报名 ${enrolled.length}` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form method="get" action="/course" role="search" className="flex min-w-0 gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64">
              <span className="sr-only">搜索课程</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <Input name="q" defaultValue={q} className="min-h-10 pl-9" placeholder="搜索名称" />
            </label>
            <Button type="submit" variant="outline" className="min-h-10">
              搜索
            </Button>
          </form>
          {data.canCreate ? (
            <Button asChild className="min-h-10 gap-1.5">
              <a href="/course/create">
                <Plus className="size-4" strokeWidth={2} />
                新建课程
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      {!courses.length ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BookOpen className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="mt-4 text-sm font-medium">{q ? `没有匹配「${q}」的课程` : '还没有课程'}</p>
            {q ? (
              <Button asChild variant="outline" className="mt-4">
                <a href="/course">清除搜索</a>
              </Button>
            ) : data.canCreate ? (
              <Button asChild className="mt-4 gap-1.5">
                <a href="/course/create">
                  <Plus className="size-4" strokeWidth={2} />
                  新建课程
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {enrolled.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">已报名</h2>
              <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {enrolled.map((course) => (
                  <CourseCard key={courseId(course)} course={course} />
                ))}
              </div>
            </section>
          ) : null}

          {managed.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">我管理的</h2>
              <Card className="overflow-hidden py-0">
                <div className="divide-y">
                  {managed.map((course) => (
                    <ManagedCourseRow
                      key={courseId(course)}
                      course={course}
                      enrolled={Boolean(statuses[courseId(course)]?.enroll)}
                      canAssign={canAssign}
                      onAssign={setAssigning}
                    />
                  ))}
                </div>
              </Card>
            </section>
          ) : null}

          {available.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">{enrolled.length || managed.length ? '其它课程' : '可学习'}</h2>
              <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {available.map((course) => (
                  <CourseCard key={courseId(course)} course={course} />
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
