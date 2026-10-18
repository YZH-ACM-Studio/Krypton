import { DndContext } from '@dnd-kit/core';
import { ReactFlowProvider } from '@xyflow/react';
import { Plus, Trash2, Unlink } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { useBootstrap } from '@/lib/bootstrap';
import { BankPane } from '@/pages/teach/compose/bank-pane';
import type { TeachBankItem } from '@/pages/teach/model';
import { postForm } from '@/pages/teach/api';
import { MindmapCanvas } from '../mindmap/canvas';
import { MindmapOutline } from '../mindmap/outline';
import type { PlannedMove } from '../mindmap/tree';
import { readMindmapSnapshot, type KnowledgeMap, type MindmapNode } from '../mindmap/types';

interface CourseNodeView {
  id: string;
  title: string;
  order: number;
  visibility: 'public' | 'hidden';
  ownerUids: number[];
}

interface CourseEditorPayload {
  courseNode: CourseNodeView;
  nodes: MindmapNode[];
  referenceCounts: Record<string, number>;
  config: KnowledgeMap;
}

interface CollectedProblem {
  docId: string;
  pid: string;
  title: string;
}

interface ProblemLabel {
  pid: string;
  title: string;
}

const MAX_INCLUDED = 200;
const COURSE_NODE_INVALID = '服务器返回的课程节点格式无效';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readCourseNode(value: unknown): CourseNodeView {
  if (!isRecord(value)) throw new Error(COURSE_NODE_INVALID);
  const { id, title, order, visibility, ownerUids } = value;
  if (typeof id !== 'string' || id.length === 0) throw new Error(COURSE_NODE_INVALID);
  if (typeof title !== 'string' || title.length === 0) throw new Error(COURSE_NODE_INVALID);
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error(COURSE_NODE_INVALID);
  if (visibility !== 'public' && visibility !== 'hidden') throw new Error(COURSE_NODE_INVALID);
  if (!Array.isArray(ownerUids)) throw new Error(COURSE_NODE_INVALID);
  const owners: number[] = [];
  for (const uid of ownerUids) {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) throw new Error(COURSE_NODE_INVALID);
    owners.push(uid);
  }
  return { id, title, order, visibility, ownerUids: owners };
}

function readCourseEditorPayload(value: unknown): CourseEditorPayload {
  const snapshot = readMindmapSnapshot(value);
  if (!snapshot.config) throw new Error('服务器返回的当前导图格式无效');
  if (!isRecord(value) || !Object.hasOwn(value, 'courseNode')) throw new Error(COURSE_NODE_INVALID);
  const courseNode = readCourseNode(value.courseNode);
  const course = snapshot.nodes.find((node) => node._id === courseNode.id);
  if (!course) throw new Error('课程节点不在子树里');
  if (course.parentId !== snapshot.config.rootNodeId) throw new Error('课程节点不在知识图谱总根下');
  for (const node of snapshot.nodes) {
    if (snapshot.referenceCounts[node._id] === undefined) throw new Error('服务器未返回节点引用状态');
  }
  return {
    courseNode,
    nodes: snapshot.nodes,
    referenceCounts: snapshot.referenceCounts,
    config: snapshot.config,
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function describeCollected(ids: readonly string[], known: ReadonlyMap<string, ProblemLabel>): CollectedProblem[] {
  return ids.map((docId) => {
    const label = known.get(docId);
    return { docId, pid: label?.pid ?? docId, title: label?.title ?? docId };
  });
}

function draftFields(
  node: MindmapNode,
  topic: string,
  description: string,
  color: string,
  problemIds: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const nextTopic = topic.trim();
  if (nextTopic !== node.topic) fields.topic = nextTopic;
  if (description !== (node.description || '')) fields.description = description;
  if (color !== (node.color || '')) fields.color = color;
  if (!sameIds(problemIds, node.problemIds)) fields.problemIds = problemIds;
  return fields;
}

function positiveDocId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function CourseNodeMindmapEditPage() {
  const bootstrap = useBootstrap();
  const labels = useRef(new Map<string, ProblemLabel>());
  const [payload, setPayload] = useState(() => readCourseEditorPayload(bootstrap.page.data));
  const initialNode = payload.nodes.find((node) => node._id === payload.courseNode.id) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialNode?._id ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialNode ? [initialNode._id] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [topic, setTopic] = useState(initialNode?.topic || '');
  const [description, setDescription] = useState(initialNode?.description || '');
  const [color, setColor] = useState(initialNode?.color || '');
  const [collected, setCollected] = useState<CollectedProblem[]>(() => describeCollected(initialNode?.problemIds || [], labels.current));
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [childTopic, setChildTopic] = useState('');
  const mutationInFlight = useRef(false);

  const byId = useMemo(() => new Map(payload.nodes.map((node) => [node._id, node])), [payload.nodes]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const courseId = payload.courseNode.id;
  const canvasConfig = useMemo(
    (): KnowledgeMap => ({ ...payload.config, rootNodeId: courseId }),
    [courseId, payload.config],
  );
  const inPaper = useMemo(() => {
    const ids = new Set<number>();
    for (const item of collected) {
      const docId = Number(item.docId);
      if (positiveDocId(docId)) ids.add(docId);
    }
    return ids;
  }, [collected]);
  const dirty = selected
    ? Object.keys(draftFields(selected, topic, description, color, collected.map((item) => item.docId))).length > 0
    : false;
  const { guardDialog } = useUnsavedChangesGuard(dirty || busy);

  const applyNode = (node: MindmapNode | null) => {
    setSelectedId(node?._id || null);
    setTopic(node?.topic || '');
    setDescription(node?.description || '');
    setColor(node?.color || '');
    setCollected(node ? describeCollected(node.problemIds, labels.current) : []);
    setSelection(new Set());
    setPickerOpen(false);
    setSheetError('');
  };

  const applyPayload = (next: CourseEditorPayload, preferId: string | null) => {
    setPayload(next);
    const current = (preferId && next.nodes.find((node) => node._id === preferId))
      || next.nodes.find((node) => node._id === next.courseNode.id)
      || null;
    applyNode(current);
    if (current) setSelectedId(current._id);
  };

  const rejectUnsaved = () => {
    if (!dirty) return false;
    setError('请先保存节点');
    return true;
  };

  const selectNode = (id: string | null) => {
    if (id === selectedId) return;
    if (rejectUnsaved()) return;
    applyNode(id ? byId.get(id) || null : null);
  };

  const mutate = async (
    operation: 'create' | 'update' | 'move' | 'delete',
    body: Record<string, unknown>,
    preferId: string | null,
  ): Promise<CourseEditorPayload | null> => {
    if (mutationInFlight.current) return null;
    mutationInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const form = new URLSearchParams();
      form.set('operation', operation);
      form.set('payload', JSON.stringify({
        mapId: payload.config._id,
        expectedMapUpdatedAt: payload.config.updatedAt,
        ...body,
      }));
      const raw = await postForm(`/mindmap/${encodeURIComponent(courseId)}/nodes`, form, '节点保存失败');
      const next = readCourseEditorPayload(raw);
      applyPayload(next, preferId);
      const saved = operation === 'create' ? '已添加节点' : operation === 'delete' ? '已删除节点' : operation === 'move' ? '已移动节点' : '已保存节点';
      toast.success(saved);
      return next;
    } catch (cause) {
      console.error('course node editor save failed', { operation, courseNodeId: courseId, error: cause });
      setError(cause instanceof Error && cause.message ? cause.message : '节点保存失败');
      return null;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const saveNode = async () => {
    if (!selected || busy) return;
    if (!topic.trim()) {
      setError('节点名称不能为空');
      return;
    }
    const fields = draftFields(selected, topic, description, color, collected.map((item) => item.docId));
    if (!Object.keys(fields).length) {
      setError('没有可保存的字段');
      return;
    }
    await mutate('update', {
      id: selected._id,
      expectedUpdatedAt: selected.updatedAt,
      fields,
    }, selected._id);
  };

  const createChild = async () => {
    if (rejectUnsaved()) return;
    if (!selected || !childTopic.trim() || busy) return;
    const parentId = selected._id;
    const next = await mutate('create', {
      parentId,
      expectedParentUpdatedAt: selected.updatedAt,
      topic: childTopic.trim(),
    }, parentId);
    if (!next) return;
    setExpanded((current) => new Set(current).add(parentId));
    setChildTopic('');
  };

  const removeNode = async (node = selected) => {
    if (rejectUnsaved()) return;
    if (!node || busy) return;
    if (node._id === courseId) {
      setError('课程节点不能在这里删除。');
      return;
    }
    const accepted = await confirmDialog('它的收录题会一起删除。', {
      title: `删除节点「${node.topic.trim() || '此节点'}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : courseId;
    await mutate('delete', { id: node._id, expectedUpdatedAt: node.updatedAt }, parentId);
  };

  const moveNode = async (node: MindmapNode, move: PlannedMove) => {
    if (rejectUnsaved()) return;
    if (node._id === courseId) {
      setError('课程节点不能在这里移动。');
      return;
    }
    const parent = byId.get(move.newParentId);
    if (!parent) {
      setError('不能把节点移出这门课。');
      return;
    }
    await mutate('move', {
      id: node._id,
      newParentId: parent._id,
      targetIndex: move.targetIndex,
      expectedUpdatedAt: node.updatedAt,
      expectedParentUpdatedAt: parent.updatedAt,
    }, node._id);
  };

  const includeProblems = (items: readonly TeachBankItem[]) => {
    const next = [...collected];
    const seen = new Set(next.map((entry) => entry.docId));
    let overflow = false;
    for (const item of items) {
      if (!positiveDocId(item.docId)) {
        const invalid = new Error('收录题编号无效');
        console.error('course node editor rejected a collected problem', { docId: item.docId, error: invalid });
        setSheetError(invalid.message);
        return;
      }
      const docId = String(item.docId);
      if (seen.has(docId)) continue;
      if (next.length >= MAX_INCLUDED) {
        overflow = true;
        break;
      }
      seen.add(docId);
      labels.current.set(docId, { pid: item.pid, title: item.title });
      next.push({ docId, pid: item.pid, title: item.title });
    }
    if (overflow) setSheetError(`收录题最多 ${MAX_INCLUDED} 道`);
    else setSheetError('');
    setCollected(next);
  };

  const rememberLoaded = (items: readonly TeachBankItem[]) => {
    for (const item of items) {
      if (!positiveDocId(item.docId)) continue;
      labels.current.set(String(item.docId), { pid: item.pid, title: item.title });
    }
  };

  return (
    <ReactFlowProvider>
      <Page width="full">
        <PageHeader
          breadcrumb={(
            <Breadcrumb items={[
              { label: '导图', href: `/mindmap?course=${encodeURIComponent(courseId)}` },
              { label: payload.courseNode.title },
            ]}
            />
          )}
          title={`${payload.courseNode.title} · 知识点`}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid min-h-96 min-w-0 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          <MindmapOutline
            nodes={payload.nodes}
            rootId={courseId}
            selectedId={selectedId}
            expanded={expanded}
            referenceCounts={payload.referenceCounts}
            busy={busy}
            onSelect={selectNode}
            onExpandedChange={setExpanded}
            onMove={(node, move) => void moveNode(node, move)}
            onCreateChild={(node) => {
              if (node._id !== selectedId && rejectUnsaved()) return;
              if (node._id !== selectedId) applyNode(node);
              setChildTopic('');
            }}
            onCreateSibling={(node) => {
              const parent = node.parentId ? byId.get(node.parentId) : null;
              if (!parent) {
                setError('课程节点不能在这里新增同级。');
                return;
              }
              if (parent._id !== selectedId && rejectUnsaved()) return;
              if (parent._id !== selectedId) applyNode(parent);
              setChildTopic('');
            }}
            onDelete={(node) => {
              if (rejectUnsaved()) return;
              void removeNode(node);
            }}
          />
          {/* Specified height: min-height does not resolve MindmapCanvas h-full below xl. */}
          <div className="h-96 min-w-0 overflow-hidden rounded-lg border border-line bg-surface md:h-144">
            <MindmapCanvas nodes={payload.nodes} config={canvasConfig} selectedId={selectedId} onSelect={selectNode} />
          </div>
          <aside className="grid content-start gap-3 rounded-lg border border-line bg-surface p-4">
            {selected ? (
              <>
                <FormField label="节点名称">
                  <Input value={topic} onChange={(event) => setTopic(event.target.value)} />
                </FormField>
                <FormField label="说明">
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
                </FormField>
                <FormField label="颜色">
                  <SimpleSelect value={color} onValueChange={setColor} options={COLORS} ariaLabel="节点颜色" />
                </FormField>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium text-fg">收录题</span>
                  {collected.length ? (
                    <div className="grid gap-1.5">
                      {collected.map((item) => (
                        <div key={item.docId} className="flex min-h-12 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{item.title}</span>
                            <span className="block truncate font-mono text-xs text-fg-subtle">{item.pid}</span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            iconOnly
                            className="shrink-0"
                            disabled={busy}
                            aria-label={`移除 ${item.pid}`}
                            onClick={() => setCollected((current) => current.filter((entry) => entry.docId !== item.docId))}
                          >
                            <Unlink />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-fg-muted">还没有收录题</p>
                  )}
                  <p className="text-xs text-fg-subtle">收录题：把不是挂在这个知识点上的题也算进来</p>
                  <div>
                    <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
                      收录题
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void saveNode()}>
                    保存节点
                  </Button>
                  {selected._id !== courseId ? (
                    <Button type="button" variant="danger-soft" size="sm" disabled={busy} onClick={() => void removeNode()}>
                      <Trash2 />
                      删除节点
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-1.5 border-t border-line-subtle pt-3">
                  <span className="text-sm font-medium text-fg">子节点</span>
                  <div className="flex gap-2">
                    <Input aria-label="子节点名称" value={childTopic} onChange={(event) => setChildTopic(event.target.value)} placeholder="新节点名称" className="min-w-0" />
                    <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={busy || !childTopic.trim()} onClick={() => void createChild()}>
                      <Plus />
                      添加
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">选择一个节点后编辑。</p>
            )}
          </aside>
        </div>
        {guardDialog}
      </Page>
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
                locked={busy}
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
                onItemsLoaded={rememberLoaded}
                refreshToken={0}
              />
            </DndContext>
          </div>
        </SheetContent>
      </Sheet>
    </ReactFlowProvider>
  );
}

/** `pages/course/index.tsx` still re-exports this name. The old template route is gone. */
export const CourseMindmapEditPage = CourseNodeMindmapEditPage;
