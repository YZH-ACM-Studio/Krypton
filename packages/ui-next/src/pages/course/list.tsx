import { useState } from 'react';
import { BookOpen, EyeOff, Layers, Pencil, Plus, UserPlus, Users } from 'lucide-react';
import type { DomainUserOption } from '@/components/domain-user-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
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
        <Badge tone="neutral" size="sm">
          <EyeOff className="size-3" strokeWidth={1.75} />
          已隐藏
        </Badge>
        {restricted ? (
          <Badge variant="outline" size="sm">
            <Users className="size-3" strokeWidth={1.75} />
            指定班级
          </Badge>
        ) : null}
      </span>
    );
  }
  return restricted ? (
    <Badge tone="neutral" size="sm">
      <Users className="size-3" strokeWidth={1.75} />
      指定班级
    </Badge>
  ) : (
    <Badge variant="outline" size="sm">
      全站可见
    </Badge>
  );
}

function CourseCard({ course }: { course: CourseRecord }) {
  const tid = courseId(course);
  const summary = summaryOf(course);
  return (
    <a
      href={`/course/${tid}`}
      className="flex h-full w-full min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-(--dur-2) ease-(--ease-out) hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start gap-3">
        <CourseMark seed={tid} title={course.title || ''} className="size-10 text-md" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">{course.title}</h3>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{course.term || '未标注学期'}</p>
        </div>
      </div>
      {summary ? <p className="line-clamp-2 flex-1 text-sm text-fg-muted">{summary}</p> : <span className="flex-1" />}
      <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-3">
        <span className="inline-flex items-center gap-1 text-xs text-fg-subtle tabular">
          <Layers className="size-3" strokeWidth={1.75} />
          {chapterCount(course)} 章
        </span>
        <ScopeBadge course={course} />
      </div>
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
    <div className="flex items-center gap-3 px-4 py-2.5 transition-[background-color] duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover">
      <a
        href={`/course/${tid}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <CourseMark seed={tid} title={course.title || ''} className="size-8 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{course.title}</span>
            {enrolled && !courseAssignsUserGroups(course) ? (
              <Badge tone="neutral" size="sm">
                已报名
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            {course.term ? <span>{course.term}</span> : null}
            <span className="tabular">{chapterCount(course)} 章</span>
            <ScopeBadge course={course} />
          </span>
        </span>
      </a>
      {canAssign ? (
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => onAssign(course)}>
          <UserPlus strokeWidth={1.75} />
          分配
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="sm" className="shrink-0">
        <a href={`/course/${tid}/edit`}>
          <Pencil strokeWidth={1.75} />
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
    <Page width="wide" className="w-full min-w-0">
      {/* 课程列表没有「管理自己的用户组」数据，入口对能打开本页的人可见；没有权限时由 /user-groups 拒绝。 */}
      <div>
        <Button asChild variant="secondary" className="w-full sm:w-auto">
          <a href="/user-groups">我的用户组</a>
        </Button>
      </div>
      <PageHeader
        title="课程"
        description={(
          <>
            共 <span className="tabular">{Number(data.tcount) || 0}</span> 门{managed.length ? <> · 管理 <span className="tabular">{managed.length}</span></> : null}{enrolled.length ? <> · 已报名 <span className="tabular">{enrolled.length}</span></> : null}
          </>
        )}
        actions={data.canCreate ? (
          <Button asChild variant="primary" className="w-full sm:w-auto">
            <a href="/course/create">
              <Plus />
              新建课程
            </a>
          </Button>
        ) : null}
      />
      <Toolbar>
        <form method="get" action="/course" role="search" className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="min-w-0 sm:w-72">
            <span className="sr-only">搜索课程</span>
            <SearchInput name="q" defaultValue={q} placeholder="搜索名称" className="w-full" />
          </label>
          <Button type="submit" variant="secondary">搜索</Button>
        </form>
      </Toolbar>

      {!courses.length ? (
        <Panel>
          <EmptyState
            icon={<BookOpen strokeWidth={1.5} />}
            title={q ? `没有匹配「${q}」的课程` : '还没有课程'}
            action={q ? (
              <Button asChild variant="secondary">
                <a href="/course">清除搜索</a>
              </Button>
            ) : null}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {enrolled.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-fg-muted">已报名</h2>
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {enrolled.map((course) => (
                  <CourseCard key={courseId(course)} course={course} />
                ))}
              </div>
            </section>
          ) : null}

          {managed.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-fg-muted">我管理的</h2>
              <Panel flush>
                <div className="divide-y divide-line-subtle">
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
              </Panel>
            </section>
          ) : null}

          {available.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-fg-muted">{enrolled.length || managed.length ? '其它课程' : '可学习'}</h2>
              <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((course) => (
                  <CourseCard key={courseId(course)} course={course} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <Pagination current={Number(data.page) || 1} total={Number(data.tpcount) || 1} baseUrl={paginationBase} />
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
    </Page>
  );
}
