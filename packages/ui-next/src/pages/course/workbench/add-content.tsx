import type { BasicObjectiveKind } from '@hydrooj/common';
import { DndContext } from '@dnd-kit/core';
import {
  ChevronDown,
  FolderUp,
  Layers,
  ListChecks,
  Plus,
  Video,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { alertDialog, confirmDialog, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Popover } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { MultiSelect } from '@/components/ui/multi-select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import type { ChapterDraft, CourseAuthorVideo, SectionDraft } from '../types';
import { CourseVideoEditor } from '../video-editor';
import { getJson } from '../../teach/api';
import { BankPane } from '../../teach/compose/bank-pane';
import { ObjectiveSheet } from '../../teach/compose/objective-sheet';
import {
  parseTeachCopySource,
  parseTeachListPayload,
  TEACH_TYPE_LABEL,
  type TeachBankItem,
  type TeachCopySource,
  type TeachListPayload,
  type TeachListRow,
} from '../../teach/model';
import { DEFAULT_KIND_SCORE, type PaperItem } from '../../teach/paper';

const LIST_FAILED = '题目集列表加载失败';
const STAGE_FAILED = '阶段加载失败';
const OPTIONS_FAILED = '知识点加载失败';
const REFERENCE_FAILED = '无法引用这个练习';
const SAVE_FIRST = '先保存课程修改';
const COLLECT_HINT = '在文件收集里新建，学生会在本章看到';
const REFERENCE_HINT = '从「我的题目集」里选一个练习、作业或考试。';
const PROBLEM_HINT = '勾选的题直接挂到这里。题目集里的题请用「引用已有题目集」。';
const ALREADY_ATTACHED = '已经在这一章里';
const ALREADY_ELSEWHERE = '这道题已经在本章的其他位置';
const ATTACHED = '已挂到这一章';
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const MENU_ITEM = 'h-auto! w-full items-start justify-start gap-2 whitespace-normal! rounded-sm px-2 py-1.5 text-left font-normal text-fg';

type PracticeStage = NonNullable<TeachCopySource['stages']>[number];
type ReferenceTab = 'practice' | 'quiz';
interface KnowledgeOption { id: string; mapId: string; label: string }
type CreatePlace = { courseId: string; nodeId: string } | null;

interface StageReady {
  phase: 'ready';
  id: string;
  title: string;
  stages: PracticeStage[];
  selected: PracticeStage[];
}

type StageStep =
  | null
  | { phase: 'loading'; id: string; title: string }
  | StageReady
  | { phase: 'error'; message: string };

export function AddContentMenu({
  courseId,
  saved,
  dirty,
  chapter,
  section,
  onChange,
}: {
  courseId: string;
  saved: boolean;
  dirty: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  onChange: (next: ChapterDraft) => void;
}): JSX.Element {
  const chapterRef = useRef(chapter);
  const sectionRef = useRef(section);
  const onChangeRef = useRef(onChange);
  chapterRef.current = chapter;
  sectionRef.current = section;
  onChangeRef.current = onChange;
  const [videoOpen, setVideoOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const canCreateSet = saved && !dirty;
  const chapterOnly = section === null;

  const commit = useCallback((next: ChapterDraft) => {
    chapterRef.current = next;
    onChangeRef.current(next);
  }, []);

  return (
    <>
      <Popover
        placement="bottom-end"
        className="w-72 max-w-full p-1"
        trigger={(props) => (
          <Button type="button" variant="secondary" aria-haspopup="menu" {...props}>
            <Plus />
            添加内容
            <ChevronDown />
          </Button>
        )}
      >
        {(close) => (
          <ContentMenu
            chapterOnly={chapterOnly}
            section={section}
            canCreateSet={canCreateSet}
            practiceHref={newSetHref('practice', courseId, chapter._id)}
            homeworkHref={newSetHref('homework', courseId, chapter._id)}
            collectHref={collectHref(courseId, chapter._id)}
            onClose={close}
            onVideo={() => {
              close();
              setVideoOpen(true);
            }}
            onProblems={() => {
              close();
              setProblemOpen(true);
            }}
            onReference={() => {
              close();
              setReferenceOpen(true);
            }}
          />
        )}
      </Popover>
      <VideoSheet
        open={videoOpen}
        onOpenChange={setVideoOpen}
        courseId={courseId}
        saved={saved}
        chapter={chapter}
        section={section}
        commit={commit}
      />
      <ProblemSheet
        open={problemOpen}
        onOpenChange={setProblemOpen}
        chapter={chapter}
        section={section}
        commit={commit}
      />
      {chapterOnly ? (
        <ReferenceDialog
          open={referenceOpen}
          onOpenChange={setReferenceOpen}
          chapterRef={chapterRef}
          commit={commit}
        />
      ) : null}
    </>
  );
}

function ContentMenu({
  chapterOnly,
  section,
  canCreateSet,
  practiceHref,
  homeworkHref,
  collectHref: collectLink,
  onClose,
  onVideo,
  onProblems,
  onReference,
}: {
  chapterOnly: boolean;
  section: SectionDraft | null;
  canCreateSet: boolean;
  practiceHref: string;
  homeworkHref: string;
  collectHref: string;
  onClose: () => void;
  onVideo: () => void;
  onProblems: () => void;
  onReference: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="添加内容"
      className="flex flex-col [&_svg]:size-4"
      onKeyDown={onMenuKeyDown}
    >
      <MenuButton icon={<Video />} label="视频" description={section ? '上传 mp4 / webm，每节最多 8 个' : '上传 mp4 / webm，每章最多 8 个'} onSelect={onVideo} />
      <MenuButton icon={<ListChecks />} label="题目" onSelect={onProblems} />
      {chapterOnly ? (
        <>
          <Separator role="separator" className="my-1 bg-line-subtle" />
          <MenuButton icon={<Layers />} label="引用已有题目集" description={REFERENCE_HINT} onSelect={onReference} />
          <div role="group" aria-label="新建题目集并挂到这里">
            <div className="flex items-start gap-2 px-2 py-1.5 text-sm text-fg">
              <Plus />
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span>新建题目集并挂到这里</span>
                <span className="text-xs font-normal text-fg-subtle">走同一个新建流程，建好自动挂上</span>
              </span>
            </div>
            <div className="pl-6">
              <NewSetChoice label="练习" href={practiceHref} enabled={canCreateSet} onClose={onClose} />
              <NewSetChoice label="作业" href={homeworkHref} enabled={canCreateSet} onClose={onClose} />
            </div>
          </div>
          <Separator role="separator" className="my-1 bg-line-subtle" />
          <Button asChild variant="ghost" className={MENU_ITEM}>
            <a href={collectLink} target="_blank" rel="noreferrer" role="menuitem" onClick={onClose}>
              <FolderUp />
              <ItemText label="文件收集" description={COLLECT_HINT} />
            </a>
          </Button>
        </>
      ) : null}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  description,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <Button type="button" variant="ghost" role="menuitem" className={MENU_ITEM} onClick={onSelect}>
      {icon}
      <ItemText label={label} description={description} />
    </Button>
  );
}

function ItemText({ label, description }: { label: string; description?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start">
      <span>{label}</span>
      {description ? <span className="text-xs font-normal text-fg-subtle">{description}</span> : null}
    </span>
  );
}

function NewSetChoice({
  label,
  href,
  enabled,
  onClose,
}: {
  label: '练习' | '作业';
  href: string;
  enabled: boolean;
  onClose: () => void;
}) {
  if (!enabled) {
    return (
      <Button
        type="button"
        variant="ghost"
        role="menuitem"
        disabled
        className={MENU_ITEM}
        title={SAVE_FIRST}
        aria-description={SAVE_FIRST}
      >
        <ItemText label={label} description={SAVE_FIRST} />
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" className={MENU_ITEM}>
      <a href={href} role="menuitem" onClick={onClose}>
        <ItemText label={label} />
      </a>
    </Button>
  );
}

function VideoSheet({
  open,
  onOpenChange,
  courseId,
  saved,
  chapter,
  section,
  commit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  saved: boolean;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  commit: (next: ChapterDraft) => void;
}) {
  const chapterRef = useRef(chapter);
  const sectionRef = useRef(section);
  chapterRef.current = chapter;
  sectionRef.current = section;
  const videos = section ? sectionVideos(chapter, section) : chapter.videos;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>本章视频</SheetTitle>
        </SheetHeader>
        <SheetBody className="px-5 py-4">
          <CourseVideoEditor
            key={section ? `section-${section._id}` : `chapter-${chapter._id}`}
            courseId={courseId}
            chapterId={chapter._id}
            sectionId={section ? section._id : null}
            videos={videos}
            locked={!saved}
            onChange={(next) => {
              const draft = writeVideos(chapterRef.current, sectionRef.current, next);
              chapterRef.current = draft;
              commit(draft);
            }}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function ProblemSheet({
  open,
  onOpenChange,
  chapter,
  section,
  commit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapter: ChapterDraft;
  section: SectionDraft | null;
  commit: (next: ChapterDraft) => void;
}) {
  const pids = section ? sectionPids(chapter, section) : chapter.pids;
  const inPaper = useMemo(() => docIdSet(pids), [pids]);
  const [selection, setSelection] = useState<ReadonlySet<number>>(() => new Set());
  const [refreshToken, setRefreshToken] = useState(0);
  const [objective, setObjective] = useState<{ kind: BasicObjectiveKind; nodeId: string | null } | null>(null);
  const [knowledgeOptions, setKnowledgeOptions] = useState<KnowledgeOption[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const loadedItems = useRef(new Map<number, TeachBankItem>());
  const chapterRef = useRef(chapter);
  const sectionRef = useRef(section);
  chapterRef.current = chapter;
  sectionRef.current = section;

  const onItemsLoaded = useCallback((items: TeachBankItem[]) => {
    for (const item of items) loadedItems.current.set(item.docId, item);
  }, []);

  function addDocIds(docIds: readonly number[]) {
    const current = chapterRef.current;
    const target = sectionRef.current;
    const currentPids = target ? sectionPids(current, target) : current.pids;
    const elsewhere = placedElsewhere(current, target);
    const fresh: number[] = [];
    let blocked = false;
    for (const docId of docIds) {
      if (!Number.isSafeInteger(docId) || docId <= 0) throw new TypeError(`题目编号无效：${docId}`);
      if (elsewhere.has(docId)) {
        blocked = true;
        continue;
      }
      fresh.push(docId);
    }
    if (blocked) void alertDialog(ALREADY_ELSEWHERE);
    const { next, added } = appendDocIds(currentPids, fresh);
    if (added === 0) {
      if (!blocked) void alertDialog(ALREADY_ATTACHED);
      return;
    }
    const draft = writePids(current, target, next);
    chapterRef.current = draft;
    commit(draft);
    toast.success(`已加入 ${added} 道`);
  }

  function requireLoaded(docId: number): TeachBankItem {
    const item = loadedItems.current.get(docId);
    if (!item) throw new TypeError(`找不到题目 ${docId}`);
    return item;
  }

  async function openObjective(kind: BasicObjectiveKind, node: CreatePlace) {
    setCreateError(null);
    try {
      const raw = await getJson('/problem/create/single', OPTIONS_FAILED);
      const options = readKnowledgeOptions(raw);
      setKnowledgeOptions(options);
      setObjective({ kind, nodeId: node?.nodeId ?? null });
    } catch (error) {
      console.error('Failed to load knowledge options for a course problem', { error });
      setCreateError(messageOf(error, OPTIONS_FAILED));
    }
  }

  function onCreated(item: PaperItem) {
    addDocIds([item.docId]);
    setRefreshToken((current) => current + 1);
  }

  const title = section ? '给本节挂题' : '给本章挂题';
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="md:max-w-xl">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <p className="mt-1 text-sm text-fg-muted">{PROBLEM_HINT}</p>
          </SheetHeader>
          {createError ? (
            <div className="shrink-0 px-5 pt-3">
              <Alert tone="danger">{createError}</Alert>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <DndContext>
              <BankPane
                type="homework"
                locked={false}
                inPaper={inPaper}
                selection={selection}
                onToggleSelect={(docId, on) => {
                  if (!on) {
                    setSelection((current) => {
                      if (!current.has(docId)) return current;
                      const next = new Set(current);
                      next.delete(docId);
                      return next;
                    });
                    return;
                  }
                  addDocIds([requireLoaded(docId).docId]);
                }}
                onClearSelection={() => setSelection(new Set())}
                onAdd={(items) => {
                  addDocIds(items.map((item) => requireLoaded(item.docId).docId));
                }}
                onCreateObjective={(kind, node) => {
                  void openObjective(kind, node);
                }}
                onItemsLoaded={onItemsLoaded}
                refreshToken={refreshToken}
              />
            </DndContext>
          </div>
        </SheetContent>
      </Sheet>
      <ObjectiveSheet
        open={objective !== null}
        onOpenChange={(next) => {
          if (!next) setObjective(null);
        }}
        type="homework"
        initialKind={objective?.kind ?? 'single'}
        defaultScore={(kind) => DEFAULT_KIND_SCORE[kind]}
        knowledgeOptions={knowledgeOptions}
        defaultNodeId={objective?.nodeId ?? null}
        onCreated={onCreated}
      />
    </>
  );
}

function ReferenceDialog({
  open,
  onOpenChange,
  chapterRef,
  commit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapterRef: { current: ChapterDraft };
  commit: (next: ChapterDraft) => void;
}) {
  const [tab, setTab] = useState<ReferenceTab>('practice');
  const [rows, setRows] = useState<TeachListRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [step, setStep] = useState<StageStep>(null);
  const request = useRef(0);
  const choosing = useRef(false);

  useEffect(() => {
    if (open) return;
    request.current += 1;
    setTab('practice');
    setRows([]);
    setPhase('loading');
    setListError(null);
    setActionError(null);
    setStep(null);
  }, [open]);

  useEffect(() => {
    if (!open || step !== null) return undefined;
    const token = request.current + 1;
    request.current = token;
    setPhase('loading');
    setListError(null);
    loadMineRows(tab, () => request.current === token)
      .then((loaded) => {
        if (loaded === null || request.current !== token) return;
        setRows(loaded);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (request.current !== token) return;
        console.error('Failed to load problem sets for a course chapter', { tab, error });
        setRows([]);
        setListError(messageOf(error, LIST_FAILED));
        setPhase('error');
      });
    return undefined;
  }, [open, tab, step]);

  async function choose(row: TeachListRow) {
    if (choosing.current) return;
    choosing.current = true;
    setActionError(null);
    try {
      if (row.type === 'practice') await choosePractice(row);
      else await chooseActivity(row);
    } catch (error) {
      console.error('Failed to attach a problem set to the chapter', { id: row.id, type: row.type, error });
      setActionError(messageOf(error, REFERENCE_FAILED));
    } finally {
      choosing.current = false;
    }
  }

  async function choosePractice(row: TeachListRow) {
    if (row.title.trim() === '') throw new TypeError('练习没有标题');
    const existing = (chapterRef.current.problemSetId ?? '').trim();
    if (existing !== '' && existing !== row.id) {
      const oldTitle = await practiceTitle(existing, rows);
      const accepted = await confirmDialog(
        `这一章只能引用一个练习，原来的「${oldTitle}」会被换掉。`,
        { title: `换成「${row.title}」？`, confirmLabel: '替换' },
      );
      if (!accepted) return;
    }
    const token = request.current + 1;
    request.current = token;
    setStep({ phase: 'loading', id: row.id, title: row.title });
    try {
      const stages = await practiceStages(row.id);
      if (request.current !== token) return;
      setStep({ phase: 'ready', id: row.id, title: row.title, stages, selected: [] });
    } catch (error) {
      if (request.current !== token) return;
      console.error('Failed to load practice stages', { id: row.id, error });
      setStep({ phase: 'error', message: messageOf(error, STAGE_FAILED) });
    }
  }

  async function chooseActivity(row: TeachListRow) {
    const current = chapterRef.current;
    const ids = splitCsv(current.tids);
    if (ids.includes(row.id)) {
      await alertDialog(ALREADY_ATTACHED);
      return;
    }
    commit({ ...current, tids: [...ids, row.id].join(',') });
    toast.success(ATTACHED);
    onOpenChange(false);
  }

  function commitPractice(ready: StageReady) {
    const allowed = new Set(ready.stages.map((stage) => stage.id));
    for (const stage of ready.selected) {
      if (!allowed.has(stage.id)) throw new TypeError(`阶段不在这个练习里：${stage.id}`);
    }
    commit({
      ...chapterRef.current,
      problemSetId: ready.id,
      stageIds: ready.selected.map((stage) => String(stage.id)).join(','),
    });
    toast.success(ATTACHED);
    onOpenChange(false);
  }

  const showList = step === null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>引用已有题目集</DialogTitle>
          <DialogDescription>{REFERENCE_HINT}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {actionError ? <Alert tone="danger" className="mb-3">{actionError}</Alert> : null}
          {showList ? (
            <>
              <MiniTabs<ReferenceTab>
                aria-label="题目集类型"
                value={tab}
                onValueChange={setTab}
                items={[
                  { value: 'practice', label: '练习' },
                  { value: 'quiz', label: '作业与考试' },
                ]}
              />
              {phase === 'loading' ? <ListSkeleton /> : null}
              {phase === 'error' ? <Alert tone="danger" className="mt-3">{listError}</Alert> : null}
              {phase === 'ready' && rows.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Layers />}
                  title={tab === 'practice' ? '还没有练习' : '还没有作业或考试'}
                  description="只列出你创建或协作的题目集。"
                />
              ) : null}
              {phase === 'ready' && rows.length > 0 ? (
                <div className="mt-3 divide-y divide-line-subtle">
                  {rows.map((row) => (
                    <Button
                      key={`${row.type}:${row.id}`}
                      type="button"
                      variant="ghost"
                      className="h-auto! w-full items-start justify-start gap-3 whitespace-normal! rounded-md px-2 py-2.5 text-left font-normal"
                      onClick={() => void choose(row)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="w-full truncate font-medium">{row.title}</span>
                        <span className="mt-0.5 text-xs text-fg-subtle">{rowMeta(row)}</span>
                      </span>
                      <Badge variant="outline" size="sm" className="shrink-0">{TEACH_TYPE_LABEL[row.type]}</Badge>
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {step?.phase === 'loading' ? <p className="text-sm text-fg-muted">正在读取阶段…</p> : null}
          {step?.phase === 'error' ? <Alert tone="danger">{step.message}</Alert> : null}
          {step?.phase === 'ready' ? (
            <StagePicker
              title={step.title}
              stages={step.stages}
              selected={step.selected}
              onSelected={(selected) => setStep({ ...step, selected })}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {step !== null ? (
            <Button type="button" variant="secondary" onClick={() => setStep(null)}>返回</Button>
          ) : null}
          {showList ? (
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          ) : null}
          {step?.phase === 'ready' ? (
            <Button type="button" variant="primary" onClick={() => commitPractice(step)}>引用</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StagePicker({
  title,
  stages,
  selected,
  onSelected,
}: {
  title: string;
  stages: PracticeStage[];
  selected: PracticeStage[];
  onSelected: (next: PracticeStage[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg">
        引用「
        {title}
        」
      </p>
      <FormField label="阶段" optional hint="留空则引用整个题目集">
        <MultiSelect
          options={stages}
          value={selected}
          onChange={onSelected}
          getKey={(stage) => String(stage.id)}
          getLabel={stageLabel}
          placeholder="选择阶段"
          emptyText="没有阶段"
        />
      </FormField>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-3/4" />
    </div>
  );
}

function newSetHref(type: 'practice' | 'homework', courseId: string, chapterId: number): string {
  const params = new URLSearchParams({
    type,
    fromCourse: courseId,
    chapter: String(chapterId),
  });
  return `/teach/new?${params.toString()}`;
}

function collectHref(courseId: string, chapterId: number): string {
  const params = new URLSearchParams({
    fromCourse: courseId,
    chapter: String(chapterId),
  });
  return `/admin/collect/create?${params.toString()}`;
}

function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((node) => {
    return !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true';
  });
  if (nodes.length === 0) return;
  const current = document.activeElement;
  const index = current instanceof HTMLElement ? nodes.indexOf(current) : -1;
  const nextIndex = index === -1
    ? (event.key === 'ArrowDown' ? 0 : nodes.length - 1)
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
  event.preventDefault();
  nodes[nextIndex]?.focus({ preventScroll: true });
}

function sectionPids(chapter: ChapterDraft, section: SectionDraft): string[] {
  return findSection(chapter, section._id).pids;
}

function sectionVideos(chapter: ChapterDraft, section: SectionDraft): CourseAuthorVideo[] {
  return findSection(chapter, section._id).videos;
}

function findSection(chapter: ChapterDraft, sectionId: number): SectionDraft {
  const matches = chapter.sections.filter((item) => item._id === sectionId);
  if (matches.length === 0) throw new TypeError(`小节 ${sectionId} 不在这一章里`);
  if (matches.length > 1) throw new TypeError(`小节编号重复：${sectionId}`);
  const found = matches[0];
  if (!found) throw new TypeError(`小节 ${sectionId} 不在这一章里`);
  return found;
}

function writePids(chapter: ChapterDraft, section: SectionDraft | null, pids: string[]): ChapterDraft {
  if (section === null) return { ...chapter, pids };
  findSection(chapter, section._id);
  return {
    ...chapter,
    sections: chapter.sections.map((item) => (item._id === section._id ? { ...item, pids } : item)),
  };
}

function writeVideos(chapter: ChapterDraft, section: SectionDraft | null, videos: CourseAuthorVideo[]): ChapterDraft {
  if (section === null) return { ...chapter, videos };
  findSection(chapter, section._id);
  return {
    ...chapter,
    sections: chapter.sections.map((item) => (item._id === section._id ? { ...item, videos } : item)),
  };
}

function placedElsewhere(chapter: ChapterDraft, section: SectionDraft | null): Set<number> {
  const ids = new Set<number>();
  const take = (pids: readonly string[]) => {
    for (const pid of pids) ids.add(docIdOf(pid));
  };
  if (section === null) {
    for (const item of chapter.sections) take(item.pids);
    return ids;
  }
  take(chapter.pids);
  for (const item of chapter.sections) {
    if (item._id === section._id) continue;
    take(item.pids);
  }
  return ids;
}

function docIdSet(pids: readonly string[]): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const pid of pids) {
    ids.add(docIdOf(pid));
  }
  return ids;
}

function docIdOf(pid: string): number {
  if (!/^[1-9]\d*$/.test(pid)) throw new TypeError(`题目编号不是正整数：${pid}`);
  const value = Number(pid);
  if (!Number.isSafeInteger(value)) throw new TypeError(`题目编号超出范围：${pid}`);
  return value;
}

function appendDocIds(pids: readonly string[], docIds: readonly number[]): { next: string[]; added: number } {
  const seen = new Set(pids);
  const next = pids.slice();
  let added = 0;
  for (const docId of docIds) {
    if (!Number.isSafeInteger(docId) || docId <= 0) throw new TypeError(`题目编号无效：${docId}`);
    const id = String(docId);
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    added += 1;
  }
  return { next, added };
}

function splitCsv(value: string): string[] {
  if (value.trim() === '') return [];
  return value.split(',').map((part) => part.trim()).filter((part) => part !== '');
}

function listPath(type: 'practice' | 'quiz', page: number): string {
  const base = `/teach?scope=mine&type=${type}`;
  if (page === 1) return base;
  return `${base}&page=${page}`;
}

async function readMinePage(path: string, tab: ReferenceTab, expectedPage: number): Promise<TeachListPayload> {
  const raw = await getJson(path, LIST_FAILED);
  const payload = parseTeachListPayload(raw);
  if (payload.scope !== 'mine') throw new TypeError('teach_payload_invalid:scope');
  if (payload.filter.type !== tab) throw new TypeError('teach_payload_invalid:type');
  if (payload.page !== expectedPage) throw new TypeError(`题目集返回了第 ${payload.page} 页，请求的是第 ${expectedPage} 页`);
  if (!Number.isSafeInteger(payload.pageCount) || payload.pageCount < 1 || payload.page > payload.pageCount) {
    throw new TypeError('题目集页数不正确');
  }
  return payload;
}

async function loadMineRows(tab: ReferenceTab, isCurrent: () => boolean): Promise<TeachListRow[] | null> {
  const type = tab === 'practice' ? 'practice' : 'quiz';
  const first = await readMinePage(listPath(type, 1), tab, 1);
  if (!isCurrent()) return null;
  const merged = [...first.rows];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const next = await readMinePage(listPath(type, page), tab, page);
    if (!isCurrent()) return null;
    if (next.pageCount !== first.pageCount) throw new TypeError('题目集页数不一致');
    merged.push(...next.rows);
  }
  assertListRows(merged, tab);
  return merged;
}

function assertListRows(rows: readonly TeachListRow[], tab: ReferenceTab): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new TypeError(`题目集编号重复：${row.id}`);
    seen.add(row.id);
    const practice = row.type === 'practice';
    if (tab === 'practice' && !practice) throw new TypeError(`练习列表里出现了${row.type}`);
    if (tab === 'quiz' && practice) throw new TypeError('作业列表里出现了练习');
    if (tab === 'quiz' && row.type !== 'homework' && row.type !== 'exam' && row.type !== 'acm' && row.type !== 'oi') {
      throw new TypeError(`无法挂到章节的题目集类型：${row.type}`);
    }
  }
}

function assertStages(stages: readonly PracticeStage[]): void {
  const seen = new Set<number>();
  for (const stage of stages) {
    if (!Number.isSafeInteger(stage.id) || stage.id <= 0) throw new TypeError(`阶段编号无效：${stage.id}`);
    if (seen.has(stage.id)) throw new TypeError(`阶段编号重复：${stage.id}`);
    seen.add(stage.id);
  }
}

function stageLabel(stage: PracticeStage): string {
  if (stage.title.trim() === '') return `阶段 ${stage.id}`;
  return stage.title;
}

async function loadPractice(id: string): Promise<TeachCopySource> {
  if (!OBJECT_ID.test(id)) throw new TypeError(`题目集编号无效：${id}`);
  const raw = await getJson(`/teach/practice/${id}/copyable`, STAGE_FAILED);
  const copy = parseTeachCopySource(raw);
  if (copy.type !== 'practice') throw new TypeError('这不是练习');
  if (copy.id !== id) throw new TypeError('练习编号不一致');
  return copy;
}

async function practiceTitle(id: string, rows: readonly TeachListRow[]): Promise<string> {
  const listed = rows.find((row) => row.id === id)?.title;
  if (listed !== undefined && listed.trim() !== '') return listed;
  try {
    const copy = await loadPractice(id);
    if (copy.title.trim() !== '') return copy.title;
  } catch (error) {
    console.error('Failed to load the replaced practice title', { id, error });
  }
  return id;
}

async function practiceStages(id: string): Promise<PracticeStage[]> {
  const copy = await loadPractice(id);
  if (copy.stages === null) throw new TypeError('练习没有阶段数据');
  assertStages(copy.stages);
  return copy.stages;
}

function rowMeta(row: TeachListRow): string {
  const count = `${row.problemCount} 道`;
  if (row.type === 'practice' && row.stageCount !== null) return `${count} · ${row.stageCount} 个阶段`;
  return count;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError && error.message.startsWith('teach_')) return fallback;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function readKnowledgeOptions(raw: unknown): KnowledgeOption[] {
  if (!isRecord(raw)) throw new TypeError('知识点选项不是对象');
  const list = raw.knowledgeMindmapOptions;
  if (!Array.isArray(list)) throw new TypeError('knowledgeMindmapOptions 不是数组');
  const options: KnowledgeOption[] = [];
  const seen = new Set<string>();
  for (const [index, item] of list.entries()) {
    if (!isRecord(item)) throw new TypeError(`知识点选项 ${index} 不是对象`);
    const id = readOptionText(item, 'id', index);
    const mapId = readOptionText(item, 'mapId', index);
    const label = readOptionText(item, 'label', index);
    if (seen.has(id)) throw new TypeError(`知识点 id 重复：${id}`);
    seen.add(id);
    options.push({ id, mapId, label });
  }
  return options;
}

function readOptionText(record: Record<string, unknown>, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`知识点选项 ${index} 的 ${key} 无效`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
