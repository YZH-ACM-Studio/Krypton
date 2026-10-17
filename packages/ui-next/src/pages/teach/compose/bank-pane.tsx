import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  disallowedTeachKinds,
  isBasicObjectiveKind,
  isTeachKindAllowed,
  parseProblemKind,
  TEACH_ALLOWED_KINDS,
} from '@hydrooj/common';
import type { BasicObjectiveKind, ProblemKind, TeachType } from '@hydrooj/common';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import type { MenuItem } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import type { SimpleSelectOption } from '@/components/ui/select';
import { DIFFICULTY_LEVELS } from '@/components/ui/verdict';
import { cn } from '@/lib/cn';
import { TEACH_KIND_LABEL, TEACH_TYPE_NOUN, parseTeachBankPage, parseTeachKnowledgeTree } from '../model';
import type { TeachBankItem, TeachKnowledgeCourse, TeachKnowledgeNode, TeachKnowledgeTree } from '../model';
import { getJson, teachApi } from '../api';
import type { TeachBankQuery } from '../api';
import { BankPreview } from './bank-preview';

const TREE_FALLBACK = '课程加载失败';
const LIST_FALLBACK = '加载题目失败';
const SEARCH_DELAY_MS = 300;

type SourceFilter = TeachBankQuery['source'];
type KindFilter = TeachBankQuery['kind'];
type DifficultyFilter = TeachBankQuery['difficulty'];
type CreatePlace = { courseId: string; nodeId: string } | null;

interface BankDragPayload {
  from: 'bank';
  item: TeachBankItem;
}

interface ShareOverride {
  shared: boolean;
  seq: number;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPaperDrag(active: { data: { current: unknown } } | null): boolean {
  if (!active) return false;
  const current: unknown = active.data.current;
  if (!isRecord(current)) return false;
  return current.from === 'paper';
}

function defaultCourseId(courses: readonly TeachKnowledgeCourse[]): string | null {
  if (courses.length === 0) return null;
  const withProblems = courses.find((course) => course.total > 0);
  return (withProblems ?? courses[0]).id;
}

function keepCourseId(courses: readonly TeachKnowledgeCourse[], current: string | null): string | null {
  if (current === 'all') return 'all';
  if (current !== null && courses.some((course) => course.id === current)) return current;
  return defaultCourseId(courses);
}

function assertTreeIdentity(courses: readonly TeachKnowledgeCourse[]): void {
  const courseIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const course of courses) {
    if (course.id === 'all') throw new TypeError('课程 id 不能是 all');
    if (courseIds.has(course.id)) throw new TypeError(`课程 id 重复：${course.id}`);
    courseIds.add(course.id);
    assertNodeIdentity(course.nodes, nodeIds);
  }
}

function assertNodeIdentity(nodes: readonly TeachKnowledgeNode[], seen: Set<string>): void {
  for (const node of nodes) {
    if (seen.has(node.id)) throw new TypeError(`知识点 id 重复：${node.id}`);
    seen.add(node.id);
    assertNodeIdentity(node.children, seen);
  }
}

function nodeTitles(nodes: readonly TeachKnowledgeNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const next = [...trail, node.title];
    if (node.id === id) return next;
    const nested = nodeTitles(node.children, id, next);
    if (nested) return nested;
  }
  return null;
}

function createPlace(courseId: string | null, nodeId: string | null): CreatePlace {
  if (courseId === null || courseId === 'all' || nodeId === null || nodeId === 'all') return null;
  return { courseId, nodeId };
}

function acceptRate(item: TeachBankItem): string | null {
  if (item.nSubmit <= 0) return null;
  const rate = Math.round((item.nAccept / item.nSubmit) * 100);
  if (!Number.isFinite(rate)) return null;
  return `通过率 ${rate}%`;
}

function appendUnique(current: readonly TeachBankItem[], next: readonly TeachBankItem[]): TeachBankItem[] {
  const seen = new Set(current.map((item) => item.docId));
  const merged = [...current];
  for (const item of next) {
    if (seen.has(item.docId)) continue;
    seen.add(item.docId);
    merged.push(item);
  }
  return merged;
}

function excludeIds(inPaper: ReadonlySet<number>, onlyNew: boolean): number[] {
  if (!onlyNew) return [];
  return [...inPaper].sort((left, right) => left - right);
}

const DRAG_ARM_PX = 4;

function stopPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function stopKey(event: ReactKeyboardEvent<HTMLElement>) {
  event.stopPropagation();
}

function dragStarter(
  listeners: { onPointerDown?: unknown } | undefined,
): ((event: ReactPointerEvent<HTMLElement>) => void) | null {
  const handler: unknown = listeners?.onPointerDown;
  if (typeof handler !== 'function') return null;
  return (event) => {
    handler(event);
  };
}

/** A click must not activate a drag: dnd-kit then swallows the next click for 50ms. */
function armRowDrag(
  event: ReactPointerEvent<HTMLElement>,
  startDrag: ((event: ReactPointerEvent<HTMLElement>) => void) | null,
) {
  event.stopPropagation();
  if (!startDrag) return;
  const pointerId = event.pointerId;
  const originX = event.clientX;
  const originY = event.clientY;
  const begin = () => {
    window.removeEventListener('pointermove', onMove);
    startDrag(event);
  };
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== pointerId) return;
    if (Math.hypot(move.clientX - originX, move.clientY - originY) <= DRAG_ARM_PX) return;
    begin();
  };
  const onDone = (done: PointerEvent) => {
    if (done.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onDone);
    window.removeEventListener('pointercancel', onDone);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onDone);
  window.addEventListener('pointercancel', onDone);
}

function courseOptions(courses: readonly TeachKnowledgeCourse[]): SimpleSelectOption[] {
  return [
    ...courses.map((course) => ({
      value: course.id,
      label: course.title,
      hint: course.hidden ? '隐藏' : undefined,
    })),
    { type: 'separator' },
    { value: 'all', label: '全部课程（不按知识点筛）' },
  ];
}

function TreeRows({
  nodes,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  nodes: readonly TeachKnowledgeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const open = expanded.has(node.id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.id}>
            <div className="flex items-center gap-1 pr-3" style={{ paddingLeft: depth * 16 }}>
              {hasChildren ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-expanded={open}
                  aria-label={open ? `收起 ${node.title}` : `展开 ${node.title}`}
                  onClick={() => onToggle(node.id)}
                >
                  {open ? <ChevronDown /> : <ChevronRight />}
                </Button>
              ) : <span className="w-(--control-sm) shrink-0" />}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1 shrink justify-start"
                onClick={() => onOpen(node.id)}
              >
                <span className="min-w-0 truncate">{node.title}</span>
              </Button>
              <span className={cn('shrink-0 text-xs tabular', node.count === 0 ? 'text-fg-subtle' : 'text-fg-muted')}>
                {node.count}
              </span>
            </div>
            {hasChildren && open ? (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function BankRow({
  item,
  inPaper,
  selected,
  locked,
  onToggle,
  onOpen,
  onAdd,
}: {
  item: TeachBankItem;
  inPaper: boolean;
  selected: boolean;
  locked: boolean;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
  onAdd: () => void;
}): JSX.Element {
  const canDrag = !locked && !inPaper;
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({
    id: `bank:${item.docId}`,
    disabled: !canDrag,
    attributes: { role: 'group', roleDescription: '可拖动题目' },
    data: { from: 'bank', item } satisfies BankDragPayload,
  });
  const rate = acceptRate(item);
  const firstTag = item.tags.find((tag) => tag !== '') ?? null;
  const sharedFrom = item.hidden && item.schoolShared && !item.mine ? `共享自${item.ownerName}` : null;
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      className="flex items-start gap-2 border-b border-line-subtle px-3 py-2"
      {...(canDrag ? attributes : undefined)}
      {...(canDrag ? listeners : undefined)}
    >
      <span className="mt-0.5 shrink-0" onPointerDown={stopPointer} onKeyDown={stopKey}>
        <Checkbox
          size="sm"
          aria-label={`选择 ${item.pid}`}
          checked={inPaper || selected}
          disabled={locked || inPaper}
          onCheckedChange={(on) => {
            if (locked || inPaper) return;
            onToggle(on);
          }}
        />
      </span>
      <Button
        type="button"
        variant="ghost"
        className="h-auto! min-w-0 flex-1 shrink items-start justify-start whitespace-normal px-2 py-1 text-left"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointerStart.current = { x: event.clientX, y: event.clientY };
          armRowDrag(event, canDrag ? dragStarter(listeners) : null);
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (!start || event.button !== 0) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
          onOpen();
        }}
        onKeyDown={stopKey}
        onClick={onOpen}
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex w-full min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-xs text-fg-subtle">{item.pid}</span>
            <span className="min-w-0 truncate text-sm text-fg">{item.title}</span>
          </span>
          <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
            <Badge variant="outline" size="sm">{TEACH_KIND_LABEL[item.kind]}</Badge>
            {item.difficulty !== null ? <span className="tabular">难度 {item.difficulty}</span> : null}
            {firstTag ? <span>{firstTag}</span> : null}
            {rate ? <span className="tabular">{rate}</span> : null}
            {sharedFrom ? <span>{sharedFrom}</span> : null}
            {inPaper ? <span>已加入</span> : null}
          </span>
        </span>
      </Button>
      {inPaper ? (
        <span className="grid h-(--control-sm) w-(--control-sm) shrink-0 place-items-center text-success-fg">
          <Check />
        </span>
      ) : (
        <span className="shrink-0" onPointerDown={stopPointer} onKeyDown={stopKey}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`加入 ${item.pid}`}
            disabled={locked}
            onClick={onAdd}
          >
            <Plus />
          </Button>
        </span>
      )}
    </div>
  );
}

export function BankPane({
  type,
  locked,
  inPaper,
  selection,
  onToggleSelect,
  onClearSelection,
  onAdd,
  onCreateObjective,
  onItemsLoaded,
  refreshToken,
}: {
  type: TeachType;
  locked: boolean;
  inPaper: ReadonlySet<number>;
  selection: ReadonlySet<number>;
  onToggleSelect: (docId: number, on: boolean) => void;
  onClearSelection: () => void;
  onAdd: (items: TeachBankItem[]) => void;
  onCreateObjective: (kind: BasicObjectiveKind, node: CreatePlace) => void;
  onItemsLoaded: (items: TeachBankItem[]) => void;
  refreshToken: number;
}): JSX.Element {
  const { setNodeRef, isOver, active } = useDroppable({ id: 'bank-pane' });
  const [tree, setTree] = useState<TeachKnowledgeTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [source, setSource] = useState<SourceFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [fetchPage, setFetchPage] = useState(1);
  const [fetchTick, setFetchTick] = useState(0);
  const [items, setItems] = useState<TeachBankItem[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const loadedType = useRef<TeachType | null>(null);
  const listRequest = useRef(0);
  const cacheRef = useRef(new Map<number, TeachBankItem>());
  const shareOverrides = useRef(new Map<number, ShareOverride>());
  const sharePending = useRef(new Set<number>());
  const shareEpoch = useRef(0);
  const shareSeq = useRef(0);
  const onItemsLoadedRef = useRef(onItemsLoaded);
  const onClearSelectionRef = useRef(onClearSelection);
  onItemsLoadedRef.current = onItemsLoaded;
  onClearSelectionRef.current = onClearSelection;

  const excluded = excludeIds(inPaper, onlyNew);
  const excludeKey = excluded.join(',');
  const filterKey = [
    type,
    courseId ?? '',
    nodeId ?? '',
    source,
    kind,
    String(difficulty),
    q,
    excludeKey,
    String(refreshToken),
    String(localRefresh),
  ].join('\u001F');
  const [seenFilter, setSeenFilter] = useState(filterKey);
  if (seenFilter !== filterKey) {
    setSeenFilter(filterKey);
    setLoadedPage(0);
    setFetchPage(1);
    setFetchTick((current) => current + 1);
    setItems([]);
    setPageCount(1);
    setSettled(false);
    setListError(null);
  }

  const listing = courseId === 'all' || (courseId !== null && nodeId !== null);
  const course = courseId !== null && courseId !== 'all'
    ? tree?.courses.find((entry) => entry.id === courseId) ?? null
    : null;
  const hiddenKinds = disallowedTeachKinds(type);
  const objectiveKinds = TEACH_ALLOWED_KINDS[type].filter(isBasicObjectiveKind);
  const place = createPlace(courseId, nodeId);
  const paperOver = isOver && isPaperDrag(active);

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(qInput), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    if (kind !== 'all' && !isTeachKindAllowed(type, kind)) setKind('all');
  }, [type, kind]);

  useEffect(() => {
    let cancelled = false;
    const typeChanged = loadedType.current !== null && loadedType.current !== type;
    if (typeChanged) {
      setTree(null);
      setCourseId(null);
      setNodeId(null);
      setPreviewDocId(null);
      setExpanded(new Set());
    }
    setTreeLoading(true);
    setTreeError(null);
    getJson(teachApi.knowledgeTree(type), TREE_FALLBACK)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseTeachKnowledgeTree(raw);
        assertTreeIdentity(parsed.courses);
        const keep = loadedType.current === type;
        loadedType.current = type;
        setTree(parsed);
        setCourseId((current) => keepCourseId(parsed.courses, keep ? current : null));
        if (!keep) setNodeId(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        console.error('teach bank knowledge tree failed', { type, error: caught });
        setTreeError(messageOf(caught, TREE_FALLBACK));
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, refreshToken, localRefresh]);

  useEffect(() => {
    if (!listing || courseId === null) return undefined;
    const requestedPage = fetchPage;
    const epochAtRequest = shareEpoch.current;
    const seqAtRequest = shareSeq.current;
    const requestId = ++listRequest.current;
    let cancelled = false;
    const query: TeachBankQuery = {
      type,
      course: courseId,
      node: courseId === 'all' || nodeId === null || nodeId === 'all' ? 'all' : nodeId,
      source,
      kind,
      difficulty,
      q,
      exclude: excludeKey === '' ? [] : excludeKey.split(',').map((part) => Number(part)),
      page: requestedPage,
    };
    setListLoading(true);
    getJson(teachApi.bank(query), LIST_FALLBACK)
      .then((raw) => {
        if (cancelled || requestId !== listRequest.current) return;
        const parsed = parseTeachBankPage(raw);
        if (!Number.isInteger(parsed.pageCount) || parsed.pageCount < 0) {
          throw new TypeError('题库页数不正确');
        }
        if (parsed.page !== requestedPage) {
          throw new TypeError(`题库返回了第 ${parsed.page} 页，请求的是第 ${requestedPage} 页`);
        }
        const visible = parsed.items.map((item) => projectShare(item, epochAtRequest, seqAtRequest));
        setPageCount(parsed.pageCount);
        setLoadedPage(requestedPage);
        setItems((current) => (requestedPage === 1 ? visible : appendUnique(current, visible)));
        setSettled(true);
        setListError(null);
        onItemsLoadedRef.current(visible);
      })
      .catch((caught: unknown) => {
        if (cancelled || requestId !== listRequest.current) return;
        console.error('teach bank list failed', { type, course: courseId, node: nodeId, page: requestedPage, error: caught });
        setListError(messageOf(caught, LIST_FALLBACK));
        setSettled(true);
        if (requestedPage === 1) setItems([]);
      })
      .finally(() => {
        if (!cancelled && requestId === listRequest.current) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listing, courseId, nodeId, fetchPage, fetchTick, type, source, kind, difficulty, q, excludeKey, refreshToken, localRefresh]);

  function selectCourse(next: string) {
    setCourseId(next);
    setNodeId(null);
    setPreviewDocId(null);
    setExpanded(new Set());
    onClearSelectionRef.current();
  }

  function openNode(next: string) {
    setNodeId(next);
    setPreviewDocId(null);
    onClearSelectionRef.current();
  }

  function backToTree() {
    setNodeId(null);
    setPreviewDocId(null);
    onClearSelectionRef.current();
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chooseKind(value: string) {
    if (value === 'all') {
      setKind('all');
      return;
    }
    const parsed: ProblemKind = parseProblemKind(value);
    if (!isTeachKindAllowed(type, parsed)) throw new TypeError(`这个类型不能筛选${TEACH_KIND_LABEL[parsed]}`);
    setKind(parsed);
  }

  function chooseDifficulty(value: string) {
    if (value === 'all') {
      setDifficulty('all');
      return;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) throw new TypeError(`难度 ${value} 不在 0 到 10`);
    setDifficulty(parsed);
  }

  function projectShare(item: TeachBankItem, epochAtRequest: number, seqAtRequest: number): TeachBankItem {
    const pending = sharePending.current.has(item.docId);
    const current = shareOverrides.current.get(item.docId);
    const epochMatches = epochAtRequest === shareEpoch.current;
    const requestCoversOverride = current !== undefined && seqAtRequest >= current.seq;
    // Drop the override only when this list started at or after it, the epoch still matches, and no POST is in flight.
    if (current !== undefined && epochMatches && !pending && requestCoversOverride) {
      shareOverrides.current.delete(item.docId);
    }
    const kept = shareOverrides.current.get(item.docId);
    if (kept === undefined) {
      cacheRef.current.set(item.docId, item);
      return item;
    }
    const stored = { ...item, schoolShared: kept.shared };
    cacheRef.current.set(item.docId, stored);
    return stored;
  }

  function commitSchoolShared(docId: number, shared: boolean, posted: boolean) {
    if (posted) shareEpoch.current += 1;
    shareSeq.current += 1;
    shareOverrides.current.set(docId, { shared, seq: shareSeq.current });
    const cached = cacheRef.current.get(docId);
    if (cached) cacheRef.current.set(docId, { ...cached, schoolShared: shared });
    setItems((current) => current.map((entry) => (
      entry.docId === docId ? { ...entry, schoolShared: shared } : entry
    )));
  }

  function setSharePending(docId: number, pending: boolean) {
    if (pending) sharePending.current.add(docId);
    else sharePending.current.delete(docId);
  }

  function commitPreviewItem(next: TeachBankItem) {
    const override = shareOverrides.current.get(next.docId);
    const stored = override === undefined ? next : { ...next, schoolShared: override.shared };
    cacheRef.current.set(next.docId, stored);
    setItems((current) => current.map((entry) => (entry.docId === next.docId ? stored : entry)));
    onItemsLoadedRef.current([stored]);
  }

  function addOne(docId: number, fallback: TeachBankItem) {
    const latest = cacheRef.current.get(docId);
    if (!latest) {
      setListError(`找不到题目 ${fallback.pid}，无法加入。`);
      return;
    }
    onAdd([latest]);
  }

  function addSelected() {
    const missing: number[] = [];
    const chosen: TeachBankItem[] = [];
    for (const docId of selection) {
      const item = cacheRef.current.get(docId);
      if (!item) missing.push(docId);
      else chosen.push(item);
    }
    if (missing.length > 0) {
      setListError(`找不到已选题目 ${missing.join('、')}，无法加入。`);
      return;
    }
    onAdd(chosen);
  }

  function openCreate(kindToCreate: BasicObjectiveKind) {
    onCreateObjective(kindToCreate, place);
  }

  const menuItems: Array<MenuItem | 'separator'> = [
    ...objectiveKinds.map((objectiveKind) => ({
      label: `新建${TEACH_KIND_LABEL[objectiveKind]}`,
      onSelect: () => openCreate(objectiveKind),
    })),
    ...(objectiveKinds.length > 0 ? ['separator' as const] : []),
    {
      label: '在出题中心新建其它题型',
      onSelect: () => {
        // A successful noopener open returns null; that is not a blocked popup.
        window.open('/problem/create', '_blank', 'noopener');
      },
    },
  ];

  const path = course && nodeId !== null && nodeId !== 'all' ? nodeTitles(course.nodes, nodeId) : null;
  const crumbParts = nodeId === 'all' ? ['全部知识点'] : path ?? [];
  const previewItem = previewDocId === null ? null : cacheRef.current.get(previewDocId) ?? null;
  const previewCourseTitle = previewItem?.courseId
    ? tree?.courses.find((entry) => entry.id === previewItem.courseId)?.title ?? null
    : null;
  const showItems = settled && (listError === null || items.length > 0);
  const showLoadMore = showItems && loadedPage > 0 && loadedPage < pageCount;
  const laterPageError = showItems && listError !== null && items.length > 0;

  return (
    <section
      ref={setNodeRef}
      aria-label="题库"
      className={cn('relative flex h-full min-h-0 flex-col', paperOver && 'ring-2 ring-inset ring-brand')}
    >
      <div {...(previewDocId !== null ? { inert: true } : {})} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-fg-muted">课程</span>
          <div className="min-w-0 flex-1">
            {tree && courseId !== null ? (
              <SimpleSelect
                size="sm"
                ariaLabel="课程"
                value={courseId}
                options={courseOptions(tree.courses)}
                onValueChange={selectCourse}
              />
            ) : treeError ? null : (
              <span className="text-sm text-fg-muted">{treeLoading ? '正在加载课程…' : '没有课程'}</span>
            )}
          </div>
        </div>
      </div>
      {treeError ? (
        <div className="flex items-start gap-2 px-3 py-3">
          <div className="min-w-0 flex-1">
            <Alert tone="danger">{treeError}</Alert>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setLocalRefresh((current) => current + 1)}>
            <RefreshCw />
            刷新
          </Button>
        </div>
      ) : null}
      {tree && tree.courses.length === 0 && !treeLoading ? (
        <EmptyState compact title="还没有课程" description="知识点树没有返回课程。" />
      ) : null}
      {course && nodeId === null ? (
        <ScrollArea className="min-h-0 flex-1" viewportLayout="block" viewportClassName="[&>div]:w-full">
          <div className="flex items-center gap-1 pr-3">
            <span className="w-(--control-sm) shrink-0" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 shrink justify-start font-medium"
              onClick={() => openNode('all')}
            >
              全部知识点
            </Button>
            <span className={cn('shrink-0 text-xs tabular', course.total === 0 ? 'text-fg-subtle' : 'text-fg-muted')}>
              {course.total}
            </span>
          </div>
          <TreeRows
            nodes={course.nodes}
            depth={0}
            expanded={expanded}
            onToggle={toggleExpanded}
            onOpen={openNode}
          />
          <p className="px-3 py-3 text-xs text-fg-subtle">
            {`数字是这个知识点（含下级）里你能选、而且这个${TEACH_TYPE_NOUN[type]}能用的题。`}
          </p>
        </ScrollArea>
      ) : null}
      {listing ? (
        <>
          {course && nodeId !== null ? (
            <div className="flex min-w-0 items-center gap-1 px-2 py-1">
              <Button type="button" variant="ghost" size="sm" className="min-w-0 shrink justify-start" onClick={backToTree}>
                <span className="truncate">{course.title}</span>
              </Button>
              {crumbParts.map((part, index) => {
                const last = index === crumbParts.length - 1;
                return (
                  <span key={`${part}-${index}`} className="contents">
                    <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                    <span className={cn('min-w-0 truncate text-sm', last ? 'font-medium text-fg' : 'text-fg-muted')}>{part}</span>
                  </span>
                );
              })}
              {nodeId !== 'all' && path === null ? (
                <span className="min-w-0 truncate text-sm text-fg-subtle">知识点不在这门课里</span>
              ) : null}
              <span className="flex-1" />
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label="回到知识点树" onClick={backToTree}>
                <X />
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <MiniTabs
                size="sm"
                className="min-w-0"
                aria-label="来源"
                value={source}
                onValueChange={(next) => {
                  if (next === source) return;
                  setSource(next);
                  onClearSelectionRef.current();
                }}
                items={[
                  { value: 'all', label: '全部' },
                  { value: 'school', label: '学校题库' },
                  { value: 'mine', label: '我的题目' },
                ]}
              />
              <div className="shrink-0">
                <Menu
                  label="新建题目"
                  items={menuItems}
                  trigger={(props) => (
                    <Button type="button" variant="secondary" size="sm" disabled={locked} {...props}>
                      <Plus />
                      新建
                      <ChevronDown />
                    </Button>
                  )}
                />
              </div>
            </div>
            <SearchInput
              size="sm"
              value={qInput}
              placeholder="题号、标题或标签"
              aria-label="题号、标题或标签"
              onChange={(event) => setQInput(event.target.value)}
            />
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <SimpleSelect
                  size="sm"
                  ariaLabel="题型"
                  value={kind}
                  onValueChange={chooseKind}
                  options={[
                    { value: 'all', label: '全部题型' },
                    ...TEACH_ALLOWED_KINDS[type].map((allowed) => ({ value: allowed, label: TEACH_KIND_LABEL[allowed] })),
                  ]}
                />
              </div>
              <div className="min-w-0 flex-1">
                <SimpleSelect
                  size="sm"
                  ariaLabel="难度"
                  value={String(difficulty)}
                  onValueChange={chooseDifficulty}
                  options={[
                    { value: 'all', label: '全部难度' },
                    ...DIFFICULTY_LEVELS.map((level) => ({ value: String(level.value), label: level.label })),
                  ]}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Checkbox size="sm" label="只看未加入的" checked={onlyNew} onCheckedChange={setOnlyNew} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setLocalRefresh((current) => current + 1)}>
                <RefreshCw />
                刷新
              </Button>
            </div>
            {hiddenKinds.length > 0 ? (
              <p className="text-xs text-fg-subtle">
                {`${TEACH_TYPE_NOUN[type]}不能加${hiddenKinds.map((hidden) => TEACH_KIND_LABEL[hidden]).join('、')}，已经隐藏。`}
              </p>
            ) : null}
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportLayout="block" viewportClassName="[&>div]:w-full">
            {listError && items.length === 0 ? <div className="px-3 py-3"><Alert tone="danger">{listError}</Alert></div> : null}
            {listing && !settled ? <p className="px-3 py-3 text-sm text-fg-muted">正在加载题目…</p> : null}
            {showItems && items.length === 0 ? (
              <EmptyState compact title="这个知识点下还没有你能用的题" description="可以换个来源，或者点「新建」。" />
            ) : null}
            {showItems ? items.map((item) => (
              // Keeps a shared list ancestor from counting as the only row for this pid.
              <input key={`row-scope-${item.docId}`} type="hidden" aria-label={`选择 ${item.pid}`} defaultValue={item.pid} />
            )) : null}
            {showItems ? items.map((item) => (
              <BankRow
                key={item.docId}
                item={item}
                inPaper={inPaper.has(item.docId)}
                selected={selection.has(item.docId)}
                locked={locked}
                onToggle={(on) => onToggleSelect(item.docId, on)}
                onOpen={() => setPreviewDocId(item.docId)}
                onAdd={() => addOne(item.docId, item)}
              />
            )) : null}
            {showLoadMore || laterPageError ? (
              <div className="flex flex-col items-stretch gap-2 px-3 py-2">
                {laterPageError ? <Alert tone="danger">{listError}</Alert> : null}
                {showLoadMore ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={listLoading}
                      onClick={() => {
                        if (listLoading || loadedPage < 1) return;
                        setFetchPage(loadedPage + 1);
                        setFetchTick((current) => current + 1);
                      }}
                    >
                      加载更多
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </ScrollArea>
          {selection.size > 0 ? (
            <div className="flex items-center gap-2 border-t border-line px-3 py-2">
              <span className="text-sm tabular text-fg">已选 {selection.size} 道</span>
              <span className="flex-1" />
              <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>取消选择</Button>
              <Button type="button" variant="secondary" size="sm" className="tabular" onClick={addSelected}>
                {`加入选中（${selection.size}）`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      </div>
      {previewItem ? (
        <BankPreview
          type={type}
          item={previewItem}
          inPaper={inPaper.has(previewItem.docId)}
          locked={locked}
          courseTitle={previewCourseTitle}
          shareOverride={shareOverrides.current.get(previewItem.docId)?.shared}
          onSchoolShared={commitSchoolShared}
          onSharePending={setSharePending}
          onPreviewItem={commitPreviewItem}
          onAdd={() => addOne(previewItem.docId, previewItem)}
          onClose={() => setPreviewDocId(null)}
        />
      ) : null}
    </section>
  );
}
