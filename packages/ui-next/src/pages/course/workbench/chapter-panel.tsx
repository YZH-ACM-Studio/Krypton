import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { teachPath, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { GripVertical, Layers, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { FileUploader } from '@/components/uploader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { getJson, postForm } from '@/pages/teach/api';
import { CoursewareList } from '../course-file-row';
import type { ChapterDraft, CourseAuthorVideo, CourseFile, SectionDraft } from '../types';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { fetchProblemsByIds } from '@/lib/multi-select-presets';
import { CourseVideoEditor } from '../video-editor';

const CONTENT_DESCRIPTION = '学生按这个顺序看到。组内可以拖动调整。';
const EMPTY_TITLE = '这一章还没有内容';
const EMPTY_DESCRIPTION = '点「添加内容」加视频、题目或题目集。';
const GROUP_CLASS = 'text-xs font-medium text-fg-subtle px-4 pt-3';
const ROW_CLASS = 'flex min-h-11 min-w-0 items-center gap-2 px-4 py-2';

type ActivityType = Exclude<TeachType, 'practice'>;

interface LoadedActivity {
  id: string;
  title: string;
  type: TeachType | null;
}

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  homework: '作业',
  exam: '考试',
  acm: '比赛',
  oi: '比赛',
};

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${seconds}秒`;
}

function parseRefs(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

interface ProblemFace {
  label: string;
  title: string;
}

interface ProblemSetFace {
  title: string;
  positions: Map<string, number> | null;
}

/** 1-based position in `tdoc.dag`. Missing or unmatched ids produce no note, never the raw `_id`. */
function parseStagePositions(value: unknown): Map<string, number> | null {
  if (!Array.isArray(value)) return null;
  const positions = new Map<string, number>();
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const raw = item._id;
    const key = typeof raw === 'number' && Number.isSafeInteger(raw)
      ? String(raw)
      : typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : '';
    if (!key || positions.has(key)) return;
    positions.set(key, index + 1);
  });
  return positions;
}

function stageSummary(stageIds: string | undefined, positions: Map<string, number> | null): string {
  const ids = parseRefs(stageIds);
  if (ids.length === 0) return '整个题目集';
  if (!positions) return '';
  const ordinals: number[] = [];
  for (const id of ids) {
    const position = positions.get(id);
    if (position == null) return '';
    ordinals.push(position);
  }
  const sorted = [...new Set(ordinals)].sort((left, right) => left - right);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first == null || last == null) return '';
  if (sorted.length === 1) return `阶段 ${first}`;
  const contiguous = sorted.every((value, index) => {
    if (index === 0) return true;
    const previous = sorted[index - 1];
    return previous != null && value === previous + 1;
  });
  if (contiguous) return `阶段 ${first}\u2013${last}`;
  return `阶段 ${sorted.join('\u3001')}`;
}

function readProblemFace(storedId: string, row: unknown): ProblemFace | null {
  if (!isRecord(row) || typeof row.title !== 'string') return null;
  const title = row.title.trim();
  if (!title) return null;
  const rawPid = row.pid;
  const label = typeof rawPid === 'string' && rawPid.trim()
    ? rawPid.trim()
    : typeof rawPid === 'number' && Number.isFinite(rawPid)
      ? String(rawPid)
      : storedId;
  return { label, title };
}

function activityRows(ids: readonly string[], loaded: readonly LoadedActivity[]): LoadedActivity[] {
  const byId = new Map(loaded.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id) ?? { id, title: id, type: null });
}

function activityLabel(type: TeachType): string {
  if (type === 'practice') return '练习';
  return ACTIVITY_LABEL[type];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label}响应格式不正确`);
  return value;
}

function asTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Homework and contest documents share ids; try homework first, same as the old chapter picker. */
async function loadDocument(path: string, fallback: string): Promise<Record<string, unknown> | null> {
  const response = await fetchHydroResponse(
    path,
    { credentials: 'same-origin', headers: { Accept: 'application/json' } },
    fallback,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  const body: unknown = await response.json();
  return asRecord(body, fallback);
}

async function loadProblemSet(id: string): Promise<ProblemSetFace> {
  const payload = await loadDocument(`/training/${encodeURIComponent(id)}`, '加载题集失败');
  if (!payload) throw new Error(`题集 ${id} 不存在`);
  const tdoc = asRecord(payload.tdoc, '题集');
  return { title: asTitle(tdoc.title, id), positions: parseStagePositions(tdoc.dag) };
}

async function loadActivity(id: string): Promise<LoadedActivity> {
  try {
    const homework = await loadDocument(`/homework/${encodeURIComponent(id)}`, '加载作业失败');
    const payload = homework ?? (await loadDocument(`/contest/${encodeURIComponent(id)}`, '加载比赛失败'));
    if (!payload) {
      console.error(new Error(`题目集 ${id} 不存在`));
      return { id, title: id, type: null };
    }
    const tdoc = asRecord(payload.tdoc, '题目集');
    const title = asTitle(tdoc.title, id);
    try {
      return { id, title, type: teachTypeOfContestRule(tdoc.rule) };
    } catch (error) {
      console.error(error);
      return { id, title, type: null };
    }
  } catch (error) {
    console.error(error);
    return { id, title: id, type: null };
  }
}

function useSortSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function reorderIds(ids: readonly string[], event: DragEndEvent): string[] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const oldIndex = ids.indexOf(String(active.id));
  const newIndex = ids.indexOf(String(over.id));
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;
  return arrayMove([...ids], oldIndex, newIndex);
}

function GroupHeading({ children }: { children: string }) {
  return <p className={GROUP_CLASS}>{children}</p>;
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" iconOnly className="shrink-0" aria-label={label} onClick={onRemove}>
      <X />
    </Button>
  );
}

function WorkbenchLink({ href }: { href: string }) {
  return (
    <Button asChild variant="link" size="sm" className="shrink-0">
      <a href={href}>打开工作台</a>
    </Button>
  );
}

function SortableRows({
  ids,
  onReorder,
  children,
}: {
  ids: readonly string[];
  onReorder: (next: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSortSensors();
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const next = reorderIds(ids, event);
        if (next) onReorder(next);
      }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-line-subtle">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

function VideoGroup({ videos, onOpen }: { videos: readonly CourseAuthorVideo[]; onOpen: () => void }) {
  return (
    <div>
      <GroupHeading>视频</GroupHeading>
      <div className="divide-y divide-line-subtle">
        {videos.map((video) => (
          <Button
            key={video.id}
            type="button"
            variant="ghost"
            onClick={onOpen}
            className="h-auto! min-h-11 w-full min-w-0 justify-start gap-3 whitespace-normal rounded-none px-4 py-2.5 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{video.title}</span>
            <span className="shrink-0 text-xs tabular text-fg-subtle">{durationLabel(video.durationMs)}</span>
            {video.confirmed ? (
              <Badge tone="success" size="sm">
                已确认片长
              </Badge>
            ) : (
              <Badge size="sm">待确认</Badge>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ProblemRow({
  storedId,
  label,
  title,
  onRemove,
}: {
  storedId: string;
  label: string;
  title: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: storedId });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={ROW_CLASS}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className="touch-none"
        aria-label="拖动排序"
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{label}</span>
      {title ? <span className="min-w-0 flex-1 truncate text-sm text-fg">{title}</span> : <span className="min-w-0 flex-1" />}
      <RemoveButton label={`移出 ${label}`} onRemove={onRemove} />
    </div>
  );
}

function ProblemGroup({
  pids,
  faces,
  onReorder,
  onRemove,
}: {
  pids: readonly string[];
  faces: ReadonlyMap<string, ProblemFace>;
  onReorder: (next: string[]) => void;
  onRemove: (pid: string) => void;
}) {
  return (
    <div>
      <GroupHeading>题目</GroupHeading>
      <SortableRows ids={pids} onReorder={onReorder}>
        {pids.map((pid) => {
          const face = faces.get(pid);
          return (
            <ProblemRow
              key={pid}
              storedId={pid}
              label={face?.label ?? pid}
              title={face?.title ?? ''}
              onRemove={() => onRemove(pid)}
            />
          );
        })}
      </SortableRows>
    </div>
  );
}

function ActivityRow({
  id,
  title,
  type,
  onRemove,
}: {
  id: string;
  title: string;
  type: TeachType | null;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const label = type ? `${activityLabel(type)} · ${title}` : title;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={ROW_CLASS}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className="touch-none"
        aria-label="拖动排序"
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{label}</span>
      {type ? <WorkbenchLink href={teachPath(type, id)} /> : null}
      <RemoveButton label={`移出 ${title}`} onRemove={onRemove} />
    </div>
  );
}

function ReferenceGroup({
  setId,
  setTitle,
  stageNote,
  activities,
  onClearSet,
  onReorder,
  onRemoveActivity,
}: {
  setId: string;
  setTitle: string;
  stageNote: string;
  activities: readonly LoadedActivity[];
  onClearSet: () => void;
  onReorder: (next: string[]) => void;
  onRemoveActivity: (id: string) => void;
}) {
  return (
    <div>
      <GroupHeading>题目集与作业</GroupHeading>
      {setId ? (
        <div className={ROW_CLASS}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-active text-fg-subtle">
            <Layers className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{`练习 · ${setTitle || setId}`}</p>
            {stageNote ? <p className="truncate text-xs text-fg-subtle">{stageNote}</p> : null}
          </div>
          <WorkbenchLink href={teachPath('practice', setId)} />
          <RemoveButton label={`移出 ${setTitle || setId}`} onRemove={onClearSet} />
        </div>
      ) : null}
      {activities.length ? (
        <SortableRows ids={activities.map((item) => item.id)} onReorder={onReorder}>
          {activities.map((item) => (
            <ActivityRow
              key={item.id}
              id={item.id}
              title={item.title}
              type={item.type}
              onRemove={() => onRemoveActivity(item.id)}
            />
          ))}
        </SortableRows>
      ) : null}
    </div>
  );
}

function readChapterFiles(value: unknown): CourseFile[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('课件列表响应格式错误');
  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files)) throw new TypeError('课件列表响应格式错误');
  return files.map((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) throw new TypeError('课件列表响应格式错误');
    const name = (file as { name?: unknown }).name;
    if (typeof name !== 'string' || name === '') throw new TypeError('课件列表响应格式错误');
    const size = (file as { size?: unknown }).size;
    if (size !== undefined && typeof size !== 'number') throw new TypeError('课件列表响应格式错误');
    return { name, ...(typeof size === 'number' ? { size } : {}) };
  });
}

function ChapterFilePanel({
  courseId,
  saved,
  dirty,
  chapterId,
  files,
  onChange,
  error,
  onError,
}: {
  courseId: string;
  saved: boolean;
  dirty: boolean;
  chapterId: number;
  files: CourseFile[];
  onChange: (files: CourseFile[]) => void;
  error: string;
  onError: (message: string) => void;
}) {
  const endpoint = saved && courseId ? `/course/${courseId}/chapter/${chapterId}/file` : '';
  const ready = Boolean(endpoint) && !dirty;
  const chapterIdRef = useRef(chapterId);
  chapterIdRef.current = chapterId;

  const refresh = async () => {
    if (!endpoint) return;
    const requested = chapterId;
    const nextFiles = readChapterFiles(await getJson(endpoint, '课件列表刷新失败'));
    if (chapterIdRef.current !== requested) return;
    onChange(nextFiles);
  };

  const remove = async (filename: string) => {
    if (!endpoint) return;
    const accepted = await confirmDialog('删除后不能恢复。', {
      title: `删除课件「${filename}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    onError('');
    const body = new URLSearchParams({ operation: 'delete_files' });
    body.append('files', filename);
    try {
      await postForm(endpoint, body, '课件删除失败');
      onChange(files.filter((file) => file.name !== filename));
    } catch (cause) {
      console.error(cause);
      onError(cause instanceof Error && cause.message ? cause.message : '课件删除失败');
    }
  };

  return (
    <Panel title="本章课件" description="学生打开这一章时能看到。pptx 可以预览。">
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {ready ? (
          <FileUploader
            key={chapterId}
            endpoint={endpoint}
            maxFiles={10}
            uploadConcurrency={1}
            onBatchComplete={() => {
              void refresh().catch((cause: unknown) => {
                console.error(cause);
                onError(cause instanceof Error && cause.message ? cause.message : '课件列表刷新失败');
              });
            }}
          />
        ) : (
          <p className="text-sm text-fg-muted">先保存课程，再给这一章上传课件。</p>
        )}
        {files.length ? (
          <CoursewareList
            titleId={`chapter-${chapterId}-files`}
            title="本章课件"
            courseId={courseId}
            chapterId={chapterId}
            files={files}
            extra={(file) => (
              <Button
                type="button"
                variant="danger-soft"
                size="sm"
                aria-label={`删除${file.name}`}
                onClick={() => {
                  void remove(file.name);
                }}
              >
                <Trash2 aria-hidden="true" />
                删除
              </Button>
            )}
          />
        ) : null}
      </div>
    </Panel>
  );
}

export function ChapterPanel({
  courseId,
  saved,
  dirty,
  chapter,
  section,
  onChange,
  addContent,
}: {
  courseId: string;
  saved: boolean;
  dirty: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  onChange: (next: ChapterDraft) => void;
  addContent: ReactNode;
}): JSX.Element {
  const titleId = useId();
  const unitKey = section ? `${chapter._id}/${section._id}` : String(chapter._id);
  const chapterRef = useRef(chapter);
  const sectionRef = useRef(section);
  const onChangeRef = useRef(onChange);
  const unitKeyRef = useRef(unitKey);
  chapterRef.current = chapter;
  sectionRef.current = section;
  onChangeRef.current = onChange;
  unitKeyRef.current = unitKey;
  const [videoOpen, setVideoOpen] = useState(false);
  const [chapterFiles, setChapterFiles] = useState<CourseFile[]>(chapter.files || []);
  const [fileError, setFileError] = useState('');
  const fileKey = `${chapter._id}:${(chapter.files || []).map((file) => file.name).join('\0')}`;
  const [shownFileKey, setShownFileKey] = useState(fileKey);
  if (shownFileKey !== fileKey) {
    setShownFileKey(fileKey);
    setChapterFiles(chapter.files || []);
  }
  const [videoUnit, setVideoUnit] = useState(unitKey);
  if (videoUnit !== unitKey) {
    setVideoUnit(unitKey);
    setVideoOpen(false);
  }

  const title = section ? section.title : chapter.title;
  const content = section ? section.content : chapter.content;
  const pids = section ? section.pids : chapter.pids;
  const videos = section ? section.videos : chapter.videos;
  const setId = section ? '' : (chapter.problemSetId ?? '').trim();
  const tidKey = section ? '' : chapter.tids;
  const tidIds = section ? [] : parseRefs(chapter.tids);
  const pidKey = pids.join('\0');

  const [faces, setFaces] = useState<Map<string, ProblemFace>>(() => new Map());
  const [loadedSet, setLoadedSet] = useState<{ id: string; title: string; positions: Map<string, number> | null } | null>(null);
  const [activities, setActivities] = useState<LoadedActivity[]>([]);
  const setTitle = loadedSet?.id === setId ? loadedSet.title : '';
  const stagePositions = loadedSet?.id === setId ? loadedSet.positions : null;

  useEffect(() => {
    const requested = pidKey.split('\0');
    if (!pidKey) {
      setFaces(new Map());
      return undefined;
    }
    let cancelled = false;
    void fetchProblemsByIds(requested)
      .then((rows) => {
        if (cancelled) return;
        const next = new Map<string, ProblemFace>();
        requested.forEach((storedId, index) => {
          const face = readProblemFace(storedId, rows[index]);
          if (face) next.set(storedId, face);
        });
        setFaces(next);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFaces(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [pidKey]);

  useEffect(() => {
    const ids = parseRefs(tidKey);
    if (!setId && ids.length === 0) {
      setLoadedSet(null);
      setActivities([]);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const [nextSet, nextActivities] = await Promise.all([
        setId
          ? loadProblemSet(setId).catch((error: unknown) => {
              console.error(error);
              return { title: setId, positions: null } satisfies ProblemSetFace;
            })
          : Promise.resolve(null),
        Promise.all(ids.map((id) => loadActivity(id))),
      ]);
      if (cancelled) return;
      setLoadedSet(setId && nextSet ? { id: setId, title: nextSet.title, positions: nextSet.positions } : null);
      setActivities(nextActivities);
    })();
    return () => {
      cancelled = true;
    };
  }, [setId, tidKey]);

  const updateUnit = (patch: Partial<Pick<SectionDraft, 'title' | 'content' | 'pids' | 'videos'>>) => {
    if (!section) {
      onChange({ ...chapter, ...patch });
      return;
    }
    const sectionId = section._id;
    onChange({
      ...chapter,
      sections: chapter.sections.map((item) => (item._id === sectionId ? { ...item, ...patch } : item)),
    });
  };

  const contentTitle = section ? '本节内容' : '本章内容';
  const hasReferences = setId !== '' || tidIds.length > 0;
  const empty = videos.length === 0 && pids.length === 0 && !hasReferences;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Panel>
        <div className="flex flex-col gap-4">
          <FormField label={section ? '小节标题' : '章节标题'} htmlFor={titleId}>
            <Input id={titleId} value={title} onChange={(event) => updateUnit({ title: event.target.value })} />
          </FormField>
          <FormField label="讲义" optional hint="Markdown">
            <MarkdownEditor
              key={unitKey}
              value={content}
              minHeight={160}
              onChange={(next) => updateUnit({ content: next })}
            />
          </FormField>
        </div>
      </Panel>

      <Panel flush title={contentTitle} description={CONTENT_DESCRIPTION} actions={addContent}>
        {empty ? (
          <EmptyState compact title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />
        ) : (
          <div className="pb-2">
            {videos.length ? <VideoGroup videos={videos} onOpen={() => setVideoOpen(true)} /> : null}
            {pids.length ? (
              <ProblemGroup
                pids={pids}
                faces={faces}
                onReorder={(next) => updateUnit({ pids: next })}
                onRemove={(pid) => updateUnit({ pids: pids.filter((item) => item !== pid) })}
              />
            ) : null}
            {hasReferences ? (
              <ReferenceGroup
                setId={setId}
                setTitle={setTitle}
                stageNote={stageSummary(chapter.stageIds, stagePositions)}
                activities={activityRows(tidIds, activities)}
                onClearSet={() => onChange({ ...chapter, problemSetId: '', stageIds: '' })}
                onReorder={(next) => onChange({ ...chapter, tids: next.join(',') })}
                onRemoveActivity={(id) => onChange({ ...chapter, tids: tidIds.filter((item) => item !== id).join(',') })}
              />
            ) : null}
          </div>
        )}
      </Panel>

      {section ? null : (
        <ChapterFilePanel
          courseId={courseId}
          saved={saved}
          dirty={dirty}
          chapterId={chapter._id}
          files={chapterFiles}
          onChange={(files) => {
            setChapterFiles(files);
            onChange({ ...chapter, files });
          }}
          error={fileError}
          onError={setFileError}
        />
      )}

      <Sheet open={videoOpen} onOpenChange={setVideoOpen}>
        <SheetContent side="right" className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>本章视频</SheetTitle>
          </SheetHeader>
          <SheetBody className="px-5 py-4" viewportLayout="block" viewportClassName="[&>div]:min-w-0 [&>div]:w-full">
            <CourseVideoEditor
              key={unitKey}
              courseId={courseId}
              chapterId={chapter._id}
              sectionId={section ? section._id : null}
              videos={videos}
              onChange={(next) => {
                // FileUploader keeps the first onChange. Read the latest draft from refs, and
                // ignore the result if the teacher has moved to another chapter or section.
                if (unitKeyRef.current !== unitKey) return;
                const latestChapter = chapterRef.current;
                const latestSection = sectionRef.current;
                const emit = onChangeRef.current;
                if (latestSection == null) {
                  emit({ ...latestChapter, videos: next });
                  return;
                }
                const sectionId = latestSection._id;
                emit({
                  ...latestChapter,
                  sections: latestChapter.sections.map((item) => (item._id === sectionId ? { ...item, videos: next } : item)),
                });
              }}
              locked={!saved}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
