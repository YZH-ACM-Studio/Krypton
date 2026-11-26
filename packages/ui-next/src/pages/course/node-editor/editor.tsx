import { ReactFlowProvider } from '@xyflow/react';
import { DndContext } from '@dnd-kit/core';
import { Plus, Trash2, Unlink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { mindmapProblemHref } from '@/pages/mindmap/api';
import { MindmapCanvas } from '@/pages/mindmap/canvas';
import { MindmapOutline } from '@/pages/mindmap/outline';
import type { KnowledgeMap, MindmapNode } from '@/pages/mindmap/types';
import type { PlannedMove } from '@/pages/mindmap/tree';
import { getJson, postForm } from '@/pages/teach/api';
import { BankPane } from '@/pages/teach/compose/bank-pane';
import type { TeachBankItem } from '@/pages/teach/model';
import type { ChapterDraft } from '../types';
import {
  applyCourseNodeMutation,
  chapterForNode,
  childMutation,
  courseNodeFormPayload,
  createdNodeId,
  emphasizedNodeIds,
  formatSavedClock,
  MAX_INCLUDED,
  moveIntoMutation,
  moveMutation,
  nextProblemIds,
  parentNodeIds,
  parseCourseNodeEditorSnapshot,
  parseListedProblems,
  renameMutation,
  siblingMutation,
  type CourseNodeEditorSnapshot,
  type CourseNodeMutation,
  type ListedProblem,
} from './state';

export type { CourseNodeEditorSnapshot } from './state';

export interface CourseNodeEditorProps {
  nodeId: string;
  /** First snapshot. Omitted: the editor GETs `/mindmap/${nodeId}/edit`. */
  initial?: CourseNodeEditorSnapshot;
  search?: string;
  chapters?: readonly ChapterDraft[];
  onOpenChapter?: (chapterId: number, sectionId: number | null) => void;
  /** Called with the course node title from each snapshot, so a page header can follow a rename. */
  onCourseTitleChange?: (title: string) => void;
  /** Applied to the three-column shell. The shell fills the parent and is at least 560px. */
  className?: string;
}

const HINT = '双击 改名 · 拖动 换位置 · Tab 加子节点 · Enter 加同级 · Del 删除';
const READONLY_NOTICE = '只有这门课节点的负责教师和管理员能编辑知识点。你可以浏览、搜索、看每个知识点的题，也能用它生成章节。';
const NO_CHAPTER = '还没有生成章节。在上方点「从知识点生成章节」。';
const COLORS = [
  { value: '', label: '默认' },
  { value: 'gray', label: '中性灰' },
  { value: 'sky', label: '天空蓝' },
  { value: 'blue', label: '深蓝' },
  { value: 'green', label: '绿色' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '玫红' },
  { value: 'purple', label: '紫色' },
];

interface ProblemLabel {
  pid: string;
  title: string;
}

function positiveDocId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function mutationParentId(mutation: CourseNodeMutation): string {
  const parentId = mutation.body.parentId;
  return typeof parentId === 'string' ? parentId : '';
}

function mutationTopic(mutation: CourseNodeMutation): string {
  const topic = mutation.body.topic;
  return typeof topic === 'string' ? topic : '';
}

/** Parent, grandparent, … of a node inside the snapshot (the course node's own parent is outside it). */
function ancestorIds(nodes: readonly MindmapNode[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node._id, node]));
  const ids: string[] = [];
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId && byId.has(parentId) && !ids.includes(parentId)) {
    ids.push(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return ids;
}

function withoutIds(set: Set<string>, ids: readonly string[]): Set<string> {
  if (!ids.some((id) => set.has(id))) return set;
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

export function CourseNodeEditor({
  nodeId,
  initial,
  search = '',
  chapters,
  onOpenChapter,
  onCourseTitleChange,
  className,
}: CourseNodeEditorProps) {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const nowRef = useRef(now);
  nowRef.current = now;
  const providedRef = useRef(initial);
  const labelsRef = useRef(new Map<string, ProblemLabel>());
  const snapshotRef = useRef<CourseNodeEditorSnapshot | null>(initial ?? null);
  const selectedIdRef = useRef<string | null>(initial?.courseNode.id ?? null);
  const topicFocused = useRef(false);
  const descriptionFocused = useRef(false);
  const childInputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<CourseNodeEditorSnapshot | null>(initial ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.courseNode.id ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => parentNodeIds(initial?.nodes ?? []));
  // The canvas starts fully open; without our own set it would collapse every branch below the course node.
  const [canvasCollapsed, setCanvasCollapsed] = useState<Set<string>>(() => new Set());
  // Bumped whenever a server snapshot lands, so the「全部」list is fetched again after a save or reload.
  const [serverRevision, setServerRevision] = useState(0);
  const onCourseTitleChangeRef = useRef(onCourseTitleChange);
  onCourseTitleChangeRef.current = onCourseTitleChange;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [savedClock, setSavedClock] = useState<string | null>(null);
  const [draftTopic, setDraftTopic] = useState(initial?.nodes.find((node) => node._id === initial.courseNode.id)?.topic ?? '');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [childTopic, setChildTopic] = useState('');
  const [problemTab, setProblemTab] = useState<'all' | 'collected'>('all');
  const [listed, setListed] = useState<{ nodeId: string; problems: ListedProblem[] } | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const inflightRef = useRef(0);

  const replaceSnapshot = (next: CourseNodeEditorSnapshot) => {
    snapshotRef.current = next;
    if (!mountedRef.current) return;
    setSnapshot(next);
    setServerRevision((value) => value + 1);
    setSelectedId((current) => (
      current && next.nodes.some((node) => node._id === current) ? current : next.courseNode.id
    ));
  };

  const beginSave = () => {
    inflightRef.current += 1;
    if (mountedRef.current) setSaving(true);
  };

  const endSave = () => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current === 0 && mountedRef.current) setSaving(false);
  };

  const enqueue = (task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task, task).then(() => undefined, (queueError: unknown) => {
      console.error('course node editor queue failed', { courseNodeId: nodeId, stage: 'queue', error: queueError });
    });
  };

  const runMutation = async (
    base: CourseNodeEditorSnapshot,
    mutation: CourseNodeMutation,
  ): Promise<CourseNodeEditorSnapshot | null> => {
    beginSave();
    if (mountedRef.current) setError('');
    const previous = structuredClone(base);
    const optimistic = applyCourseNodeMutation(previous, mutation);
    if (optimistic) {
      snapshotRef.current = optimistic;
      if (mountedRef.current) setSnapshot(optimistic);
    }
    try {
      const form = new URLSearchParams();
      form.set('operation', mutation.operation);
      form.set('payload', JSON.stringify(courseNodeFormPayload(base, mutation)));
      const raw = await postForm(`/mindmap/${encodeURIComponent(nodeId)}/nodes`, form, '节点保存失败');
      const next = parseCourseNodeEditorSnapshot(raw);
      if (next.courseNode.id !== base.courseNode.id) throw new Error('课程节点与保存结果不一致');
      replaceSnapshot(next);
      if (mountedRef.current) setSavedClock(formatSavedClock(nowRef.current));
      return next;
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : '节点保存失败';
      console.error('course node editor save failed', {
        operation: mutation.operation,
        courseNodeId: nodeId,
        stage: 'save',
        error: cause,
      });
      snapshotRef.current = previous;
      if (mountedRef.current) {
        setSnapshot(previous);
        setError(message);
      }
      try {
        const raw = await getJson(`/mindmap/${encodeURIComponent(nodeId)}/edit`, '课程节点加载失败');
        const loaded = parseCourseNodeEditorSnapshot(raw);
        if (loaded.courseNode.id !== nodeId) throw new Error('课程节点与请求不一致');
        replaceSnapshot(loaded);
      } catch (reloadError) {
        console.error('course node editor reload failed', { courseNodeId: nodeId, stage: 'reload', error: reloadError });
      }
      return null;
    } finally {
      endSave();
    }
  };

  const selectNode = (id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setRenamingId(null);
    setError('');
    setPickerOpen(false);
    setSheetError('');
    const node = id ? snapshotRef.current?.nodes.find((item) => item._id === id) ?? null : null;
    setDraftTopic(node?.topic ?? '');
    setDraftDescription(node?.description ?? '');
    setDraftColor(node?.color ?? '');
  };

  const focusChildName = () => {
    window.requestAnimationFrame(() => childInputRef.current?.focus());
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (providedRef.current && providedRef.current.courseNode.id === nodeId) return undefined;
    let cancelled = false;
    setLoadError('');
    void getJson(`/mindmap/${encodeURIComponent(nodeId)}/edit`, '课程节点加载失败')
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseCourseNodeEditorSnapshot(raw);
        if (parsed.courseNode.id !== nodeId) throw new Error('课程节点与请求不一致');
        snapshotRef.current = parsed;
        selectedIdRef.current = parsed.courseNode.id;
        setSnapshot(parsed);
        setSelectedId(parsed.courseNode.id);
        setExpanded(parentNodeIds(parsed.nodes));
        setRenamingId(null);
        setDraftTopic(parsed.nodes.find((node) => node._id === parsed.courseNode.id)?.topic ?? parsed.courseNode.title);
        setDraftDescription('');
        setDraftColor('');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error && cause.message ? cause.message : '课程节点加载失败';
        console.error('course node editor load failed', { courseNodeId: nodeId, stage: 'load', error: cause });
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const selected = snapshot && selectedId ? snapshot.nodes.find((node) => node._id === selectedId) ?? null : null;
  const canEdit = snapshot?.canEdit === true;
  const mapId = snapshot?.config._id ?? '';

  useEffect(() => {
    if (!selected) return;
    if (!topicFocused.current) setDraftTopic(selected.topic);
    if (!descriptionFocused.current) setDraftDescription(selected.description ?? '');
    setDraftColor(selected.color ?? '');
  }, [selected]);

  useEffect(() => {
    if (!mapId || !selectedId) return undefined;
    let cancelled = false;
    setListLoading(true);
    setListError('');
    void getJson(
      `/api/mindmap/problems?mapId=${encodeURIComponent(mapId)}&nodeId=${encodeURIComponent(selectedId)}`,
      '关联题目加载失败',
    )
      .then((raw) => {
        if (cancelled) return;
        const problems = parseListedProblems(raw);
        for (const problem of problems) {
          labelsRef.current.set(String(problem.docId), { pid: problem.pid, title: problem.title });
        }
        setListed({ nodeId: selectedId, problems });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error && cause.message ? cause.message : '关联题目加载失败';
        console.error('course node editor problems failed', { courseNodeId: nodeId, nodeId: selectedId, stage: 'problems', error: cause });
        setListed(null);
        setListError(message);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, nodeId, selectedId, serverRevision]);

  const courseTitle = snapshot?.courseNode.title;
  useEffect(() => {
    if (courseTitle !== undefined) onCourseTitleChangeRef.current?.(courseTitle);
  }, [courseTitle]);

  const emphasizedIds = useMemo(
    () => (snapshot ? emphasizedNodeIds(snapshot.nodes, search) : undefined),
    [snapshot, search],
  );
  const canvasConfig = useMemo((): KnowledgeMap | null => {
    if (!snapshot) return null;
    return { ...snapshot.config, rootNodeId: snapshot.courseNode.id };
  }, [snapshot]);
  const chapter = selected && chapters ? chapterForNode(chapters, selected._id) : null;
  const inPaper = useMemo(() => {
    const ids = new Set<number>();
    if (!selected) return ids;
    for (const docId of selected.problemIds) {
      const numeric = Number(docId);
      if (positiveDocId(numeric)) ids.add(numeric);
    }
    return ids;
  }, [selected]);
  const collected = selected ? selected.problemIds.map((docId) => {
    const label = labelsRef.current.get(docId);
    return { docId, pid: label?.pid ?? docId, title: label?.title ?? docId };
  }) : [];
  const referenceCount = selected && snapshot ? snapshot.referenceCounts[selected._id] ?? 0 : 0;

  const commitTopic = (id: string, topic: string) => {
    if (!canEdit) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const node = current?.nodes.find((item) => item._id === id);
      if (!current?.canEdit || !node) return;
      const nextTopic = topic.trim();
      if (!nextTopic) {
        if (mountedRef.current) {
          setError('节点名称不能为空');
          setDraftTopic(node.topic);
        }
        return;
      }
      const mutation = renameMutation(current, id, nextTopic);
      if (!mutation) return;
      await runMutation(current, mutation);
    });
  };

  const commitDescription = (id: string, description: string) => {
    if (!canEdit) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const node = current?.nodes.find((item) => item._id === id);
      if (!current?.canEdit || !node || description === (node.description ?? '')) return;
      await runMutation(current, {
        operation: 'update',
        body: {
          id: node._id,
          expectedUpdatedAt: node.updatedAt,
          fields: { description },
        },
      });
    });
  };

  const commitColor = (id: string, color: string) => {
    if (!canEdit) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const node = current?.nodes.find((item) => item._id === id);
      if (!current?.canEdit || !node || color === (node.color ?? '')) return;
      await runMutation(current, {
        operation: 'update',
        body: {
          id: node._id,
          expectedUpdatedAt: node.updatedAt,
          fields: { color },
        },
      });
    });
  };

  const includeProblems = (items: readonly TeachBankItem[]) => {
    const additions: string[] = [];
    for (const item of items) {
      if (!positiveDocId(item.docId)) {
        const invalid = new Error('收录题编号无效');
        console.error('course node editor rejected a collected problem', { docId: item.docId, stage: 'include', error: invalid });
        setSheetError(invalid.message);
        return;
      }
      const docId = String(item.docId);
      labelsRef.current.set(docId, { pid: item.pid, title: item.title });
      additions.push(docId);
    }
    const id = selectedIdRef.current;
    if (!id) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const node = current?.nodes.find((item) => item._id === id);
      if (!current?.canEdit || !node) return;
      const next = nextProblemIds(node.problemIds, additions);
      if (next.overflow && mountedRef.current) setSheetError(`收录题最多 ${MAX_INCLUDED} 道`);
      else if (mountedRef.current) setSheetError('');
      if (next.ids.length === node.problemIds.length && next.ids.every((docId, index) => docId === node.problemIds[index])) return;
      await runMutation(current, {
        operation: 'update',
        body: {
          id: node._id,
          expectedUpdatedAt: node.updatedAt,
          fields: { problemIds: next.ids },
        },
      });
    });
  };

  const removeCollected = (docId: string) => {
    const id = selectedIdRef.current;
    if (!id || !canEdit) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const node = current?.nodes.find((item) => item._id === id);
      if (!current?.canEdit || !node) return;
      const problemIds = node.problemIds.filter((item) => item !== docId);
      await runMutation(current, {
        operation: 'update',
        body: {
          id: node._id,
          expectedUpdatedAt: node.updatedAt,
          fields: { problemIds },
        },
      });
    });
  };

  const addChild = () => {
    const topic = childTopic.trim();
    const parentId = selectedIdRef.current;
    if (!topic || !parentId || !canEdit) return;
    enqueue(async () => {
      const current = snapshotRef.current;
      const mutation = current ? childMutation(current, parentId, topic) : null;
      if (!current?.canEdit || !mutation) return;
      const next = await runMutation(current, mutation);
      if (!next || !mountedRef.current) return;
      setChildTopic('');
      const created = createdNodeId(current, next, mutationParentId(mutation), mutationTopic(mutation));
      if (!created) return;
      selectedIdRef.current = created;
      setSelectedId(created);
      const opened = ancestorIds(next.nodes, created);
      setExpanded((open) => new Set([...open, ...opened]));
      setCanvasCollapsed((closed) => withoutIds(closed, opened));
      setRenamingId(created);
    });
  };

  const createRelative = (kind: 'child' | 'sibling', id: string) => {
    enqueue(async () => {
      const current = snapshotRef.current;
      if (!current?.canEdit) return;
      const mutation = kind === 'child' ? childMutation(current, id) : siblingMutation(current, id);
      if (!mutation) return;
      const next = await runMutation(current, mutation);
      if (!next || !mountedRef.current) return;
      const created = createdNodeId(current, next, mutationParentId(mutation), mutationTopic(mutation));
      if (!created) return;
      // Open every ancestor, not just the parent: a collapsed course node would hide the new node and its rename field.
      const opened = ancestorIds(next.nodes, created);
      setExpanded((open) => new Set([...open, ...opened]));
      setCanvasCollapsed((closed) => withoutIds(closed, opened));
      selectedIdRef.current = created;
      setSelectedId(created);
      setRenamingId(created);
    });
  };

  const confirmRemove = async (node: MindmapNode) => {
    const current = snapshotRef.current;
    if (!current?.canEdit) return;
    if (node._id === current.courseNode.id) {
      setError('课程节点不能在这里删除。');
      return;
    }
    const accepted = await confirmDialog('它的收录题会一起删除。', {
      title: `删除节点「${node.topic.trim() || '此节点'}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    enqueue(async () => {
      const latest = snapshotRef.current;
      const target = latest?.nodes.find((item) => item._id === node._id);
      if (!latest?.canEdit || !target || target._id === latest.courseNode.id) return;
      const parentId = target.parentId && latest.nodes.some((item) => item._id === target.parentId)
        ? target.parentId
        : latest.courseNode.id;
      const next = await runMutation(latest, {
        operation: 'delete',
        body: { id: target._id, expectedUpdatedAt: target.updatedAt },
      });
      if (!next || !mountedRef.current) return;
      selectedIdRef.current = parentId;
      setSelectedId(parentId);
    });
  };

  const onMove = (node: MindmapNode, move: PlannedMove) => {
    enqueue(async () => {
      const current = snapshotRef.current;
      if (!current?.canEdit) return;
      if (node._id === current.courseNode.id) {
        if (mountedRef.current) setError('课程节点不能在这里移动。');
        return;
      }
      const mutation = moveMutation(current, node._id, move);
      if (!mutation) {
        const targetInCourse = current.nodes.some((item) => item._id === move.newParentId);
        if (!targetInCourse && mountedRef.current) setError('不能把节点移出这门课。');
        return;
      }
      await runMutation(current, mutation);
    });
  };

  const shell = (
    <div className={cn('flex w-full min-w-0 flex-1 flex-col gap-3', className, 'min-h-140')}>
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}
      {!snapshot && !loadError ? <p className="text-sm text-fg-muted">正在加载课程节点…</p> : null}
      {snapshot && canvasConfig ? (
        <>
          <div className="flex min-w-0 items-center justify-between gap-3">
            {saving || savedClock ? (
              <p className="min-w-0 text-xs text-fg-subtle tabular">{saving ? '正在保存…' : `已保存 · ${savedClock}`}</p>
            ) : <span />}
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!canEdit ? <Alert tone="info">{READONLY_NOTICE}</Alert> : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
            <section aria-label="大纲" className="flex min-h-80 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface xl:w-60 xl:shrink-0 3xl:w-75">
              <MindmapOutline
                nodes={snapshot.nodes}
                rootId={snapshot.courseNode.id}
                selectedId={selectedId}
                expanded={expanded}
                referenceCounts={snapshot.referenceCounts}
                emphasizedIds={emphasizedIds}
                busy={!canEdit || saving}
                onSelect={selectNode}
                onExpandedChange={setExpanded}
                onMove={onMove}
                onCreateChild={(node) => {
                  if (!canEdit) return;
                  selectNode(node._id);
                  setChildTopic('');
                  focusChildName();
                }}
                onCreateSibling={(node) => {
                  if (!canEdit) return;
                  const parent = node.parentId ? snapshot.nodes.find((item) => item._id === node.parentId) ?? null : null;
                  if (!parent) {
                    setError('课程节点不能在这里新增同级。');
                    return;
                  }
                  selectNode(parent._id);
                  setChildTopic('');
                  focusChildName();
                }}
                onDelete={(node) => {
                  if (!canEdit) return;
                  void confirmRemove(node);
                }}
              />
            </section>
            <section aria-label="画布" className="relative min-h-96 min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
              {/* min-height does not resolve MindmapCanvas h-full; this box does. */}
              <div className="absolute inset-0">
              <MindmapCanvas
                nodes={snapshot.nodes}
                config={canvasConfig}
                selectedId={selectedId}
                onSelect={selectNode}
                collapsed={canvasCollapsed}
                onCollapsedChange={setCanvasCollapsed}
                fitMaxZoom={1}
                emphasizedIds={emphasizedIds}
                counts={snapshot.referenceCounts}
                editable={canEdit}
                renamingId={canEdit ? renamingId : null}
                onRenameStart={(id) => {
                  if (!snapshotRef.current?.canEdit) return;
                  selectNode(id);
                  setRenamingId(id);
                }}
                onRenameCommit={(id, title) => {
                  setRenamingId(null);
                  enqueue(async () => {
                    const current = snapshotRef.current;
                    if (!current?.canEdit) return;
                    const mutation = renameMutation(current, id, title);
                    if (!mutation) return;
                    await runMutation(current, mutation);
                  });
                }}
                onRenameCancel={() => setRenamingId(null)}
                onMoveInto={(dragId, targetId) => {
                  enqueue(async () => {
                    const current = snapshotRef.current;
                    if (!current?.canEdit) return;
                    const mutation = moveIntoMutation(current, dragId, targetId);
                    if (!mutation) {
                      if (dragId === current.courseNode.id && mountedRef.current) setError('课程节点不能在这里移动。');
                      if (mountedRef.current) setSnapshot({ ...current, nodes: current.nodes.slice() });
                      return;
                    }
                    await runMutation(current, mutation);
                  });
                }}
                onKeyCommand={(command, id) => {
                  if (!snapshotRef.current?.canEdit) return;
                  if (command === 'delete') {
                    const node = snapshotRef.current.nodes.find((item) => item._id === id);
                    if (node) void confirmRemove(node);
                    return;
                  }
                  createRelative(command, id);
                }}
              />
              </div>
              {canEdit ? (
                <p className="pointer-events-none absolute inset-x-14 bottom-3 z-10 rounded-md border border-line bg-surface px-3 py-1.5 text-center text-xs text-fg-subtle">
                  {HINT}
                </p>
              ) : null}
            </section>
            <section aria-label="知识点属性" className="flex min-h-0 w-full min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-surface p-4 xl:w-75 xl:shrink-0 3xl:w-90">
              {selected ? (
                <>
                  <FormField label="节点名称">
                    <Input
                      value={draftTopic}
                      readOnly={!canEdit}
                      onFocus={() => {
                        topicFocused.current = true;
                      }}
                      onChange={(event) => setDraftTopic(event.target.value)}
                      onBlur={(event) => {
                        topicFocused.current = false;
                        commitTopic(selected._id, event.target.value);
                      }}
                    />
                  </FormField>
                  <FormField label="说明">
                    <Textarea
                      value={draftDescription}
                      readOnly={!canEdit}
                      rows={3}
                      onFocus={() => {
                        descriptionFocused.current = true;
                      }}
                      onChange={(event) => setDraftDescription(event.target.value)}
                      onBlur={(event) => {
                        descriptionFocused.current = false;
                        commitDescription(selected._id, event.target.value);
                      }}
                    />
                  </FormField>
                  <FormField label="颜色">
                    <SimpleSelect
                      value={draftColor}
                      disabled={!canEdit}
                      onValueChange={(value) => {
                        setDraftColor(value);
                        commitColor(selected._id, value);
                      }}
                      options={COLORS}
                      ariaLabel="节点颜色"
                    />
                  </FormField>
                  {chapters ? (
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">对应章节</span>
                      {chapter ? (
                        onOpenChapter ? (
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto justify-start whitespace-normal text-left"
                            onClick={() => onOpenChapter(chapter.chapterId, chapter.sectionId)}
                          >
                            {chapter.label}
                          </Button>
                        ) : (
                          <p className="text-sm text-fg">{chapter.label}</p>
                        )
                      ) : (
                        <p className="text-sm text-fg-muted">{NO_CHAPTER}</p>
                      )}
                    </div>
                  ) : null}
                  <div className="grid gap-2">
                    <MiniTabs
                      aria-label="知识点题目"
                      value={problemTab}
                      onValueChange={setProblemTab}
                      items={[
                        { value: 'all', label: '全部', count: referenceCount },
                        { value: 'collected', label: '收录', count: selected.problemIds.length },
                      ]}
                    />
                    {problemTab === 'all' ? (
                      listLoading ? <p className="text-sm text-fg-muted">正在加载…</p> : null
                    ) : null}
                    {listError ? <Alert tone="danger">{listError}</Alert> : null}
                    {problemTab === 'all' && listed?.nodeId === selected._id ? (
                      listed.problems.length ? (
                        <ul className="grid gap-1">
                          {listed.problems.map((problem) => (
                            <li key={problem.docId}>
                              <a href={mindmapProblemHref(problem)} className="flex min-h-12 min-w-0 items-center rounded-md px-2 py-2 hover:bg-surface-hover">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-fg">{problem.title}</span>
                                  <span className="block truncate font-mono text-xs text-fg-subtle">{problem.pid}</span>
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        !listLoading && !listError ? <p className="text-sm text-fg-muted">这个知识点下还没有题</p> : null
                      )
                    ) : null}
                    {problemTab === 'collected' ? (
                      <>
                        {collected.length ? (
                          <div className="grid gap-1.5">
                            {collected.map((item) => (
                              <div key={item.docId} className="flex min-h-12 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-fg">{item.title}</span>
                                  <span className="block truncate font-mono text-xs text-fg-subtle">{item.pid}</span>
                                </span>
                                {canEdit ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    className="shrink-0"
                                    disabled={saving}
                                    aria-label={`移出 ${item.pid}`}
                                    onClick={() => removeCollected(item.docId)}
                                  >
                                    <Unlink />
                                  </Button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-fg-muted">还没有收录题</p>
                        )}
                        <p className="text-xs text-fg-subtle">收录题：把不是挂在这个知识点上的题也算进来</p>
                        {canEdit ? (
                          <div>
                            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setPickerOpen(true)}>
                              从题库收录
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      {selected._id !== snapshot.courseNode.id ? (
                        <Button type="button" variant="danger-soft" size="sm" disabled={saving} onClick={() => void confirmRemove(selected)}>
                          <Trash2 />
                          删除节点
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {canEdit ? (
                    <div className="grid gap-1.5 border-t border-line-subtle pt-3">
                      <span className="text-sm font-medium text-fg">子节点</span>
                      <div className="flex gap-2">
                        <Input
                          ref={childInputRef}
                          aria-label="子节点名称"
                          value={childTopic}
                          onChange={(event) => setChildTopic(event.target.value)}
                          placeholder="新节点名称"
                          className="min-w-0"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          disabled={saving || !childTopic.trim()}
                          onClick={addChild}
                        >
                          <Plus />
                          添加
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-fg-muted">选择一个节点后编辑。</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <ReactFlowProvider>
      {shell}
      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setSheetError('');
        }}
      >
        <SheetContent side="right" className="md:max-w-xl">
          <SheetHeader>
            <SheetTitle>收录题</SheetTitle>
            <p className="mt-1 text-sm text-fg-muted">从题库选择要算进这个知识点的题。</p>
          </SheetHeader>
          {sheetError ? (
            <div className="shrink-0 px-5 pt-3">
              <Alert tone="danger">{sheetError}</Alert>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <DndContext>
              <BankPane
                type="homework"
                locked={saving || !canEdit}
                inPaper={inPaper}
                selection={selection}
                onToggleSelect={(docId, on) => {
                  setSelection((current) => {
                    const next = new Set(current);
                    if (on) next.add(docId);
                    else next.delete(docId);
                    return next;
                  });
                }}
                onClearSelection={() => setSelection(new Set())}
                onAdd={(items) => {
                  includeProblems(items);
                  setSelection(new Set());
                }}
                onCreateObjective={() => {
                  setSheetError('收录题只从题库选择。新建题目请去出题中心。');
                }}
                onItemsLoaded={(items) => {
                  for (const item of items) {
                    if (!positiveDocId(item.docId)) continue;
                    labelsRef.current.set(String(item.docId), { pid: item.pid, title: item.title });
                  }
                }}
                refreshToken={0}
              />
            </DndContext>
          </div>
        </SheetContent>
      </Sheet>
    </ReactFlowProvider>
  );
}
