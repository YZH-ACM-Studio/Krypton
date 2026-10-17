import { Eye, ListTree } from 'lucide-react';
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/ui/page';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DomainUserOption } from '@/components/domain-user-search';
import { useBootstrap } from '@/lib/bootstrap';
import { postForm } from '@/pages/teach/api';
import { SaveBar } from '@/pages/teach/settings-kit';
import { useChapterQuery } from './chapter-query';
import {
  readCourseExam,
  type ChapterDraft,
  type CourseExamBinding,
  type CourseFile,
  type CourseRecord,
  type GroupRefView,
} from './types';
import { AddContentMenu } from './workbench/add-content';
import { ChapterPanel } from './workbench/chapter-panel';
import { CourseExamTab } from './workbench/exam-tab';
import { CourseMindmapTab } from './workbench/mindmap-tab';
import {
  chapterRemovalBlocker,
  chaptersJson,
  courseSummary,
  initialChapterDrafts,
  parseCourseTab,
  type CourseEditorPageData,
  type CourseTab,
} from './workbench/model';
import { OutlinePanel } from './workbench/outline-panel';
import { CourseSettingsTab } from './workbench/settings-tab';
import { CourseStudentsTab } from './workbench/students-tab';

const CREATE_TARGET = '/teach/courses?new=1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(path: string): never {
  throw new TypeError(`Invalid course editor payload: ${path}`);
}

function readPageName(data: unknown): string {
  if (!isRecord(data) || typeof data.page_name !== 'string' || data.page_name === '') invalid('page_name');
  return data.page_name;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  return readBoolean(value, path);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path);
  return value;
}

function readOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return readString(value, path);
}

function readId(value: unknown, path: string): string | number {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  invalid(path);
}

function readGroup(value: unknown, path: string): GroupRefView {
  if (!isRecord(value)) invalid(path);
  const state = value.state;
  const kind = value.kind;
  if (state !== 'active' && state !== 'archived' && state !== 'deleted') invalid(path);
  if (kind !== 'own' && kind !== 'school' && kind !== 'other-teacher' && kind !== 'unknown') invalid(path);
  if (value.name !== null && typeof value.name !== 'string') invalid(path);
  if (value.schoolName !== null && typeof value.schoolName !== 'string') invalid(path);
  return {
    _id: String(readId(value._id, path)),
    name: value.name,
    schoolName: value.schoolName,
    state,
    kind,
    attachable: readBoolean(value.attachable, path),
  };
}

function readGroups(value: unknown, path: string): GroupRefView[] {
  if (!Array.isArray(value)) invalid(path);
  return value.map((item, index) => readGroup(item, `${path}[${index}]`));
}

function readFiles(value: unknown): CourseFile[] {
  if (!Array.isArray(value)) invalid('files');
  return value.map((file, index) => {
    const path = `files[${index}]`;
    if (!isRecord(file)) invalid(path);
    const name = readString(file.name, path);
    if (name === '') invalid(path);
    if (file.size === undefined) return { name };
    if (typeof file.size !== 'number') invalid(path);
    return { name, size: file.size };
  });
}

function readMindmaps(value: unknown): CourseEditorPageData['mindmaps'] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid('mindmaps');
  return value.map((map, index) => {
    const path = `mindmaps[${index}]`;
    if (!isRecord(map) || map.visibility !== 'public') invalid(path);
    return { _id: readString(map._id, path), title: readString(map.title, path), visibility: 'public' };
  });
}

function readUser(value: unknown, path: string): DomainUserOption {
  if (!isRecord(value) || typeof value._id !== 'number' || !Number.isSafeInteger(value._id)) invalid(path);
  const user: DomainUserOption = { _id: value._id };
  for (const key of ['uname', 'displayName', 'mail', 'avatarUrl', 'studentId', 'realName'] as const) {
    const field = value[key];
    if (field === undefined) continue;
    user[key] = readString(field, path);
  }
  return user;
}

function readCourse(value: unknown): CourseRecord {
  if (!isRecord(value)) invalid('tdoc');
  const title = readString(value.title, 'tdoc.title');
  if (title.trim() === '') invalid('tdoc.title');
  const course: CourseRecord = { title };
  if (value._id !== undefined) course._id = readId(value._id, 'tdoc._id');
  if (value.docId !== undefined) course.docId = readId(value.docId, 'tdoc.docId');
  if (value.owner !== undefined) {
    if (typeof value.owner !== 'number' || !Number.isSafeInteger(value.owner)) invalid('tdoc.owner');
    course.owner = value.owner;
  }
  const description = readOptionalString(value.description, 'tdoc.description');
  if (description !== undefined) course.description = description;
  const term = readOptionalString(value.term, 'tdoc.term');
  if (term !== undefined) course.term = term;
  const content = readOptionalString(value.content, 'tdoc.content');
  if (content !== undefined) course.content = content;
  if (value.courseHidden !== undefined) course.courseHidden = readBoolean(value.courseHidden, 'tdoc.courseHidden');
  if (value.courseGroupIds !== undefined) {
    if (!Array.isArray(value.courseGroupIds)) invalid('tdoc.courseGroupIds');
    course.courseGroupIds = value.courseGroupIds.map((id, index) => readId(id, `tdoc.courseGroupIds[${index}]`));
  }
  if (value.mindmapId !== undefined && value.mindmapId !== null) course.mindmapId = readId(value.mindmapId, 'tdoc.mindmapId');
  if (value.courseVideoDueAt === null) course.courseVideoDueAt = null;
  else if (value.courseVideoDueAt !== undefined) {
    if (typeof value.courseVideoDueAt !== 'string' && !(value.courseVideoDueAt instanceof Date)) invalid('tdoc.courseVideoDueAt');
    course.courseVideoDueAt = value.courseVideoDueAt;
  }
  if (Array.isArray(value.maintainer)) {
    course.maintainer = value.maintainer.map((uid, index) => {
      if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) invalid(`tdoc.maintainer[${index}]`);
      return uid;
    });
  }
  const exam = readCourseExam(value.courseExam);
  if (exam) course.courseExam = exam;
  return course;
}

function readOwnedMindmap(value: unknown): CourseEditorPageData['courseOwnedMindmap'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid('courseOwnedMindmap');
  return {
    _id: readString(value._id, 'courseOwnedMindmap._id'),
    title: readString(value.title, 'courseOwnedMindmap.title'),
    updatedAt: readString(value.updatedAt, 'courseOwnedMindmap.updatedAt'),
  };
}

function parseCourseEditor(data: unknown): CourseEditorPageData {
  if (!isRecord(data) || data.page_name !== 'course_edit') invalid('page_name');
  const chapters = data.chapters;
  if (chapters !== undefined && typeof chapters !== 'string') invalid('chapters');
  const expectedOwner = data.expectedOwner;
  if (expectedOwner !== undefined && (typeof expectedOwner !== 'number' || !Number.isSafeInteger(expectedOwner))) invalid('expectedOwner');
  return {
    page_name: 'course_edit',
    tdoc: readCourse(data.tdoc),
    ...(typeof chapters === 'string' ? { chapters } : {}),
    groupOptions: readGroups(data.groupOptions, 'groupOptions'),
    attachedGroups: readGroups(data.attachedGroups, 'attachedGroups'),
    canManageOwnGroups: readBoolean(data.canManageOwnGroups, 'canManageOwnGroups'),
    canManageFiles: readBoolean(data.canManageFiles, 'canManageFiles'),
    canCreateQuiz: readBoolean(data.canCreateQuiz, 'canCreateQuiz'),
    ...(readOptionalBoolean(data.canCreate, 'canCreate') !== undefined ? { canCreate: readBoolean(data.canCreate, 'canCreate') } : {}),
    ...(readOptionalBoolean(data.canAssign, 'canAssign') !== undefined ? { canAssign: readBoolean(data.canAssign, 'canAssign') } : {}),
    ...(typeof expectedOwner === 'number' ? { expectedOwner } : {}),
    ...(data.ownerUser !== undefined ? { ownerUser: readUser(data.ownerUser, 'ownerUser') } : {}),
    ...(Array.isArray(data.maintainerUsers)
      ? { maintainerUsers: data.maintainerUsers.map((user, index) => readUser(user, `maintainerUsers[${index}]`)) }
      : {}),
    files: readFiles(data.files),
    mindmaps: readMindmaps(data.mindmaps),
    ...(readOwnedMindmap(data.courseOwnedMindmap) ? { courseOwnedMindmap: readOwnedMindmap(data.courseOwnedMindmap) } : {}),
    courseExamContest: data.courseExamContest,
  };
}

function courseDocumentId(course: CourseRecord): string {
  const id = course.docId ?? course._id;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id);
  throw new TypeError('课程编号无效');
}

function editorChapters(raw: unknown): ChapterDraft[] {
  const parsed = initialChapterDrafts(raw);
  if (parsed.length > 0) return parsed;
  return [{
    _id: 1,
    title: '第一章',
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
    problemSetId: '',
    stageIds: '',
  }];
}

function panelTab(): CourseTab {
  const tab = parseCourseTab(new URLSearchParams(window.location.search).get('tab'));
  return tab === 'videos' ? 'chapters' : tab;
}

function classSummary(course: CourseRecord, options: readonly GroupRefView[], attached: readonly GroupRefView[]): string {
  const ids = (course.courseGroupIds || []).map(String);
  if (ids.length === 0) return '全站可见';
  const byId = new Map<string, GroupRefView>();
  for (const group of options) byId.set(group._id, group);
  for (const group of attached) byId.set(group._id, group);
  return ids.map((id) => {
    const group = byId.get(id);
    if (!group) throw new TypeError(`Course group selection has no server view: ${id}`);
    if (group.state === 'deleted' || !group.name) return '已删除的组';
    return group.name;
  }).join('、');
}

function summaryText(chapters: readonly ChapterDraft[]): string {
  const summary = courseSummary([...chapters]);
  return `${summary.chapters} 章 · ${summary.videos} 个视频 · ${summary.problemSets} 个题目集`;
}

/** Chapter-gate binding currently posted by the exam tab, or null when this save would not lock a chapter. */
function readRemovalExam(form: HTMLFormElement): CourseExamBinding | null {
  const fields = new FormData(form);
  const contestId = fields.get('courseExamContestId');
  if (typeof contestId !== 'string' || contestId === '') return null;
  if (fields.get('courseExamGate') !== 'chapter') return null;
  const rawChapter = fields.get('courseExamChapterId');
  if (typeof rawChapter !== 'string' || rawChapter === '') return null;
  const chapterId = Number(rawChapter);
  if (!Number.isSafeInteger(chapterId)) return null;
  return { contestId, gate: 'chapter', chapterId };
}

function sameRemovalExam(current: CourseExamBinding | null, next: CourseExamBinding | null): boolean {
  if (current === next) return true;
  if (current === null || next === null) return false;
  return current.contestId === next.contestId && current.gate === next.gate && current.chapterId === next.chapterId;
}

function formParams(form: HTMLFormElement): URLSearchParams {
  const body = new URLSearchParams();
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value !== 'string') continue;
    body.append(name, value);
  }
  return body;
}

function readSavedCourseId(body: Record<string, unknown>): string {
  const tid = body.tid;
  if (typeof tid === 'string' && tid !== '') return tid;
  if (typeof tid === 'number' && Number.isSafeInteger(tid)) return String(tid);
  throw new Error('课程保存成功响应缺少 tid');
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return '课程保存失败';
}

function CourseCreateRedirect() {
  useEffect(() => {
    window.location.replace(CREATE_TARGET);
  }, []);
  return <p className="text-sm text-fg-muted">正在打开…</p>;
}

function CourseEditor({ data }: { data: CourseEditorPageData }) {
  const course = data.tdoc;
  const title = course?.title ?? '';
  const [chapters, setChapters] = useState<ChapterDraft[]>(() => editorChapters(data.chapters));
  const [tab, setTab] = useState<CourseTab>(panelTab);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const [removalExam, setRemovalExam] = useState<CourseExamBinding | null>(null);
  const savingRef = useRef(false);
  const revisionRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const navigationGuard = useUnsavedChangesGuard(dirty);
  const { activeId, activeSectionId, selectChapter, selectSection } = useChapterQuery(chapters);
  useEffect(() => {
    const syncTab = () => setTab(panelTab());
    window.addEventListener('popstate', syncTab);
    return () => window.removeEventListener('popstate', syncTab);
  }, []);
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const next = readRemovalExam(form);
    setRemovalExam((current) => (sameRemovalExam(current, next) ? current : next));
  }, [editRevision]);
  const courseId = course ? courseDocumentId(course) : '';
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) ?? chapters[0];
  if (!course?.title || courseId === '' || !activeChapter) throw new TypeError('课程没有章节');
  const section = activeSectionId == null
    ? null
    : activeChapter.sections.find((item) => item._id === activeSectionId) ?? null;
  const hiddenCourse = course.courseHidden === true;

  const markDirty = () => {
    revisionRef.current += 1;
    setEditRevision(revisionRef.current);
    setSaveError('');
    setDirty(true);
  };

  const replaceChapters = (next: ChapterDraft[]) => {
    if (next.length === 0) throw new TypeError('课程至少保留一章');
    setChapters(next);
    markDirty();
  };

  const replaceChapter = (next: ChapterDraft) => {
    setChapters((current) => current.map((chapter) => (chapter._id === next._id ? next : chapter)));
    markDirty();
  };

  const showTab = (next: CourseTab) => {
    if (next === 'videos') return;
    const url = new URL(window.location.href);
    if (next === 'chapters') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setTab(next);
  };

  const selectUnit = (chapterId: number, sectionId: number | null) => {
    if (sectionId == null) selectChapter(chapterId);
    else selectSection(chapterId, sectionId);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const form = event.currentTarget;
    const submittedRevision = revisionRef.current;
    savingRef.current = true;
    setSaveError('');
    setSaving(true);
    try {
      const body = await postForm(form.action, formParams(form), '课程保存失败');
      readSavedCourseId(body);
      if (revisionRef.current !== submittedRevision) {
        savingRef.current = false;
        setSaving(false);
        setDirty(true);
        return;
      }
      navigationGuard.allowNavigation();
      window.location.reload();
    } catch (error) {
      console.error(error);
      savingRef.current = false;
      setSaving(false);
      setSaveError(errorText(error));
    }
  };

  const discard = () => {
    navigationGuard.allowNavigation();
    window.location.reload();
  };

  const outline = (onSelect: (chapterId: number, sectionId: number | null) => void) => (
    <OutlinePanel
      chapters={chapters}
      activeId={activeChapter._id}
      activeSectionId={activeSectionId}
      onSelect={onSelect}
      onChange={replaceChapters}
      removalBlocker={(chapter) => chapterRemovalBlocker(chapter, removalExam)}
      onGenerateFromMindmap={() => showTab('mindmap')}
    />
  );

  const tabs: PageTabItem<CourseTab>[] = [
    { value: 'chapters', label: '章节' },
    { value: 'students', label: '学生与可见性' },
    { value: 'exam', label: '结业考试' },
    { value: 'mindmap', label: '导图' },
    { value: 'videos', label: '观看统计', href: `/course/${courseId}/videos` },
    { value: 'settings', label: '设置' },
  ];

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={(
          <Breadcrumb items={[
            { label: '课程', href: '/teach/courses' },
            { label: title },
          ]}
          />
        )}
        title={title}
        meta={(
          <>
            <Badge variant="outline" size="sm">课程</Badge>
            <span className="min-w-0">{classSummary(course, data.groupOptions, data.attachedGroups)}</span>
            <span className="tabular">{summaryText(chapters)}</span>
            {hiddenCourse ? <Badge size="sm">已隐藏</Badge> : null}
          </>
        )}
        actions={(
          <Button asChild variant="secondary">
            <a href={`/course/${courseId}`} target="_blank" rel="noreferrer">
              <Eye />
              学生视角
            </a>
          </Button>
        )}
        tabs={(
          <PageTabs
            aria-label="课程页签"
            value={tab}
            onValueChange={showTab}
            items={tabs}
          />
        )}
      />
      {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
      <form
        ref={formRef}
        id="course-editor-form"
        action={`/course/${courseId}/edit`}
        method="post"
        onSubmit={(event) => { void save(event); }}
      >
        <input type="hidden" name="tid" value={courseId} />
        <input type="hidden" name="chapters" value={chaptersJson(chapters)} />
        <input type="hidden" name="description" value={course.description || ''} />
        <div hidden={tab !== 'chapters'} className="flex flex-col gap-4">
          <div className="lg:hidden">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOutlineOpen(true)}>
              <ListTree />
              大纲
            </Button>
          </div>
          {/* ds-allow DS004: 左栏 18rem 加大纲，间距档写不出这条轨道 */}
          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="hidden min-w-0 lg:block">
              {outline(selectUnit)}
            </aside>
            <ChapterPanel
              courseId={courseId}
              saved
              dirty={dirty}
              chapter={activeChapter}
              section={section}
              onChange={replaceChapter}
              addContent={(
                <AddContentMenu
                  courseId={courseId}
                  saved
                  dirty={dirty}
                  chapter={activeChapter}
                  section={section}
                  onChange={replaceChapter}
                />
              )}
            />
          </div>
        </div>
        <CourseStudentsTab data={data} chapters={chapters} onDirty={markDirty} active={tab === 'students'} />
        {data.canManageOwnGroups ? (
          <div hidden={tab !== 'students'} className="max-w-3xl">
            <Button asChild variant="link" size="sm">
              <a href="/user-groups">管理我的用户组</a>
            </Button>
          </div>
        ) : null}
        <CourseExamTab data={data} chapters={chapters} onDirty={markDirty} active={tab === 'exam'} />
        <CourseMindmapTab
          data={data}
          chapters={chapters}
          onDirty={markDirty}
          active={tab === 'mindmap'}
          onChaptersReplaced={replaceChapters}
        />
        <CourseSettingsTab data={data} chapters={chapters} onDirty={markDirty} active={tab === 'settings'} />
      </form>
      <SaveBar
        dirtyCount={dirty ? 1 : 0}
        saving={saving}
        onSave={() => {
          const form = formRef.current;
          if (!form) throw new TypeError('课程表单不存在');
          form.requestSubmit();
        }}
        onDiscard={discard}
      />
      {navigationGuard.guardDialog}
      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>大纲</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {outline((chapterId, sectionId) => {
              selectUnit(chapterId, sectionId);
              setOutlineOpen(false);
            })}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Page>
  );
}

export function CourseEditPage() {
  const data = useBootstrap().page.data;
  const pageName = readPageName(data);
  if (pageName === 'course_create') return <CourseCreateRedirect />;
  if (pageName !== 'course_edit') invalid('page_name');
  return <CourseEditor data={parseCourseEditor(data)} />;
}
