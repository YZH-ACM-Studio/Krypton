import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  Layers,
  Link2,
  ListTree,
  Loader2,
  Network,
  Plus,
  Save,
  Shield,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs-compound';
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
import type { ChapterDraft, CourseAuthorVideo, CourseFile, CourseRecord, SectionDraft } from './types';
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
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <h2 id={headingId} className="text-sm font-medium leading-5">
        {title}
      </h2>
    </div>
  );
  if (collapsible) {
    return (
      <details id={id} className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
        <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">{heading}</summary>
        <div className="space-y-3 border-t px-4 py-3">{children}</div>
      </details>
    );
  }
  return (
    <section id={id} aria-labelledby={headingId} className={cn('rounded-xl border bg-card p-4 text-card-foreground shadow-sm', className)}>
      <div className="mb-3">{heading}</div>
      {description ? <p className="mb-3 text-sm text-muted-foreground">{description}</p> : null}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <div aria-live="polite" className="krypton-course-meta inline-flex items-center gap-1.5">
      {state === 'saving' ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-primary" strokeWidth={2} />
          正在保存…
        </>
      ) : state === 'dirty' ? (
        <>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
          <span className="text-amber-700 dark:text-amber-400">有未保存更改</span>
        </>
      ) : (
        <>
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
          已保存
        </>
      )}
    </div>
  );
}

export function CourseEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc?: CourseRecord;
    chapters?: string;
    page_name: string;
    groups: Array<{ _id: string; name: string; archivedAt?: string | null }>;
    canManageFiles: boolean;
    canCreate?: boolean;
    canCreateQuiz: boolean;
    canAssign?: boolean;
    expectedOwner?: number;
    ownerUser?: DomainUserOption;
    maintainerUsers?: DomainUserOption[];
    files: CourseFile[];
    mindmaps: Array<{ _id: string; title: string; visibility: 'public' }>;
  };
  const isEdit = data.page_name === 'course_edit';
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id || '');
  const parsedChapters = useMemo(() => initialChapterDrafts(data.chapters), [data.chapters]);
  const [chapters, setChapters] = useState<ChapterDraft[]>(
    parsedChapters.length
      ? parsedChapters
      : [{ _id: 1, title: '第一章', content: '', pids: [], videos: [], sections: [], tids: '', problemSetId: '', stageIds: '' }],
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set((course.courseGroupIds || []).map(String)));
  const [selectedMindmapId, setSelectedMindmapId] = useState(String(course.mindmapId || ''));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [copying, setCopying] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [chapterTab, setChapterTab] = useState('video');
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
  const activeGroups = (data.groups || []).filter((group) => !group.archivedAt || selectedGroups.has(group._id));
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

  return (
    <main className="w-full min-w-0 pb-10">
      {/* The action bar follows the scroll. A long chapter draft used to push
          save state and the save button off screen entirely. */}
      <header
        className={cn(
          'krypton-course-panel sticky top-0 z-30 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5',
          'bg-card/85 backdrop-blur-xl',
        )}
      >
        <Button asChild variant="ghost" size="icon" className="size-10 shrink-0">
          <a href={isEdit ? `/course/${tid}` : '/course'} aria-label={isEdit ? '返回课程' : '返回课程列表'}>
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </a>
        </Button>
        {isEdit ? <CourseMark seed={tid} title={course.title || ''} className="size-9 text-sm" /> : null}
        <div className="min-w-0 flex-1">
          <p className="krypton-course-eyebrow truncate">课程工作区</p>
          <h1 className="krypton-course-title mt-0.5 truncate">{isEdit ? course.title || '编辑课程' : '新建课程'}</h1>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10 shrink-0 gap-1.5 lg:hidden" onClick={() => setOutlineOpen(true)}>
          <ListTree className="size-3.5" strokeWidth={1.75} />
          章节
        </Button>
        <SaveIndicator state={saveState} />
        {isEdit && data.canCreate ? (
          <Button
            type="button"
            variant="outline"
            disabled={saveState !== 'idle' || copying}
            onClick={() => void copyCourse()}
            className="h-10 shrink-0 gap-1.5"
            title={saveState === 'dirty' ? '请先保存课程修改。复制使用已保存的章节，不会带走未保存草稿、课件、报名或真实性策略。' : undefined}
          >
            {copying ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} /> : <Copy className="size-4" strokeWidth={1.75} />}
            复制为新课程
          </Button>
        ) : null}
        <Button
          form="course-editor-form"
          type="submit"
          disabled={saveState === 'saving' || copying}
          className={cn('h-10 shrink-0 gap-1.5 active:scale-[0.97]', saveState === 'dirty' && 'shadow-md')}
        >
          <Save className="size-4" strokeWidth={1.75} />
          {saveState === 'saving' ? '保存中' : '保存课程'}
        </Button>
      </header>

      {saveError ? (
        <div role="alert" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      ) : null}

      <form
        id="course-editor-form"
        method="post"
        action={formAction}
        onSubmit={submit}
        onChange={markDirty}
        className="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_21rem] xl:gap-7"
      >
        {isEdit ? <input type="hidden" name="tid" value={tid} /> : null}
        <input type="hidden" name="chapters" value={chaptersJson} />
        <input type="hidden" name="description" value={course.description || ''} />

        <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
          <div className="krypton-course-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="size-3.5" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold leading-4">章节目录</p>
                  <p className="krypton-course-meta">
                    {chapters.length} 章{sectionCount ? ` · ${sectionCount} 节` : ''}
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={addChapter}>
                <Plus className="size-3.5" strokeWidth={2} />
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
          <details className="rounded-xl border bg-card shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span id="course-description-title">课程简介</span>
              <span className="ml-2 font-normal text-muted-foreground">选填</span>
            </summary>
            <div className="border-t px-4 py-3">
              <MarkdownEditor name="content" value={course.content || ''} minHeight={160} />
            </div>
          </details>
          <h2 id="chapter-editor-title" className="sr-only">
            章节内容
          </h2>
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {editingSection ? (
                  <>
                    <button
                      type="button"
                      onClick={() => selectChapter(activeChapter._id)}
                      className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      第 {activeIndex + 1} 章
                    </button>
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
                <input
                  value={editingSection ? editingSection.title : activeChapter.title}
                  onChange={(event) =>
                    editingSection
                      ? updateSection(activeChapter._id, editingSection._id, { title: event.target.value })
                      : updateChapter(activeChapter._id, { title: event.target.value })
                  }
                  required
                  placeholder={editingSection ? '小节标题' : '章节标题'}
                  className={cn(
                    'w-full rounded-md border-0 bg-transparent px-0 text-2xl font-semibold tracking-tight',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'placeholder:text-muted-foreground/45',
                  )}
                />
              </label>
            </CardContent>
          </Card>

          <Tabs value={chapterTab} onValueChange={setChapterTab} className="space-y-4">
            <TabsList className={cn('grid h-10 w-full', editingSection ? 'grid-cols-3' : 'grid-cols-4')}>
              <TabsTrigger value="video" className="gap-1.5">
                <Video className="size-3.5" strokeWidth={1.75} />
                视频
                {videoCount ? <span className="tabular-nums text-muted-foreground">{videoCount}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="notes">讲义</TabsTrigger>
              <TabsTrigger value="problems">
                题目
                {unitPids.length ? <span className="tabular-nums text-muted-foreground">{unitPids.length}</span> : null}
              </TabsTrigger>
              {editingSection ? null : (
                <TabsTrigger value="links" className="gap-1.5">
                  <Link2 className="size-3.5" strokeWidth={1.75} />
                  关联
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="video" className="space-y-3">
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
            </TabsContent>

            <TabsContent value="notes">
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
            </TabsContent>

            <TabsContent value="problems">
              <ProblemPicker
                value={unitPids}
                onChange={(pids) =>
                  editingSection
                    ? updateSectionPids(activeChapter._id, editingSection._id, pids)
                    : updateChapterPids(activeChapter._id, pids)
                }
              />
            </TabsContent>

            {editingSection ? null : (
              <TabsContent value="links">
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
              </TabsContent>
            )}
          </Tabs>
        </section>

        {/* Settings rail. Four titled groups instead of one long undivided
            stack, so course identity, mindmap, audience and files stop
            reading as a single anonymous column of labels. */}
        <aside className="space-y-4 self-start lg:col-span-2 xl:col-span-1 xl:sticky xl:top-20">
          <SettingsGroup title="课程" icon={Layers}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">名称</span>
              <Input name="title" defaultValue={course.title || ''} required className="min-h-11 text-base sm:text-sm" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">学期</span>
              <Input name="term" defaultValue={course.term || ''} className="min-h-11 text-base sm:text-sm" placeholder="2026 秋" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">看完截止</span>
              <Input
                type="datetime-local"
                name="courseVideoDueAt"
                defaultValue={dueAtInputValue(course.courseVideoDueAt)}
                className="min-h-11 text-base sm:text-sm"
              />
            </label>
          </SettingsGroup>

          <SettingsGroup id="course-mindmap-settings" title="知识导图" icon={Network} collapsible>
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
              className="min-h-11"
              contentClassName="[&_[role=option]]:min-h-10"
            />
          </SettingsGroup>

          <SettingsGroup title="可见班级" icon={Users}>
            <MultiSelect<(typeof activeGroups)[number]>
              options={activeGroups}
              value={activeGroups.filter((group) => selectedGroups.has(group._id))}
              onChange={(next) => {
                setSelectedGroups(new Set(next.map((group) => group._id)));
                markDirty();
              }}
              getKey={(group) => group._id}
              getLabel={(group) => (group.archivedAt ? `${group.name}（已归档）` : group.name)}
              name="courseGroupIds"
              placeholder="搜索班级"
              emptyText="没有匹配的班级"
              minHeight={44}
            />
            <p className="text-xs text-muted-foreground">
              {selectedGroups.size ? `已选 ${selectedGroups.size} 个班级` : '未选班级时，课程对全站可见。'}
            </p>
          </SettingsGroup>

          {isEdit && tid ? (
            <SettingsGroup id="course-integrity-settings" title="真实性训练" icon={Shield} collapsible>
              <PracticeIntegrityPolicyPanel containerKind="course" containerId={tid} />
            </SettingsGroup>
          ) : null}

          <SettingsGroup id="course-files-editor" title="课件下载" icon={FileText} collapsible>
            <div data-course-slot="files" className="space-y-3">
              {fileError ? (
                <p role="alert" className="text-xs text-destructive">
                  {fileError}
                </p>
              ) : null}
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
                <p className="text-sm text-muted-foreground">先保存课程，再上传课件。</p>
              ) : null}
              {courseFiles.length ? (
                <div className="space-y-0.5">
                  {courseFiles.map((file) => (
                    <div key={file.name} className="krypton-course-row flex min-h-11 items-center gap-2 px-2 py-1.5 text-xs">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                      <a
                        href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                        className={cn(
                          'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground',
                          'transition-colors duration-150 hover:bg-muted hover:text-foreground',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
                        )}
                        aria-label={`下载${file.name}`}
                      >
                        <Download className="size-3.5" strokeWidth={1.75} />
                      </a>
                      {data.canManageFiles ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 text-destructive hover:bg-destructive/10"
                          onClick={() => deleteFile(file.name)}
                          aria-label={`删除${file.name}`}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.75} />
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
        </aside>
      </form>

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-[23rem] max-w-[calc(100vw-1rem)]">
          <SheetHeader className="flex items-center justify-between gap-2 pr-12">
            <SheetTitle>章节目录</SheetTitle>
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={addChapter}>
              <Plus className="size-3.5" strokeWidth={2} />
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
    </main>
  );
}
