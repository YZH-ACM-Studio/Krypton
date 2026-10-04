import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  EyeOff,
  Layers,
  ListTree,
  Network,
  Plus,
  Save,
  Shield,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { Button } from '@/components/ui/button';
import { confirmDialog, confirmFormSubmit } from '@/components/ui/dialog';
import { Spinner, StatusDot } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Alert } from '@/components/ui/alert';
import { Toolbar, Workspace } from '@/components/ui/page';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FileUploader } from '@/components/uploader';
import type { DomainUserOption } from '@/components/domain-user-search';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { PracticeIntegrityPolicyPanel } from '@/components/practice-integrity-policy-panel';
import { CourseAssignForm } from './assign';
import { claimChapterProblemIds } from './chapter-draft';
import { ChapterLinks } from './chapter-links';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import { CourseExamSettings } from './course-exam-settings';
import {
  courseGroupOptionLabel,
  mergeCourseGroupOptions,
  readCourseExam,
  readCourseExamContest,
  type ChapterDraft,
  type CourseAuthorVideo,
  type CourseFile,
  type CourseRecord,
  type GroupRefView,
  type SectionDraft,
} from './types';
import { CourseMark } from './ui';
import { CourseVideoEditor } from './video-editor';

type SaveState = 'idle' | 'dirty' | 'saving';

function readAuthorVideos(raw: unknown): CourseAuthorVideo[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TypeError('Invalid course video payload');
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid course video payload');
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.title !== 'string') throw new TypeError('Invalid course video payload');
    if (rec.ext !== 'mp4' && rec.ext !== 'webm') throw new TypeError('Invalid course video payload');
    return {
      id: rec.id,
      title: rec.title,
      filename: typeof rec.filename === 'string' ? rec.filename : 'video.mp4',
      ext: rec.ext,
      size: typeof rec.size === 'number' ? rec.size : 0,
      durationMs: typeof rec.durationMs === 'number' ? rec.durationMs : 0,
      confirmed: rec.confirmed === true,
      contentRevision: typeof rec.contentRevision === 'number' ? rec.contentRevision : 1,
    };
  });
}

function initialChapterDrafts(serialized?: string): ChapterDraft[] {
  if (!serialized) return [];
  const parsed = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid course chapter payload');
  return parsed.map((chapter) => ({
    _id: Number(chapter._id),
    title: String(chapter.title || ''),
    content: String(chapter.content || ''),
    pids: Array.isArray(chapter.pids) ? chapter.pids.map(String) : [],
    videos: readAuthorVideos(chapter.videos),
    sections: Array.isArray(chapter.sections)
      ? chapter.sections.map((section: SectionDraft) => ({
          _id: Number(section._id),
          title: String(section.title || ''),
          content: String(section.content || ''),
          pids: Array.isArray(section.pids) ? section.pids.map(String) : [],
          videos: readAuthorVideos((section as { videos?: unknown }).videos),
        }))
      : [],
    tids: Array.isArray(chapter.tids) ? chapter.tids.map(String).join(',') : '',
    problemSetId: chapter.problemSetId ? String(chapter.problemSetId) : '',
    stageIds: Array.isArray(chapter.stageIds) ? chapter.stageIds.map(String).join(',') : '',
  }));
}

function dueAtInputValue(raw: unknown): string {
  if (!raw) return '';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseRefs(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A titled group on the settings rail. */
function SettingsGroup({
  title,
  description,
  icon: Icon,
  children,
  id,
  className,
  collapsible = false,
}: {
  title: string;
  description?: string;
  icon: typeof Layers;
  children: ReactNode;
  id?: string;
  className?: string;
  collapsible?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const heading = (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-active text-fg-subtle">
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <h2 id={headingId} className="min-w-0 truncate text-sm font-semibold text-fg">
        {title}
      </h2>
    </div>
  );
  if (collapsible) {
    return (
      <details id={id} className={cn('group rounded-lg border border-line bg-surface shadow-xs', className)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden [&>div]:min-w-0 [&>div]:flex-1">
          {heading}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-2) ease-(--ease-out) group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-line-subtle px-4 py-3">{children}</div>
      </details>
    );
  }
  return (
    <section id={id} aria-labelledby={headingId} className={cn('rounded-lg border border-line bg-surface p-4 shadow-xs', className)}>
      <div className="mb-3">{heading}</div>
      {description ? <p className="mb-3 text-sm text-fg-muted">{description}</p> : null}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = state === 'saving' ? '正在保存…' : state === 'dirty' ? '有未保存更改' : '已保存';
  return (
    <div aria-live="polite" aria-label={label} className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-subtle">
      {state === 'saving' ? (
        <Spinner className="size-3.5 text-brand-fg" />
      ) : state === 'dirty' ? (
        <StatusDot tone="warning" />
      ) : (
        <Check className="size-3.5 text-success-fg" strokeWidth={2.5} />
      )}
      <span className={cn('hidden sm:inline', state === 'dirty' && 'text-warning-fg')}>{label}</span>
    </div>
  );
}

interface CourseEditorPageData {
  tdoc?: CourseRecord;
  chapters?: string;
  page_name: string;
  groupOptions: GroupRefView[];
  attachedGroups: GroupRefView[];
  canManageOwnGroups: boolean;
  canManageFiles: boolean;
  canCreate?: boolean;
  canCreateQuiz: boolean;
  canAssign?: boolean;
  expectedOwner?: number;
  ownerUser?: DomainUserOption;
  maintainerUsers?: DomainUserOption[];
  files: CourseFile[];
  mindmaps: Array<{ _id: string; title: string; visibility: 'public' }>;
  courseOwnedMindmap?: { _id: string; title: string; updatedAt: string };
  courseExamContest?: unknown;
}

function assertCourseGroupPayload(data: CourseEditorPageData): void {
  if (!Array.isArray(data.groupOptions) || !Array.isArray(data.attachedGroups) || typeof data.canManageOwnGroups !== 'boolean') {
    throw new TypeError('Invalid course group payload');
  }
}

export function CourseEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as CourseEditorPageData;
  const isEdit = data.page_name === 'course_edit';
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id || '');
  const courseExam = readCourseExam(course.courseExam);
  const courseExamContest = readCourseExamContest(data.courseExamContest);
  const parsedChapters = useMemo(() => initialChapterDrafts(data.chapters), [data.chapters]);
  const [chapters, setChapters] = useState<ChapterDraft[]>(
    parsedChapters.length
      ? parsedChapters
      : [{ _id: 1, title: '第一章', content: '', pids: [], videos: [], sections: [], tids: '', problemSetId: '', stageIds: '' }],
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set((course.courseGroupIds || []).map(String)));
  const [courseHidden, setCourseHidden] = useState(course.courseHidden === true);
  const [selectedMindmapId, setSelectedMindmapId] = useState(String(course.mindmapId || ''));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [copying, setCopying] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [chapterTab, setChapterTab] = useState<'video' | 'notes' | 'problems' | 'links'>('video');
  const [courseFiles, setCourseFiles] = useState<CourseFile[]>(data.files || []);
  const [fileError, setFileError] = useState('');
  const pendingSectionSelect = useRef<{ chapterId: number; sectionId: number } | null>(null);
  const { activeId, activeSectionId, selectChapter, selectSection } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];
  const editingSection =
    activeSectionId == null ? null : activeChapter.sections.find((section) => section._id === activeSectionId) || null;

  useEffect(() => {
    if (saveState !== 'dirty') return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    const pending = pendingSectionSelect.current;
    if (!pending) return;
    const chapter = chapters.find((item) => item._id === pending.chapterId);
    if (!chapter?.sections.some((section) => section._id === pending.sectionId)) return;
    pendingSectionSelect.current = null;
    selectSection(pending.chapterId, pending.sectionId);
    setChapterTab('video');
  }, [chapters, selectSection]);

  useEffect(() => {
    if (activeSectionId != null && chapterTab === 'links') setChapterTab('video');
  }, [activeSectionId, chapterTab]);

  const markDirty = () => {
    setSaveError('');
    setSaveState((state) => (state === 'saving' ? state : 'dirty'));
  };

  const updateChapter = (chapterId: number, patch: Partial<ChapterDraft>) => {
    setChapters((current) => current.map((chapter) => (chapter._id === chapterId ? { ...chapter, ...patch } : chapter)));
    markDirty();
  };

  const addChapter = () => {
    const chapterId = Math.max(0, ...chapters.map((chapter) => chapter._id)) + 1;
    setChapters((current) => [
      ...current,
      {
        _id: chapterId,
        title: `第 ${current.length + 1} 章`,
        content: '',
        pids: [],
        videos: [],
        sections: [],
        tids: '',
        problemSetId: '',
        stageIds: '',
      },
    ]);
    markDirty();
  };

  const moveChapter = (chapterId: number, direction: -1 | 1) => {
    setChapters((current) => {
      const from = current.findIndex((chapter) => chapter._id === chapterId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    markDirty();
  };

  const removeChapter = (chapterId: number) => {
    if (chapters.length === 1) return;
    if (activeChapter._id === chapterId) {
      const index = chapters.findIndex((chapter) => chapter._id === chapterId);
      const replacement = chapters[index + 1] || chapters[index - 1];
      if (replacement) selectChapter(replacement._id, true);
    }
    setChapters((current) => current.filter((chapter) => chapter._id !== chapterId));
    markDirty();
  };

  const updateSection = (chapterId: number, sectionId: number, patch: Partial<SectionDraft>) => {
    setChapters((current) =>
      current.map((chapter) =>
        chapter._id === chapterId
          ? {
              ...chapter,
              sections: chapter.sections.map((section) => (section._id === sectionId ? { ...section, ...patch } : section)),
            }
          : chapter,
      ),
    );
    markDirty();
  };

  const updateChapterPids = (chapterId: number, pids: string[]) => {
    setChapters((current) => current.map((chapter) => (chapter._id === chapterId ? claimChapterProblemIds(chapter, 'loose', pids) : chapter)));
    markDirty();
  };

  const updateSectionPids = (chapterId: number, sectionId: number, pids: string[]) => {
    setChapters((current) => current.map((chapter) => (chapter._id === chapterId ? claimChapterProblemIds(chapter, sectionId, pids) : chapter)));
    markDirty();
  };

  const addSection = (chapterId: number) => {
    const chapter = chapters.find((item) => item._id === chapterId);
    if (!chapter) return;
    const sectionId = Math.max(0, ...chapter.sections.map((section) => section._id)) + 1;
    pendingSectionSelect.current = { chapterId, sectionId };
    setChapters((current) =>
      current.map((item) =>
        item._id === chapterId
          ? {
              ...item,
              sections: [...item.sections, { _id: sectionId, title: `第 ${item.sections.length + 1} 节`, content: '', pids: [], videos: [] }],
            }
          : item,
      ),
    );
    markDirty();
  };

  const moveSection = (chapterId: number, sectionId: number, direction: -1 | 1) => {
    setChapters((current) =>
      current.map((chapter) => {
        if (chapter._id !== chapterId) return chapter;
        const from = chapter.sections.findIndex((section) => section._id === sectionId);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= chapter.sections.length) return chapter;
        const sections = [...chapter.sections];
        [sections[from], sections[to]] = [sections[to], sections[from]];
        return { ...chapter, sections };
      }),
    );
    markDirty();
  };

  const removeSection = (chapterId: number, sectionId: number) => {
    if (activeId === chapterId && activeSectionId === sectionId) selectChapter(chapterId, true);
    setChapters((current) =>
      current.map((chapter) =>
        chapter._id === chapterId ? { ...chapter, sections: chapter.sections.filter((section) => section._id !== sectionId) } : chapter,
      ),
    );
    markDirty();
  };

  const chaptersJson = JSON.stringify(
    chapters.map((chapter) => ({
      _id: chapter._id,
      title: chapter.title,
      ...(chapter.content ? { content: chapter.content } : {}),
      pids: chapter.pids,
      ...(chapter.sections.length
        ? {
            sections: chapter.sections.map((section) => ({
              _id: section._id,
              title: section.title,
              ...(section.content ? { content: section.content } : {}),
              pids: section.pids,
            })),
          }
        : {}),
      tids: parseRefs(chapter.tids),
      ...((chapter.problemSetId || '').trim() ? { problemSetId: (chapter.problemSetId || '').trim() } : {}),
      ...(parseRefs(chapter.stageIds || '').length ? { stageIds: parseRefs(chapter.stageIds || '').map(Number) } : {}),
    })),
  );
  assertCourseGroupPayload(data);
  const attachedIds = new Set(data.attachedGroups.map((group) => group._id));
  const mergedGroups = mergeCourseGroupOptions(data.groupOptions, data.attachedGroups);
  const mergedIds = new Set(mergedGroups.map((group) => group._id));
  for (const groupId of selectedGroups) {
    if (!mergedIds.has(groupId)) throw new TypeError(`Course group selection has no server view: ${groupId}`);
  }
  // Deleted groups stay selectable only while checked, so they cannot be added again.
  const selectableGroups = mergedGroups.filter((group) => group.state !== 'deleted' || selectedGroups.has(group._id));
  const selectedGroupViews = selectableGroups.filter((group) => selectedGroups.has(group._id));
  const formAction = isEdit ? `/course/${tid}/edit` : '/course/create';
  const fileEndpoint = isEdit ? `/course/${tid}/file` : '';
  const activeIndex = chapters.findIndex((chapter) => chapter._id === activeChapter._id);

  const refreshFiles = async () => {
    if (!fileEndpoint) return;
    const response = await fetchHydroResponse(fileEndpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await readHydroResponseError(response, '课件列表刷新失败'));
    const body = await response.json();
    if (!Array.isArray(body?.files)) throw new Error('课件列表响应格式错误');
    setCourseFiles(body.files);
  };

  const deleteFile = async (filename: string) => {
    const accepted = await confirmDialog('删除后不能恢复。', {
      title: `删除课件「${filename}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    setFileError('');
    const body = new URLSearchParams({ operation: 'delete_files' });
    body.append('files', filename);
    try {
      const response = await fetchHydroResponse(fileEndpoint, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '课件删除失败'));
      setCourseFiles((current) => current.filter((file) => file.name !== filename));
    } catch (error) {
      setFileError((error as { message?: string } | null)?.message || '课件删除失败');
    }
  };

  const ownedMindmap = data.courseOwnedMindmap;
  const createOwnedMindmap = async () => {
    if (!isEdit || saveState !== 'idle') return;
    if (course.mindmapId) {
      const accepted = await confirmDialog('创建后会解除当前公开导图绑定，学生将看到新的本课导图。公开导图本身不会被修改。', {
        title: '创建本课导图',
        confirmLabel: '创建',
      });
      if (!accepted) return;
    }
    setSaveError('');
    setCopying(true);
    try {
      const response = await fetchHydroResponse(`/course/${tid}/edit`, {
        method: 'POST',
        body: new URLSearchParams({ operation: 'create_mindmap' }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '本课导图创建失败'));
      window.location.assign(response.redirected ? response.url : `/course/${tid}/mindmap`);
    } catch (error) {
      setSaveError((error as { message?: string } | null)?.message || '本课导图创建失败');
      setCopying(false);
    }
  };
  const deleteOwnedMindmap = async () => {
    if (!isEdit || !ownedMindmap || saveState !== 'idle') return;
    const mapTitle = ownedMindmap.title.trim() || '本课导图';
    const accepted = await confirmDialog('节点和钉选都会删掉，不能恢复。题目本身不会删除，之后可以再绑定公开导图。', {
      title: `删除本课导图「${mapTitle}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    setSaveError('');
    setCopying(true);
    try {
      const response = await fetchHydroResponse(`/course/${tid}/edit`, {
        method: 'POST',
        body: new URLSearchParams({ operation: 'delete_mindmap', expectedUpdatedAt: ownedMindmap.updatedAt }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '本课导图删除失败'));
      window.location.assign(response.redirected ? response.url : `/course/${tid}/edit`);
    } catch (error) {
      setSaveError((error as { message?: string } | null)?.message || '本课导图删除失败');
      setCopying(false);
    }
  };

  const copyCourse = async () => {
    if (!isEdit || !data.canCreate || saveState !== 'idle' || copying) return;
    setSaveError('');
    setCopying(true);
    try {
      const response = await fetchHydroResponse(`/course/${tid}/edit`, {
        method: 'POST',
        body: new URLSearchParams({ operation: 'copy' }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '课程复制失败'));
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const body = await response.json();
      if (!body?.tid) throw new Error('课程复制成功响应缺少 tid');
      window.location.assign(`/course/${body.tid}/edit`);
    } catch (error) {
      setSaveError((error as { message?: string } | null)?.message || '课程复制失败');
      setCopying(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError('');
    setSaveState('saving');
    try {
      const form = event.currentTarget;
      const response = await fetchHydroResponse(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form) as unknown as URLSearchParams),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '课程保存失败'));
      if (response.redirected) {
        setSaveState('idle');
        window.location.assign(response.url);
        return;
      }
      const body = await response.json();
      if (!body?.tid) throw new Error('课程保存成功响应缺少 tid');
      setSaveState('idle');
      window.location.assign(`/course/${body.tid}`);
    } catch (error) {
      setSaveError((error as { message?: string } | null)?.message || '课程保存失败');
      setSaveState('dirty');
    }
  };

  const openChapter = (chapterId: number, sectionId?: number | null) => {
    if (sectionId == null) {
      selectChapter(chapterId);
      return;
    }
    selectSection(chapterId, sectionId);
    if (chapterTab === 'links') setChapterTab('video');
  };

  const selectFromMobile = (chapterId: number, sectionId?: number | null) => {
    openChapter(chapterId, sectionId);
    setOutlineOpen(false);
  };

  const sectionIndex = editingSection
    ? activeChapter.sections.findIndex((section) => section._id === editingSection._id)
    : -1;
  const unitVideos = editingSection ? editingSection.videos || [] : activeChapter.videos || [];
  const unitPids = editingSection ? editingSection.pids : activeChapter.pids;
  const videoCount = unitVideos.length;
  const sectionCount = chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  const chapterTabItems: PageTabItem<'video' | 'notes' | 'problems' | 'links'>[] = [
    { value: 'video', label: '视频', ...(videoCount > 0 ? { count: videoCount } : {}) },
    { value: 'notes', label: '讲义' },
    { value: 'problems', label: '题目', ...(unitPids.length > 0 ? { count: unitPids.length } : {}) },
    ...(!editingSection ? [{ value: 'links' as const, label: '关联' }] : []),
  ];

  return (
    <Workspace className="w-full min-w-0">
      <Toolbar
        className="min-h-10 shrink-0 border-b border-line bg-surface px-2"
        end={(
          <>
            <Button type="button" variant="ghost" size="sm" className="lg:hidden" onClick={() => setOutlineOpen(true)}>
              <ListTree strokeWidth={1.75} />
              章节
            </Button>
            <SaveIndicator state={saveState} />
            {isEdit && data.canCreate ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saveState !== 'idle' || copying}
                onClick={() => void copyCourse()}
                title={saveState === 'dirty' ? '请先保存课程修改。复制使用已保存的章节，不会带走未保存草稿、课件、报名或真实性策略。' : '复制为新课程'}
                aria-label="复制为新课程"
              >
                {copying ? <Spinner /> : <Copy strokeWidth={1.75} />}
                <span className="hidden lg:inline">复制为新课程</span>
              </Button>
            ) : null}
            {isEdit ? (
              <form
                method="post"
                action={`/course/${tid}/edit`}
                className="shrink-0"
                onSubmit={(event) => {
                  const title = course.title?.trim() || '该课程';
                  void confirmFormSubmit(event, '课件、视频和观看记录会一并删除，不能恢复。', {
                    title: `删除课程「${title}」？`,
                    confirmLabel: '删除',
                    destructive: true,
                  });
                }}
              >
                <input type="hidden" name="operation" value="delete" />
                <Button type="submit" variant="danger-soft" size="sm" formNoValidate disabled={copying} aria-label="删除课程">
                  <Trash2 strokeWidth={1.75} />
                  <span className="hidden lg:inline">删除课程</span>
                </Button>
              </form>
            ) : null}
            <Button form="course-editor-form" type="submit" variant="primary" size="sm" disabled={saveState === 'saving' || copying}>
              <Save strokeWidth={1.75} />
              {saveState === 'saving' ? '保存中' : '保存课程'}
            </Button>
          </>
        )}
      >
        <span className="min-w-0 truncate text-sm font-semibold text-fg">{isEdit ? course.title || '编辑课程' : '新建课程'}</span>
        <Button asChild variant="ghost" size="sm" iconOnly>
          <a href={isEdit ? `/course/${tid}` : '/course'} aria-label={isEdit ? '返回课程' : '返回课程列表'}>
            <ArrowLeft strokeWidth={1.75} />
          </a>
        </Button>
        {isEdit ? <CourseMark seed={tid} title={course.title || ''} className="size-6 text-xs" /> : null}
      </Toolbar>

      {saveError ? <Alert tone="danger" className="mx-2 mt-2 shrink-0">{saveError}</Alert> : null}

      <form
        id="course-editor-form"
        method="post"
        action={formAction}
        onSubmit={submit}
        onChange={markDirty}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div className="grid min-w-0 gap-6 p-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        {isEdit ? <input type="hidden" name="tid" value={tid} /> : null}
        <input type="hidden" name="chapters" value={chaptersJson} />
        <input type="hidden" name="description" value={course.description || ''} />

        <aside className="hidden self-start lg:sticky lg:top-0 lg:block">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-fg">
                  <Layers className="size-3.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">章节目录</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {chapters.length} 章{sectionCount ? ` · ${sectionCount} 节` : ''}
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={addChapter}>
                <Plus strokeWidth={2} />
                添加
              </Button>
            </div>
            <div className="p-1.5">
              <ChapterOutline
                chapters={chapters}
                activeId={activeChapter._id}
                activeSectionId={activeSectionId}
                onSelect={openChapter}
                onMove={moveChapter}
                onRemove={removeChapter}
                onAddSection={addSection}
                onMoveSection={moveSection}
                onRemoveSection={removeSection}
              />
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-5" aria-labelledby="chapter-editor-title">
          <details className="group rounded-lg border border-line bg-surface shadow-xs">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span id="course-description-title">课程简介</span>
                <span className="ml-2 font-normal text-fg-subtle">选填</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-2) ease-(--ease-out) group-open:rotate-180" />
            </summary>
            <div className="border-t border-line-subtle px-4 py-3">
              <MarkdownEditor name="content" value={course.content || ''} minHeight={160} />
            </div>
          </details>
          <h2 id="chapter-editor-title" className="sr-only">
            章节内容
          </h2>
          <Panel>
            <p className="text-xs font-medium text-fg-subtle">
              {editingSection ? (
                <>
                  <Button type="button" variant="link" size="sm" onClick={() => selectChapter(activeChapter._id)}>
                    第 {activeIndex + 1} 章
                  </Button>
                  {` · 第 ${sectionIndex + 1} 节`}
                </>
              ) : (
                `第 ${activeIndex + 1} 章 / 共 ${chapters.length} 章`
              )}
            </p>
            <label className="mt-2 block">
              <span id="active-chapter-title" className="sr-only">
                {editingSection ? '小节标题' : '章节标题'}
              </span>
              <Input
                value={editingSection ? editingSection.title : activeChapter.title}
                onChange={(event) =>
                  editingSection
                    ? updateSection(activeChapter._id, editingSection._id, { title: event.target.value })
                    : updateChapter(activeChapter._id, { title: event.target.value })
                }
                required
                aria-labelledby="active-chapter-title"
                placeholder={editingSection ? '小节标题' : '章节标题'}
                className="text-lg font-semibold"
              />
            </label>
          </Panel>

          <div className="space-y-4">
            <PageTabs
              aria-label="章节内容"
              value={chapterTab}
              onValueChange={setChapterTab}
              items={chapterTabItems}
            />
            {chapterTab === 'video' ? (
              <CourseVideoEditor
                key={editingSection ? `section-video-${activeChapter._id}-${editingSection._id}` : `chapter-video-${activeChapter._id}`}
                courseId={tid}
                chapterId={activeChapter._id}
                sectionId={editingSection ? editingSection._id : null}
                videos={unitVideos}
                onChange={(videos) =>
                  editingSection
                    ? updateSection(activeChapter._id, editingSection._id, { videos })
                    : updateChapter(activeChapter._id, { videos })
                }
                locked={!isEdit || !tid}
              />
            ) : null}
            {chapterTab === 'notes' ? (
              <section data-course-slot="chapterContent" aria-labelledby="chapter-content-title">
                <h3 id="chapter-content-title" className="sr-only">
                  {editingSection ? '小节讲义' : '章节讲义'}
                </h3>
                <MarkdownEditor
                  key={editingSection ? `${activeChapter._id}-${editingSection._id}` : activeChapter._id}
                  value={editingSection ? editingSection.content : activeChapter.content}
                  onChange={(content) =>
                    editingSection
                      ? updateSection(activeChapter._id, editingSection._id, { content })
                      : updateChapter(activeChapter._id, { content })
                  }
                  minHeight={280}
                />
              </section>
            ) : null}
            {chapterTab === 'problems' ? (
              <ProblemPicker
                value={unitPids}
                onChange={(pids) =>
                  editingSection
                    ? updateSectionPids(activeChapter._id, editingSection._id, pids)
                    : updateChapterPids(activeChapter._id, pids)
                }
              />
            ) : null}
            {chapterTab === 'links' ? (
              editingSection ? null : (
                <ChapterLinks
                  courseId={tid}
                  chapterId={activeChapter._id}
                  tids={activeChapter.tids}
                  problemSetId={activeChapter.problemSetId || ''}
                  stageIds={activeChapter.stageIds || ''}
                  onChangeTids={(tids) => updateChapter(activeChapter._id, { tids })}
                  onChangeProblemSet={(nextProblemSetId, nextStageIds) =>
                    updateChapter(activeChapter._id, { problemSetId: nextProblemSetId, stageIds: nextStageIds })
                  }
                  canCreateQuiz={Boolean(isEdit && data.canCreateQuiz)}
                  quizNeedsSave={saveState !== 'idle'}
                />
              )
            ) : null}
          </div>
        </section>

        <aside className="self-start lg:col-span-2 xl:sticky xl:top-0 xl:col-span-1">
            <div className="space-y-4">
          <SettingsGroup title="课程" icon={Layers}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg">名称</span>
              <Input name="title" defaultValue={course.title || ''} required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg">学期</span>
              <Input name="term" defaultValue={course.term || ''} placeholder="2026 秋" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg">看完截止</span>
              <Input
                type="datetime-local"
                name="courseVideoDueAt"
                defaultValue={dueAtInputValue(course.courseVideoDueAt)}
              />
            </label>
          </SettingsGroup>

          <SettingsGroup id="course-mindmap-settings" title="知识导图" icon={Network} collapsible>
            {isEdit && ownedMindmap ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-fg">{ownedMindmap.title}</p>
                <p className="text-sm text-fg-muted">这是本课专属导图。学生进入课程就能看到当前结构。要改绑公开导图，需要先删除它。</p>
                <input type="hidden" name="mindmapId" value={ownedMindmap._id} />
                <div className="flex flex-wrap gap-2">
                  <Button asChild type="button" variant="secondary" size="sm">
                    <a href={`/course/${tid}/mindmap`}>编辑本课导图</a>
                  </Button>
                  <Button type="button" variant="danger-soft" size="sm" disabled={saveState !== 'idle' || copying} onClick={() => void deleteOwnedMindmap()}>
                    删除本课导图
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SimpleSelect
                  name="mindmapId"
                  value={selectedMindmapId}
                  onValueChange={(value) => {
                    setSelectedMindmapId(value);
                    markDirty();
                  }}
                  options={[
                    { value: '', label: '不绑定知识导图' },
                    ...(data.mindmaps || []).map((map) => ({ value: map._id, label: `${map.title} · 已公开` })),
                  ]}
                  ariaLabel="选择课程知识导图"
                />
                {isEdit ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={saveState !== 'idle' || copying}
                    title={saveState === 'dirty' ? '请先保存课程' : '创建本课导图'}
                    onClick={() => void createOwnedMindmap()}
                  >
                    创建本课导图
                  </Button>
                ) : (
                  <p className="text-sm text-fg-muted">保存课程后才能创建本课导图。</p>
                )}
              </div>
            )}
          </SettingsGroup>

          <SettingsGroup
            id="course-exam-settings"
            title="结业考试"
            icon={Trophy}
            description="绑定一场本域选择题考试。学生看完设定范围的视频后才能参加。"
          >
            <CourseExamSettings
              chapters={chapters}
              initialExam={courseExam}
              initialContest={courseExamContest}
              onDirty={markDirty}
            />
          </SettingsGroup>

          <SettingsGroup title="可见班级" icon={Users}>
            <MultiSelect<GroupRefView>
              options={selectableGroups}
              value={selectedGroupViews}
              onChange={(next) => {
                setSelectedGroups(new Set(next.map((group) => group._id)));
                markDirty();
              }}
              getKey={(group) => group._id}
              getLabel={(group) => courseGroupOptionLabel(group, attachedIds.has(group._id))}
              name="courseGroupIds"
              placeholder="搜索班级"
              emptyText="没有匹配的班级"
              minHeight={44}
            />
            <p className="text-xs text-fg-subtle">
              {selectedGroups.size ? `已选 ${selectedGroups.size} 个班级` : '未选班级时，课程对全站可见。'}
            </p>
            {data.canManageOwnGroups ? (
              <a
                href="/user-groups"
                className="inline-flex min-h-10 items-center text-sm font-medium text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                管理我的用户组
              </a>
            ) : null}
            <input type="hidden" name="courseHidden" value={courseHidden ? 'true' : 'false'} />
            <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2">
              <Switch
                checked={courseHidden}
                onCheckedChange={(checked) => {
                  setCourseHidden(checked);
                  markDirty();
                }}
                className="mt-0.5"
                aria-label="对学生隐藏"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                  <EyeOff className="size-3.5 text-fg-subtle" strokeWidth={1.75} />
                  对学生隐藏
                </span>
                <span className="mt-0.5 block text-xs text-fg-subtle">隐藏后学生看不到列表，也无法打开链接。老师仍可编辑。</span>
              </span>
            </label>
          </SettingsGroup>

          {isEdit && tid ? (
            <SettingsGroup id="course-integrity-settings" title="真实性训练" icon={Shield} collapsible>
              <PracticeIntegrityPolicyPanel containerKind="course" containerId={tid} />
            </SettingsGroup>
          ) : null}

          <SettingsGroup id="course-files-editor" title="课件下载" icon={FileText} collapsible>
            <div data-course-slot="files" className="space-y-3">
              {fileError ? <Alert tone="danger">{fileError}</Alert> : null}
              {isEdit && data.canManageFiles ? (
                <FileUploader
                  endpoint={fileEndpoint}
                  maxFiles={10}
                  uploadConcurrency={1}
                  onBatchComplete={() => {
                    void refreshFiles().catch((error) => setFileError(error?.message || '课件列表刷新失败'));
                  }}
                />
              ) : !isEdit ? (
                <p className="text-sm text-fg-muted">先保存课程，再上传课件。</p>
              ) : null}
              {courseFiles.length ? (
                <div className="space-y-0.5">
                  {courseFiles.map((file) => (
                    <div key={file.name} className="flex min-h-12 items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                      <FileText className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">{file.name}</span>
                      <Button asChild variant="ghost" size="sm" iconOnly>
                        <a href={`/course/${tid}/file/${encodeURIComponent(file.name)}`} aria-label={`下载${file.name}`}>
                          <Download strokeWidth={1.75} />
                        </a>
                      </Button>
                      {data.canManageFiles ? (
                        <Button
                          type="button"
                          variant="danger-soft"
                          size="sm"
                          iconOnly
                          onClick={() => deleteFile(file.name)}
                          aria-label={`删除${file.name}`}
                        >
                          <Trash2 strokeWidth={1.75} />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </SettingsGroup>
          <div data-course-slot="collaborators">
            {isEdit && data.canAssign ? (
              <SettingsGroup id="course-assign" title="课程分配" icon={Users} collapsible>
                <CourseAssignForm
                  domainId={bs.domain.id}
                  action={`/course/${tid}/edit`}
                  expectedOwner={Number(data.expectedOwner || course.owner || 0)}
                  initialOwner={data.ownerUser || (Number(course.owner) > 0 ? { _id: Number(course.owner) } : null)}
                  initialMaintainers={data.maintainerUsers || []}
                />
              </SettingsGroup>
            ) : null}
          </div>
            </div>
        </aside>
        </div>
      </form>

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left">
          <SheetHeader className="flex items-center justify-between gap-2 pr-12">
            <SheetTitle>章节目录</SheetTitle>
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={addChapter}>
              <Plus strokeWidth={2} />
              添加
            </Button>
          </SheetHeader>
          <SheetBody className="p-4">
            <ChapterOutline
              chapters={chapters}
              activeId={activeChapter._id}
              activeSectionId={activeSectionId}
              onSelect={selectFromMobile}
              onMove={moveChapter}
              onRemove={removeChapter}
              onAddSection={addSection}
              onMoveSection={moveSection}
              onRemoveSection={removeSection}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Workspace>
  );
}
