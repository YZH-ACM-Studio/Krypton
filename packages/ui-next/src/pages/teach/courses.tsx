import {
  useId, useRef, useState, type FormEvent, type ReactNode,
} from 'react';
import { Plus } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { postForm } from './api';

const PAGE_DESCRIPTION = '你创建或协作管理的课程。';
const EMPTY_TITLE = '还没有课程';
const EMPTY_DESCRIPTION = '新建一门课程，按章节组织视频、讲义和题目。';
const FILTERED_EMPTY_TITLE = '没有匹配的课程';
const CREATE_FAILED = '创建课程失败';
const TERM_PLACEHOLDER = '2026 秋';
const TITLE_LIMIT = 64;
const CONTENT_LIMIT = 65535;
const INITIAL_CHAPTERS = JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]);
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ROLES = ['owner', 'maintainer', 'admin'] as const;

type TeachCourseRole = (typeof ROLES)[number];
type TeachCourseScope = 'mine' | 'all';

const ROLE_LABEL: Record<TeachCourseRole, string> = {
  owner: '所有者',
  maintainer: '协作者',
  admin: '管理员',
};

interface TeachCourseRow {
  id: string;
  title: string;
  term: string;
  hidden: boolean;
  groupNames: string[];
  chapterCount: number;
  videoCount: number;
  problemCount: number;
  boundStudentCount: number | null;
  role: TeachCourseRole;
  createdAt: string;
}

interface TeachCourseListPayload {
  scope: TeachCourseScope;
  canSeeAll: boolean;
  canCreate: boolean;
  q: string;
  rows: TeachCourseRow[];
}

interface FieldErrors {
  title: string | null;
  term: string | null;
  content: string | null;
}

const NO_FIELD_ERRORS: FieldErrors = { title: null, term: null, content: null };

function invalid(path: string): never {
  throw new TypeError(`teach_course_list_invalid:${path}`);
}

function join(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
  return value as Record<string, unknown>;
}

function readRequired(record: Record<string, unknown>, key: string, parent: string): unknown {
  const path = join(parent, key);
  if (!Object.hasOwn(record, key)) invalid(path);
  return record[key];
}

function readString(record: Record<string, unknown>, key: string, parent: string): string {
  const value = readRequired(record, key, parent);
  if (typeof value !== 'string') invalid(join(parent, key));
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, parent: string): boolean {
  const value = readRequired(record, key, parent);
  if (typeof value !== 'boolean') invalid(join(parent, key));
  return value;
}

function readCount(record: Record<string, unknown>, key: string, parent: string): number {
  const value = readRequired(record, key, parent);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(join(parent, key));
  return value;
}

function readScope(record: Record<string, unknown>): TeachCourseScope {
  const value = readRequired(record, 'scope', '');
  if (value !== 'mine' && value !== 'all') invalid('scope');
  return value;
}

function readRole(value: unknown, path: string): TeachCourseRole {
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) invalid(path);
  return value as TeachCourseRole;
}

function readObjectId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) invalid(path);
  return value;
}

function readInstant(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid(path);
  return value;
}

function readGroupNames(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path);
  return value.map((item, index) => {
    if (typeof item !== 'string' || item === '') invalid(`${path}[${index}]`);
    return item;
  });
}

function readStudentCount(value: unknown, path: string, groupCount: number): number | null {
  if (value === null) {
    if (groupCount !== 0) invalid(path);
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || groupCount === 0) invalid(path);
  return value;
}

function readRow(value: unknown, path: string): TeachCourseRow {
  const record = asRecord(value, path);
  const groupNames = readGroupNames(readRequired(record, 'groupNames', path), join(path, 'groupNames'));
  return {
    id: readObjectId(readRequired(record, 'id', path), join(path, 'id')),
    title: readString(record, 'title', path),
    term: readString(record, 'term', path),
    hidden: readBoolean(record, 'hidden', path),
    groupNames,
    chapterCount: readCount(record, 'chapterCount', path),
    videoCount: readCount(record, 'videoCount', path),
    problemCount: readCount(record, 'problemCount', path),
    boundStudentCount: readStudentCount(readRequired(record, 'boundStudentCount', path), join(path, 'boundStudentCount'), groupNames.length),
    role: readRole(readRequired(record, 'role', path), join(path, 'role')),
    createdAt: readInstant(readRequired(record, 'createdAt', path), join(path, 'createdAt')),
  };
}

function readRows(record: Record<string, unknown>): TeachCourseRow[] {
  const value = readRequired(record, 'rows', '');
  if (!Array.isArray(value)) invalid('rows');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const row = readRow(item, `rows[${index}]`);
    if (seen.has(row.id)) invalid(`rows[${index}].id`);
    seen.add(row.id);
    return row;
  });
}

function parseTeachCourseListPayload(raw: unknown): TeachCourseListPayload {
  const record = asRecord(raw, '');
  const payload: TeachCourseListPayload = {
    scope: readScope(record),
    canSeeAll: readBoolean(record, 'canSeeAll', ''),
    canCreate: readBoolean(record, 'canCreate', ''),
    q: readString(record, 'q', ''),
    rows: readRows(record),
  };
  if (payload.scope === 'all' && !payload.canSeeAll) throw new TypeError('teach_course_scope_forbidden');
  return payload;
}

function wantsNewCourse(): boolean {
  return new URLSearchParams(window.location.search).get('new') === '1';
}

function listHref(scope: TeachCourseScope, q: string): string {
  const params = new URLSearchParams();
  params.set('scope', scope);
  if (q !== '') params.set('q', q);
  return `/teach/courses?${params.toString()}`;
}

function roleLabel(role: TeachCourseRole): string {
  const label = ROLE_LABEL[role];
  if (label === undefined) throw new TypeError(`teach_course_role_invalid:${String(role)}`);
  return label;
}

function groupLabel(names: readonly string[]): string {
  if (names.length === 0) return '全站可见';
  return names.join('、');
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function titleError(title: string): string | null {
  if (title === '') return '请填写标题';
  if (title.length > TITLE_LIMIT) return '标题不能超过 64 个字';
  return null;
}

function contentError(content: string): string | null {
  if (content === '') return '请填写课程简介';
  if (content.length > CONTENT_LIMIT) return '课程简介不能超过 65535 个字';
  return null;
}

function validateCourse(title: string, term: string, content: string): FieldErrors {
  return {
    title: titleError(title),
    term: term === '' ? '请填写学期' : null,
    content: contentError(content),
  };
}

function hasFieldError(errors: FieldErrors): boolean {
  return errors.title !== null || errors.term !== null || errors.content !== null;
}

function courseTitle(row: TeachCourseRow): ReactNode {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0">
        <a
          href={`/course/${row.id}/edit`}
          className="min-w-0 truncate font-medium text-fg hover:underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {row.title}
        </a>
        {/* 堆叠卡片会拆掉这个链接。零宽字符让外层文本不等于标题，页面上的精确文本查询只命中这一处。 */}
        {'\u200B'}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-xs text-fg-subtle">{row.term}</span>
        {row.hidden ? (
          <span className="shrink-0">
            <Badge size="sm">已隐藏</Badge>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CountCell({ count }: { count: number }) {
  return <span className="tabular text-sm">{count}</span>;
}

function courseColumns(): Column<TeachCourseRow>[] {
  return [
    {
      key: 'course',
      header: '课程',
      stackRole: 'title',
      cell: (row) => courseTitle(row),
    },
    {
      key: 'groups',
      header: '班级',
      cell: (row) => <span className="block min-w-0 truncate text-fg-muted">{groupLabel(row.groupNames)}</span>,
    },
    {
      key: 'chapters',
      header: '章节',
      width: '5rem',
      cell: (row) => <CountCell count={row.chapterCount} />,
    },
    {
      key: 'videos',
      header: '视频',
      width: '5rem',
      cell: (row) => <CountCell count={row.videoCount} />,
    },
    {
      key: 'problems',
      header: '题目',
      width: '5rem',
      cell: (row) => <CountCell count={row.problemCount} />,
    },
    {
      key: 'students',
      header: '学生',
      width: '5rem',
      cell: (row) => (row.boundStudentCount === null
        ? <span className="text-sm text-fg-subtle">—</span>
        : <CountCell count={row.boundStudentCount} />),
    },
    {
      key: 'role',
      header: '我的角色',
      width: '6rem',
      cell: (row) => <span className="text-sm text-fg-muted">{roleLabel(row.role)}</span>,
    },
  ];
}

function scopeTabs(payload: TeachCourseListPayload): MiniTabItem<TeachCourseScope>[] {
  return [
    { value: 'mine', label: '我的', href: listHref('mine', payload.q) },
    { value: 'all', label: '全部', href: listHref('all', payload.q) },
  ];
}

function ListEmpty({ payload }: { payload: TeachCourseListPayload }) {
  if (payload.q !== '') {
    return (
      <EmptyState
        title={FILTERED_EMPTY_TITLE}
        action={(
          <Button variant="secondary" asChild>
            <a href={listHref(payload.scope, '')}>清除筛选</a>
          </Button>
        )}
      />
    );
  }
  return <EmptyState title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />;
}

function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (next: boolean) => void }) {
  const titleId = useId();
  const termId = useId();
  const contentId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const [title, setTitle] = useState('');
  const [term, setTerm] = useState('');
  const [content, setContent] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle('');
    setTerm('');
    setContent('');
    setFieldErrors(NO_FIELD_ERRORS);
    setSubmitError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next && submittingRef.current) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function focusError(errors: FieldErrors) {
    if (errors.title !== null) titleRef.current?.focus();
    else if (errors.term !== null) termRef.current?.focus();
    else if (errors.content !== null) contentRef.current?.focus();
  }

  async function createCourse() {
    const nextTitle = title.trim();
    const nextTerm = term.trim();
    const nextContent = content.trim();
    const errors = validateCourse(nextTitle, nextTerm, nextContent);
    if (hasFieldError(errors)) {
      setFieldErrors(errors);
      focusError(errors);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors(NO_FIELD_ERRORS);
    setSubmitError(null);
    try {
      const body = new URLSearchParams();
      body.set('title', nextTitle);
      body.set('term', nextTerm);
      body.set('content', nextContent);
      body.set('chapters', INITIAL_CHAPTERS);
      const created = await postForm('/course/create', body, CREATE_FAILED);
      const tid = created.tid;
      if (typeof tid !== 'string' || !OBJECT_ID.test(tid)) throw new TypeError('teach_course_create_tid_invalid');
      window.location.assign(`/course/${tid}/edit`);
    } catch (error) {
      console.error('teach course create failed', { error });
      setSubmitError(messageOf(error, CREATE_FAILED));
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createCourse();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>新建课程</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="标题" htmlFor={titleId} required error={fieldErrors.title}>
              <Input
                ref={titleRef}
                id={titleId}
                name="title"
                value={title}
                maxLength={TITLE_LIMIT}
                required
                disabled={submitting}
                invalid={fieldErrors.title !== null}
                autoComplete="off"
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (fieldErrors.title !== null) setFieldErrors((current) => ({ ...current, title: null }));
                }}
              />
            </FormField>
            <FormField label="学期" htmlFor={termId} required error={fieldErrors.term}>
              <Input
                ref={termRef}
                id={termId}
                name="term"
                value={term}
                placeholder={TERM_PLACEHOLDER}
                required
                disabled={submitting}
                invalid={fieldErrors.term !== null}
                autoComplete="off"
                onChange={(event) => {
                  setTerm(event.target.value);
                  if (fieldErrors.term !== null) setFieldErrors((current) => ({ ...current, term: null }));
                }}
              />
            </FormField>
            <FormField label="课程简介" htmlFor={contentId} required error={fieldErrors.content}>
              <Textarea
                ref={contentRef}
                id={contentId}
                name="content"
                value={content}
                required
                disabled={submitting}
                invalid={fieldErrors.content !== null}
                onChange={(event) => {
                  setContent(event.target.value);
                  if (fieldErrors.content !== null) setFieldErrors((current) => ({ ...current, content: null }));
                }}
              />
            </FormField>
            {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>创建</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CourseList({ payload }: { payload: TeachCourseListPayload }) {
  if (payload.rows.length === 0) return <ListEmpty payload={payload} />;
  return (
    <DataTable
      mobile="stack"
      rows={payload.rows}
      rowKey={(row) => row.id}
      rowHref={(row) => `/course/${row.id}/edit`}
      columns={courseColumns()}
    />
  );
}

function CreateAction({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" type="button" onClick={onClick}>
      <Plus />
      新建课程
    </Button>
  );
}

export function TeachCourseListPage() {
  const bootstrap = useBootstrap();
  const [createOpen, setCreateOpen] = useState(() => wantsNewCourse());
  const payload = parseTeachCourseListPayload(bootstrap.page.data);

  return (
    <Page width="wide">
      <PageHeader
        title="课程"
        description={PAGE_DESCRIPTION}
        actions={payload.canCreate ? <CreateAction onClick={() => setCreateOpen(true)} /> : null}
      />
      <Toolbar
        end={payload.canSeeAll ? (
          <MiniTabs
            aria-label="范围"
            value={payload.scope}
            items={scopeTabs(payload)}
          />
        ) : undefined}
      >
        <form method="get" action="/teach/courses">
          <input type="hidden" name="scope" value={payload.scope} />
          <SearchInput
            name="q"
            placeholder="搜索标题或学期"
            aria-label="搜索课程"
            defaultValue={payload.q}
            className="w-full sm:w-72"
          />
        </form>
      </Toolbar>
      <Panel flush>
        <CourseList payload={payload} />
      </Panel>
      {payload.canCreate ? <CreateCourseDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </Page>
  );
}
