import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ClipboardPlus,
  Download,
  ExternalLink,
  FileText,
  Layers,
  ListTree,
  Loader2,
  Network,
  Plus,
  Save,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FileUploader } from '@/components/uploader';
import type { DomainUserOption } from '@/components/domain-user-search';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { CourseAssignForm } from './assign';
import { claimChapterProblemIds } from './chapter-draft';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import type { ChapterDraft, CourseFile, CourseRecord, SectionDraft } from './types';
import { CourseMark, CourseSectionHeader } from './ui';

type SaveState = 'idle' | 'dirty' | 'saving';

function initialChapterDrafts(serialized?: string): ChapterDraft[] {
  if (!serialized) return [];
  const parsed = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid course chapter payload');
  return parsed.map((chapter) => ({
    _id: Number(chapter._id),
    title: String(chapter.title || ''),
    content: String(chapter.content || ''),
    pids: Array.isArray(chapter.pids) ? chapter.pids.map(String) : [],
    sections: Array.isArray(chapter.sections)
      ? chapter.sections.map((section: SectionDraft) => ({
          _id: Number(section._id),
          title: String(section.title || ''),
          content: String(section.content || ''),
          pids: Array.isArray(section.pids) ? section.pids.map(String) : [],
        }))
      : [],
    tids: Array.isArray(chapter.tids) ? chapter.tids.map(String).join(',') : '',
    problemSetId: chapter.problemSetId ? String(chapter.problemSetId) : '',
    stageIds: Array.isArray(chapter.stageIds) ? chapter.stageIds.map(String).join(',') : '',
  }));
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
}: {
  title: string;
  description?: string;
  icon: typeof Layers;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('krypton-course-panel scroll-mt-24 p-4', className)}>
      <div className="mb-3.5 flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-px grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-[13px] font-semibold leading-5">
            {title}
          </h2>
          {description ? <p className="krypton-course-meta mt-0.5 text-pretty">{description}</p> : null}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Referenced contests and homework.
 *
 * The previous editor asked authors to hand-maintain a comma-joined string
 * of ObjectIds in a monospace box, so a single stray comma silently broke
 * the whole chapter. Ids become removable chips here while the submitted
 * value stays the exact same comma-joined string the handler parses.
 */
function ContestRefInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [draft, setDraft] = useState('');
  const refs = parseRefs(value);

  const commit = () => {
    const additions = parseRefs(draft).filter((item) => !refs.includes(item));
    if (additions.length) onChange([...refs, ...additions].join(','));
    setDraft('');
  };

  return (
    <div className="space-y-2">
      {refs.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {refs.map((ref) => (
            <li key={ref}>
              <span className="krypton-course-inset inline-flex min-h-9 items-center gap-1.5 py-1 pl-2.5 pr-1">
                <Trophy className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="font-mono text-[11px]">{ref}</span>
                <button
                  type="button"
                  onClick={() => onChange(refs.filter((item) => item !== ref).join(','))}
                  aria-label={`移除引用 ${ref}`}
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground',
                    'transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
                  )}
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          }}
          className="min-h-11 font-mono text-base sm:text-xs"
          placeholder="粘贴比赛 id 后回车"
          aria-label="添加比赛或作业引用"
        />
        <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={commit} aria-label="添加引用">
          <Plus className="size-4" strokeWidth={2} />
        </Button>
      </div>
      <a
        href="/contest/create"
        target="_blank"
        rel="noreferrer"
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium text-primary',
          'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        )}
      >
        前往比赛模块创建
        <ExternalLink className="size-3" strokeWidth={1.75} />
      </a>
    </div>
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
      : [{ _id: 1, title: '第一章', content: '', pids: [], sections: [], tids: '', problemSetId: '', stageIds: '' }],
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set((course.courseGroupIds || []).map(String)));
  const [selectedMindmapId, setSelectedMindmapId] = useState(String(course.mindmapId || ''));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [courseFiles, setCourseFiles] = useState<CourseFile[]>(data.files || []);
  const [fileError, setFileError] = useState('');
  const { activeId, activeSectionId, selectChapter, selectSection } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];

  useEffect(() => {
    if (saveState !== 'dirty') return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

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
    setChapters((current) =>
      current.map((chapter) => {
        if (chapter._id !== chapterId) return chapter;
        const sectionId = Math.max(0, ...chapter.sections.map((section) => section._id)) + 1;
        return {
          ...chapter,
          sections: [...chapter.sections, { _id: sectionId, title: `第 ${chapter.sections.length + 1} 节`, content: '', pids: [] }],
        };
      }),
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
      ...(chapter.problemSetId.trim() ? { problemSetId: chapter.problemSetId.trim() } : {}),
      ...(parseRefs(chapter.stageIds).length ? { stageIds: parseRefs(chapter.stageIds).map(Number) } : {}),
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

  const selectFromMobile = (chapterId: number, sectionId?: number | null) => {
    if (sectionId == null) selectChapter(chapterId);
    else selectSection(chapterId, sectionId);
    setOutlineOpen(false);
  };

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
        <Button
          form="course-editor-form"
          type="submit"
          disabled={saveState === 'saving'}
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
        className="grid min-w-0 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_21rem] xl:gap-7"
      >
        {isEdit ? <input type="hidden" name="tid" value={tid} /> : null}
        <input type="hidden" name="chapters" value={chaptersJson} />
        <input type="hidden" name="courseGroupIds" value={Array.from(selectedGroups).join(',')} />
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
                  <p className="krypton-course-meta">{chapters.length} 章</p>
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
                onSelect={(chapterId, sectionId) => (sectionId == null ? selectChapter(chapterId) : selectSection(chapterId, sectionId))}
                onMove={moveChapter}
                onRemove={removeChapter}
              />
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-7" aria-labelledby="chapter-editor-title">
          <h2 id="chapter-editor-title" className="sr-only">
            章节内容
          </h2>
          {/* The chapter being edited is the subject of this screen, so its
              title is the only display-scale element and it is editable in
              place rather than sitting under a generic section heading. */}
          <div className="krypton-course-hero krypton-course-grain px-4 py-5 sm:px-6">
            <div className="relative z-10">
              <p className="krypton-course-eyebrow">
                第 {activeIndex + 1} 章 / 共 {chapters.length} 章
              </p>
              <label className="mt-2 block">
                <span id="active-chapter-title" className="sr-only">
                  章节标题
                </span>
                {/* Edited in place. A display-size field with no chrome is
                    invisible as a control, so it earns a surface on hover
                    and focus instead of a permanent input border. */}
                <input
                  value={activeChapter.title}
                  onChange={(event) => updateChapter(activeChapter._id, { title: event.target.value })}
                  required
                  placeholder="章节标题"
                  className={cn(
                    'krypton-course-display -mx-2 w-[calc(100%+1rem)] rounded-lg border-0 bg-transparent px-2 py-0.5',
                    'transition-colors duration-150 hover:bg-background/55 focus:bg-background/80',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    'placeholder:text-muted-foreground/45 motion-reduce:transition-none',
                  )}
                />
              </label>
              <p className="krypton-course-meta mt-1.5">标题会同时出现在目录、学生视图和小测预填里。</p>
            </div>
          </div>

          <section data-course-slot="chapterContent" className="space-y-3" aria-labelledby="chapter-content-title">
            <CourseSectionHeader id="chapter-content-title" title="章节讲义" description="支持 Markdown、代码块与图片。" />
            <MarkdownEditor
              key={activeChapter._id}
              value={activeChapter.content}
              onChange={(content) => updateChapter(activeChapter._id, { content })}
              minHeight={240}
            />
          </section>

          <section className="space-y-3" aria-labelledby="chapter-problems-title">
            <CourseSectionHeader
              id="chapter-problems-title"
              title="本章题目"
              description="不属于任何小节的题目，显示在章节开头。"
              count={activeChapter.pids.length}
            />
            <ProblemPicker value={activeChapter.pids} onChange={(pids) => updateChapterPids(activeChapter._id, pids)} />
          </section>

          <section className="space-y-3" aria-labelledby="chapter-sections-title">
            <div className="flex items-end justify-between gap-3">
              <CourseSectionHeader
                id="chapter-sections-title"
                title="小节"
                description="每一章可以再拆成线性小节，讲义和题目挂在小节里。"
                count={activeChapter.sections.length}
              />
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => addSection(activeChapter._id)}>
                <Plus className="size-3.5" strokeWidth={2} />
                添加小节
              </Button>
            </div>
            {activeChapter.sections.length ? (
              <div className="space-y-4">
                {activeChapter.sections.map((section, sectionIndex) => (
                  <article
                    key={section._id}
                    className={cn(
                      'krypton-course-panel space-y-3 p-4',
                      activeSectionId === section._id ? 'ring-2 ring-primary/40' : '',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="krypton-course-meta shrink-0 tabular-nums">
                        {activeIndex + 1}.{sectionIndex + 1}
                      </span>
                      <Input
                        value={section.title}
                        onChange={(event) => updateSection(activeChapter._id, section._id, { title: event.target.value })}
                        required
                        placeholder="小节标题"
                        className="min-h-10 min-w-40 flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={sectionIndex === 0}
                        onClick={() => moveSection(activeChapter._id, section._id, -1)}
                        aria-label={`上移${section.title}`}
                      >
                        <ArrowUp className="size-3.5" strokeWidth={1.75} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={sectionIndex === activeChapter.sections.length - 1}
                        onClick={() => moveSection(activeChapter._id, section._id, 1)}
                        aria-label={`下移${section.title}`}
                      >
                        <ArrowDown className="size-3.5" strokeWidth={1.75} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        onClick={() => removeSection(activeChapter._id, section._id)}
                        aria-label={`删除${section.title}`}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </Button>
                    </div>
                    <MarkdownEditor
                      key={`${activeChapter._id}-${section._id}`}
                      value={section.content}
                      onChange={(content) => updateSection(activeChapter._id, section._id, { content })}
                      minHeight={160}
                    />
                    <ProblemPicker
                      value={section.pids}
                      onChange={(pids) => updateSectionPids(activeChapter._id, section._id, pids)}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="krypton-course-meta">还没有小节。学生会只看到这一章的讲义和题目。</p>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="chapter-contests-title">
            <CourseSectionHeader
              id="chapter-contests-title"
              title="引用比赛或作业"
              description="引用已创建的比赛或作业，学生在本章直接进入。"
              count={parseRefs(activeChapter.tids).length}
            />
            <ContestRefInput value={activeChapter.tids} onChange={(tids) => updateChapter(activeChapter._id, { tids })} />
          </section>

          <section className="space-y-3" aria-labelledby="chapter-problem-set-title">
            <CourseSectionHeader
              id="chapter-problem-set-title"
              title="引用题集"
              description="实时引用题集成员，不复制题目。留空阶段表示整集，填写阶段 ID 则只引用这些阶段。"
            />
            <label className="space-y-1 text-sm">
              题集 ID
              <Input
                value={activeChapter.problemSetId}
                onChange={(event) => updateChapter(activeChapter._id, { problemSetId: event.target.value })}
                placeholder="可选"
              />
            </label>
            <label className="space-y-1 text-sm">
              阶段 ID
              <Input
                value={activeChapter.stageIds}
                onChange={(event) => updateChapter(activeChapter._id, { stageIds: event.target.value })}
                placeholder="逗号分隔，可空"
              />
            </label>
          </section>

          <section data-course-slot="quiz" className="krypton-course-inset px-4 py-3.5">
            {isEdit && data.canCreateQuiz && saveState === 'idle' ? (
              <Button asChild type="button" variant="outline" className="min-h-11 gap-1.5">
                <a href={`/homework/create?fromCourse=${encodeURIComponent(tid)}&chapter=${activeChapter._id}`}>
                  <ClipboardPlus className="size-4" strokeWidth={1.75} />
                  为本章建小测
                </a>
              </Button>
            ) : isEdit && data.canCreateQuiz ? (
              <div className="space-y-1.5">
                <Button type="button" variant="outline" className="min-h-11 gap-1.5" disabled>
                  <ClipboardPlus className="size-4" strokeWidth={1.75} />
                  为本章建小测
                </Button>
                <p className="krypton-course-meta">请先保存课程修改，再按最新标题与班级范围创建小测。</p>
              </div>
            ) : !isEdit ? (
              <p className="krypton-course-meta">保存课程后即可创建并自动挂载章节小测。</p>
            ) : null}
          </section>
        </section>

        {/* Settings rail. Four titled groups instead of one long undivided
            stack, so course identity, mindmap, audience and files stop
            reading as a single anonymous column of labels. */}
        <aside className="space-y-4 self-start lg:col-span-2 xl:col-span-1 xl:sticky xl:top-20">
          <SettingsGroup title="课程身份" description="显示在课程列表与详情页顶部。" icon={Layers}>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">课程名称</span>
              <Input name="title" defaultValue={course.title || ''} required className="min-h-11 text-base sm:text-sm" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">学期</span>
              <Input name="term" defaultValue={course.term || ''} className="min-h-11 text-base sm:text-sm" placeholder="2026 秋" />
            </label>
            <p className="krypton-course-meta">课程简介在页面底部整幅编辑。</p>
          </SettingsGroup>

          <SettingsGroup
            id="course-mindmap-settings"
            title="知识导图"
            description="仅用于课程知识导图视图；章节仍可包含其它导图或尚未归类的题目。"
            icon={Network}
          >
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

          <SettingsGroup title="可见班级" description="不选择时对全域用户开放。" icon={Users}>
            <ScrollArea className="krypton-course-inset max-h-52">
              <div className="space-y-0.5 p-1.5">
                {activeGroups.length ? (
                  activeGroups.map((group) => (
                    <label
                      key={group._id}
                      className={cn(
                        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-xs',
                        'transition-colors duration-150 hover:bg-background/70 motion-reduce:transition-none',
                      )}
                    >
                      <Checkbox
                        checked={selectedGroups.has(group._id)}
                        onChange={() => {
                          setSelectedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group._id)) next.delete(group._id);
                            else next.add(group._id);
                            return next;
                          });
                          markDirty();
                        }}
                      />
                      <span className="min-w-0 truncate">
                        {group.name}
                        {group.archivedAt ? '（已归档）' : ''}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="krypton-course-meta px-2 py-3 text-pretty">还没有班级。不选择时课程对全域开放。</p>
                )}
              </div>
            </ScrollArea>
            {selectedGroups.size ? <p className="krypton-course-meta">已选 {selectedGroups.size} 个班级</p> : null}
          </SettingsGroup>

          <SettingsGroup id="course-files-editor" title="课程课件" description="学生按课程班级范围下载。" icon={FileText}>
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
                <p className="krypton-course-meta">先保存课程，再上传课件。</p>
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
              <SettingsGroup
                id="course-assign"
                title="课程分配"
                description="管理员可以把课程转给教师，并指定协作教师。负责人和协作教师都可以编辑内容并管理课件。"
                icon={Users}
              >
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

        {/* Long-form course copy spans the full grid. The side-by-side
            markdown editor wraps to about ten characters per line inside a
            21rem rail, which made the field unusable at any height. */}
        <section aria-labelledby="course-description-title" className="col-span-full min-w-0 space-y-3">
          <CourseSectionHeader
            id="course-description-title"
            level={2}
            title="课程简介"
            description="课程级说明，显示在课程列表摘要与详情页顶部。支持 Markdown。"
          />
          <MarkdownEditor name="content" value={course.content || ''} minHeight={260} />
        </section>
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
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}
