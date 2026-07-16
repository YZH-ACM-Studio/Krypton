import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, Check, ChevronLeft, Circle, Loader2, Network, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { mindmapProblemHref, MindmapApiError, mutateMindmap } from './api';
import { initialCollapsedNodes, MindmapCanvas } from './canvas';
import { MindmapInspector } from './inspector';
import { MindmapOutline } from './outline';
import { childrenByParent, nodePath, siblingIndex, type PlannedMove } from './tree';
import type { MindmapNode, MindmapSnapshot, ProblemOption } from './types';

type SaveState = 'saved' | 'saving' | 'failed';
type MobilePane = 'outline' | 'preview' | 'inspector';

interface OperationFailure {
  message: string;
  problems: ProblemOption[];
  status: number;
}

const COLOR_OPTIONS = [
  { value: 'gray', label: '中性灰' },
  { value: 'sky', label: '天空蓝' },
  { value: 'blue', label: '深蓝' },
  { value: 'green', label: '绿色' },
  { value: 'amber', label: '琥珀' },
  { value: 'rose', label: '玫红' },
  { value: 'purple', label: '紫色' },
];

export function AdminMindmapPage() {
  const bootstrap = useBootstrap();
  const initial = bootstrap.page.data as MindmapSnapshot;
  const [snapshot, setSnapshot] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.config.rootNodeId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.config.rootNodeId ? [initial.config.rootNodeId] : []));
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [failure, setFailure] = useState<OperationFailure | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('outline');
  const [createRequest, setCreateRequest] = useState<{ parent: MindmapNode; kind: 'child' | 'sibling' } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<MindmapNode | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState<Set<string>>(() => initialCollapsedNodes(initial.nodes, initial.config.rootNodeId));
  const mutationInFlight = useRef(false);

  const byId = useMemo(() => new Map(snapshot.nodes.map((node) => [node._id, node])), [snapshot.nodes]);
  const byParent = useMemo(() => childrenByParent(snapshot.nodes), [snapshot.nodes]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const busy = saveState === 'saving';

  useEffect(() => {
    if (!selectedId) return;
    setPreviewCollapsed((current) => {
      const next = new Set(current);
      for (const pathNode of nodePath(snapshot.nodes, selectedId)) next.delete(pathNode._id);
      return next;
    });
  }, [selectedId, snapshot.nodes]);

  const selectNode = (id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    const next = new Set(expanded);
    for (const node of nodePath(snapshot.nodes, id)) next.add(node._id);
    setExpanded(next);
  };

  const runMutation = async (
    operation: 'create' | 'update' | 'move' | 'delete',
    payload: Record<string, unknown>,
  ): Promise<MindmapSnapshot | null> => {
    if (mutationInFlight.current) return null;
    mutationInFlight.current = true;
    setSaveState('saving');
    setFailure(null);
    try {
      const next = await mutateMindmap(operation, payload);
      setSnapshot(next);
      setSaveState('saved');
      setSavedAt(new Date());
      return next;
    } catch (error) {
      const apiError = error instanceof MindmapApiError ? error : new MindmapApiError(error instanceof Error ? error.message : '导图操作失败', 500);
      setFailure({ message: apiError.message, problems: apiError.details?.problems || [], status: apiError.status });
      setSaveState('failed');
      return null;
    } finally {
      mutationInFlight.current = false;
    }
  };

  const performMove = async (node: MindmapNode, move: PlannedMove, layoutSide?: 'left' | 'right') => {
    const parent = byId.get(move.newParentId);
    if (!parent) {
      setFailure({ message: '目标父节点不在当前快照中，请刷新页面', problems: [], status: 409 });
      setSaveState('failed');
      return;
    }
    const next = await runMutation('move', {
      id: node._id,
      newParentId: parent._id,
      targetIndex: move.targetIndex,
      ...(layoutSide ? { layoutSide } : {}),
      expectedUpdatedAt: node.updatedAt,
      expectedParentUpdatedAt: parent.updatedAt,
    });
    if (next) {
      setExpanded((current) => new Set(current).add(parent._id));
      setSelectedId(node._id);
    }
  };

  const openCreateChild = (node: MindmapNode) => setCreateRequest({ parent: node, kind: 'child' });
  const openCreateSibling = (node: MindmapNode) => {
    if (!node.parentId) return;
    const parent = byId.get(node.parentId);
    if (parent) setCreateRequest({ parent, kind: 'sibling' });
  };

  const createNode = async (input: { topic: string; description: string; color: string }): Promise<boolean> => {
    if (!createRequest) return false;
    const before = new Set(snapshot.nodes.map((node) => node._id));
    const next = await runMutation('create', {
      parentId: createRequest.parent._id,
      expectedParentUpdatedAt: createRequest.parent.updatedAt,
      topic: input.topic,
      description: input.description,
      color: input.color,
      tags: [],
      problemIds: [],
    });
    if (!next) return false;
    const created = next.nodes.find((node) => !before.has(node._id));
    setCreateRequest(null);
    setExpanded((current) => new Set(current).add(createRequest.parent._id));
    if (created) setSelectedId(created._id);
    return true;
  };

  const deleteNode = async () => {
    if (!deleteRequest) return;
    const parentId = deleteRequest.parentId;
    const next = await runMutation('delete', { id: deleteRequest._id, expectedUpdatedAt: deleteRequest.updatedAt });
    if (!next) return;
    setDeleteRequest(null);
    setSelectedId(parentId && next.nodes.some((node) => node._id === parentId) ? parentId : next.config.rootNodeId);
  };

  const moveSide = (node: MindmapNode, side: 'left' | 'right') => {
    if (!node.parentId) return;
    const index = siblingIndex(snapshot.nodes, node);
    void performMove(node, { newParentId: node.parentId, targetIndex: Math.max(index, 0) }, side);
  };

  return (
    <ReactFlowProvider>
      <div className="flex h-[calc(100dvh-5.75rem)] min-h-[38rem] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
        <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <a
                href="/mindmap"
                className="grid size-9 shrink-0 place-items-center rounded-xl border bg-card text-muted-foreground hover:bg-accent"
                aria-label="返回公开导图"
              >
                <ChevronLeft className="size-4" />
              </a>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Network className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-semibold tracking-tight">导图管理</h1>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {snapshot.nodes.length} 节点
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">结构决定布局；这里不保存任何绝对坐标</p>
              </div>
            </div>
            <SaveStatus state={saveState} savedAt={savedAt} />
          </div>
          <div className="mt-3 lg:hidden">
            <MiniTabs
              value={mobilePane}
              onValueChange={(value) => setMobilePane(value as MobilePane)}
              items={[
                { value: 'outline', label: '大纲' },
                { value: 'preview', label: '预览' },
                { value: 'inspector', label: '检查器' },
              ]}
            />
          </div>
          {failure ? (
            <div
              className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{failure.message}</p>
                {failure.problems.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {failure.problems.map((problem) => (
                      <a
                        key={problem.docId}
                        href={mindmapProblemHref(problem)}
                        className="rounded-md border border-destructive/20 px-2 py-1 text-xs hover:bg-destructive/10"
                      >
                        {problem.pid} · {problem.title}
                      </a>
                    ))}
                  </div>
                ) : null}
                {failure.status >= 500 ? <p className="mt-1.5 text-xs">服务器未能确认最终结果；请先刷新核对，不要重复执行刚才的操作。</p> : null}
                {failure.status === 409 || failure.status >= 500 ? (
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-destructive/20 px-2 py-1 text-xs hover:bg-destructive/10"
                    onClick={() => window.location.reload()}
                  >
                    刷新最新导图
                  </button>
                ) : null}
              </div>
              <button type="button" className="rounded p-1 hover:bg-destructive/10" onClick={() => setFailure(null)} aria-label="关闭错误提示">
                ×
              </button>
            </div>
          ) : null}
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)_23rem]">
          <div className={cn('min-h-0 border-r', mobilePane === 'outline' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col')}>
            <MindmapOutline
              nodes={snapshot.nodes}
              rootId={snapshot.config.rootNodeId}
              selectedId={selectedId}
              expanded={expanded}
              referenceCounts={snapshot.referenceCounts}
              busy={busy}
              onSelect={(id) => selectNode(id)}
              onExpandedChange={setExpanded}
              onMove={(node, move) => void performMove(node, move)}
              onCreateChild={openCreateChild}
              onCreateSibling={openCreateSibling}
              onDelete={setDeleteRequest}
            />
          </div>

          <section className={cn('relative min-h-0 bg-muted/15', mobilePane === 'preview' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col')}>
            <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selected ? selected.topic : '实时预览'}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selected
                    ? nodePath(snapshot.nodes, selected._id)
                        .map((node) => node.topic)
                        .join(' / ')
                    : '选择节点查看路径'}
                </p>
              </div>
              <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">不可拖拽</span>
            </div>
            <div className="min-h-0 flex-1">
              <MindmapCanvas
                nodes={snapshot.nodes}
                config={snapshot.config}
                selectedId={selectedId}
                onSelect={selectNode}
                collapsed={previewCollapsed}
                onCollapsedChange={setPreviewCollapsed}
              />
            </div>
          </section>

          <div className={cn('min-h-0 border-l', mobilePane === 'inspector' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col')}>
            <MindmapInspector
              node={selected}
              nodes={snapshot.nodes}
              rootId={snapshot.config.rootNodeId}
              referenceCount={selected ? snapshot.referenceCounts[selected._id] || 0 : 0}
              busy={busy}
              onSave={async (node, fields) => {
                await runMutation('update', { id: node._id, expectedUpdatedAt: node.updatedAt, fields });
              }}
              onMoveSide={moveSide}
              onCreateChild={openCreateChild}
              onCreateSibling={openCreateSibling}
              onDelete={setDeleteRequest}
            />
          </div>
        </main>
      </div>

      <CreateNodeDialog request={createRequest} busy={busy} onClose={() => setCreateRequest(null)} onSubmit={createNode} />
      <DeleteNodeDialog
        node={deleteRequest}
        childCount={deleteRequest ? (byParent.get(deleteRequest._id) || []).length : 0}
        referenceCount={deleteRequest ? snapshot.referenceCounts[deleteRequest._id] || 0 : 0}
        busy={busy}
        onClose={() => setDeleteRequest(null)}
        onConfirm={deleteNode}
      />
    </ReactFlowProvider>
  );
}

function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-200">
        <Loader2 className="size-3.5 animate-spin" /> 保存中
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
        <AlertCircle className="size-3.5" /> 保存失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-200">
      {savedAt ? <Check className="size-3.5" /> : <Circle className="size-3 fill-current" />}
      {savedAt ? `已保存 ${savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已同步'}
    </span>
  );
}

function CreateNodeDialog({
  request,
  busy,
  onClose,
  onSubmit,
}: {
  request: { parent: MindmapNode; kind: 'child' | 'sibling' } | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { topic: string; description: string; color: string }) => Promise<boolean>;
}) {
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('gray');
  const close = () => {
    if (busy) return;
    setTopic('');
    setDescription('');
    setColor('gray');
    onClose();
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close()}>
      <DialogContent className="w-full sm:w-[520px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>{request?.kind === 'child' ? '新增子节点' : '新增同级节点'}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">将添加到「{request?.parent.topic}」下方，保存后立即进入树结构。</p>
        </DialogHeader>
        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="create-mindmap-topic" className="text-xs font-medium">
              名称
            </label>
            <Input
              id="create-mindmap-topic"
              value={topic}
              maxLength={100}
              autoFocus
              onChange={(event) => setTopic(event.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <label htmlFor="create-mindmap-description" className="text-xs font-medium">
              说明（可选）
            </label>
            <Textarea
              id="create-mindmap-description"
              value={description}
              maxLength={2000}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1.5 resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium">颜色</label>
            <SimpleSelect value={color} onValueChange={setColor} options={COLOR_OPTIONS} className="mt-1.5" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            disabled={busy || !topic.trim()}
            onClick={async () => {
              const created = await onSubmit({ topic, description, color });
              if (created) {
                setTopic('');
                setDescription('');
                setColor('gray');
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 创建节点
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteNodeDialog({
  node,
  childCount,
  referenceCount,
  busy,
  onClose,
  onConfirm,
}: {
  node: MindmapNode | null;
  childCount: number;
  referenceCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const blocked = childCount > 0 || referenceCount > 0;
  return (
    <Dialog open={!!node} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-full sm:w-[480px]" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>删除「{node?.topic}」？</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-5 text-sm">
          {blocked ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100">
              当前不能删除：{childCount > 0 ? `仍有 ${childCount} 个子节点` : ''}
              {childCount > 0 && referenceCount > 0 ? '；' : ''}
              {referenceCount > 0 ? `仍被 ${referenceCount} 道题引用` : ''}。
            </div>
          ) : (
            <p className="leading-6 text-muted-foreground">该操作只删除这个叶子节点，不会删除任何题目。删除后无法在界面中撤销。</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy || blocked} onClick={() => void onConfirm()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
