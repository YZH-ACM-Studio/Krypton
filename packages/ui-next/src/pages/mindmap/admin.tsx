import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, Check, ChevronLeft, Circle, Eye, EyeOff, Loader2, Network, Plus, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { mindmapProblemHref, MindmapApiError, mutateKnowledgeMap, mutateMindmap } from './api';
import { initialCollapsedNodes, MindmapCanvas } from './canvas';
import { MindmapInspector } from './inspector';
import { MindmapOutline } from './outline';
import { childrenByParent, nodePath, siblingIndex, type PlannedMove } from './tree';
import type { KnowledgeMap, MindmapNode, MindmapSnapshot, ProblemOption } from './types';

type SaveState = 'saved' | 'saving' | 'failed';
type MobilePane = 'outline' | 'preview' | 'inspector';
type PendingMapAction = { kind: 'switch'; mapId: string } | { kind: 'create' };

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

const LAYOUT_OPTIONS = [
  { value: 'RIGHT', label: '中心向左右展开' },
  { value: 'DOWN', label: '从上向下展开' },
];

type KnowledgeMapWithUsage = KnowledgeMap & {
  usage?: { nodes: number; problems: number; courses: number };
};

export function AdminMindmapPage() {
  const bootstrap = useBootstrap();
  const initial = bootstrap.page.data as MindmapSnapshot;
  const [snapshot, setSnapshot] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.config?.rootNodeId || null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.config?.rootNodeId ? [initial.config.rootNodeId] : []));
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [failure, setFailure] = useState<OperationFailure | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('outline');
  const [createRequest, setCreateRequest] = useState<{ parent: MindmapNode; kind: 'child' | 'sibling' } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<MindmapNode | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState<Set<string>>(() =>
    initialCollapsedNodes(initial.nodes, initial.config?.rootNodeId || null),
  );
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [inspectorResetVersion, setInspectorResetVersion] = useState(0);
  const [pendingMapAction, setPendingMapAction] = useState<PendingMapAction | null>(null);
  const [createMapOpen, setCreateMapOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteMapOpen, setDeleteMapOpen] = useState(false);
  const mutationInFlight = useRef(false);

  const config = snapshot.config;
  const activeMap = config ? snapshot.maps.find((map) => map._id === config._id) || config : null;
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

  const recordFailure = (error: unknown, fallback: string) => {
    const apiError = error instanceof MindmapApiError ? error : new MindmapApiError(error instanceof Error ? error.message : fallback, 500);
    setFailure({ message: apiError.message, problems: apiError.details?.problems || [], status: apiError.status });
    setSaveState('failed');
  };

  const applySnapshot = (next: MindmapSnapshot) => {
    const rootId = next.config?.rootNodeId || null;
    setSnapshot(next);
    setSelectedId(rootId);
    setExpanded(new Set(rootId ? [rootId] : []));
    setPreviewCollapsed(initialCollapsedNodes(next.nodes, rootId));
    setInspectorDirty(false);
    const href = next.config ? `/admin/mindmap?map=${encodeURIComponent(next.config._id)}` : '/admin/mindmap';
    window.history.replaceState(null, '', href);
  };

  const runMutation = async (
    operation: 'create' | 'update' | 'move' | 'delete',
    payload: Record<string, unknown>,
  ): Promise<MindmapSnapshot | null> => {
    if (!config) {
      setFailure({ message: '请先创建一张导图', problems: [], status: 409 });
      setSaveState('failed');
      return null;
    }
    if (mutationInFlight.current) return null;
    mutationInFlight.current = true;
    setSaveState('saving');
    setFailure(null);
    try {
      const next = await mutateMindmap(operation, {
        ...payload,
        mapId: config._id,
        expectedMapUpdatedAt: config.updatedAt,
      });
      setSnapshot(next);
      setSaveState('saved');
      setSavedAt(new Date());
      return next;
    } catch (error) {
      recordFailure(error, '节点操作失败');
      return null;
    } finally {
      mutationInFlight.current = false;
    }
  };

  const runMapMutation = async (operation: 'create' | 'update' | 'delete', payload: Record<string, unknown>): Promise<MindmapSnapshot | null> => {
    if (mutationInFlight.current) return null;
    mutationInFlight.current = true;
    setSaveState('saving');
    setFailure(null);
    try {
      const next = await mutateKnowledgeMap(operation, payload);
      if (operation === 'update') {
        setSnapshot(next);
        if (next.config) window.history.replaceState(null, '', `/admin/mindmap?map=${encodeURIComponent(next.config._id)}`);
      } else {
        applySnapshot(next);
      }
      setSaveState('saved');
      setSavedAt(new Date());
      return next;
    } catch (error) {
      recordFailure(error, '导图操作失败');
      return null;
    } finally {
      mutationInFlight.current = false;
    }
  };

  const performMapAction = (action: PendingMapAction) => {
    setPendingMapAction(null);
    if (action.kind === 'create' && inspectorDirty) setInspectorResetVersion((version) => version + 1);
    setInspectorDirty(false);
    if (action.kind === 'create') {
      setCreateMapOpen(true);
      return;
    }
    window.location.assign(`/admin/mindmap?map=${encodeURIComponent(action.mapId)}`);
  };

  const requestMapAction = (action: PendingMapAction) => {
    if (action.kind === 'switch' && action.mapId === config?._id) return;
    if (inspectorDirty) {
      setPendingMapAction(action);
      return;
    }
    performMapAction(action);
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
    setSelectedId(parentId && next.nodes.some((node) => node._id === parentId) ? parentId : next.config?.rootNodeId || null);
  };

  const moveSide = (node: MindmapNode, side: 'left' | 'right') => {
    if (!node.parentId) return;
    const index = siblingIndex(snapshot.nodes, node);
    void performMove(node, { newParentId: node.parentId, targetIndex: Math.max(index, 0) }, side);
  };

  return (
    <ReactFlowProvider>
      <div className="flex h-[calc(100dvh-4.5rem)] min-h-[42rem] w-full min-w-0 flex-col gap-4 overflow-hidden sm:h-[calc(100dvh-6rem)] xl:h-[calc(100dvh-7rem)]">
        <header className="shrink-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <a
                href="/mindmap"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/70 text-muted-foreground shadow-sm ring-1 ring-border/60 transition-[background-color,color,box-shadow,scale] duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transition-none"
                aria-label="返回公开导图"
              >
                <ChevronLeft className="size-4" />
              </a>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
                <Network className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-balance">导图管理</h1>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {snapshot.nodes.length} 节点
                  </Badge>
                  {config ? (
                    <Badge variant={config.visibility === 'public' ? 'default' : 'outline'} className="gap-1">
                      {config.visibility === 'public' ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                      {config.visibility === 'public' ? '已公开' : '隐藏中'}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">每张导图独立维护结构与题目标签；节点位置始终由结构自动计算。</p>
              </div>
            </div>
            <SaveStatus state={saveState} savedAt={savedAt} />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card/80 p-2 shadow-sm ring-1 ring-border/60 backdrop-blur">
            <div className="min-w-[15rem] flex-1 sm:max-w-md">
              <SimpleSelect
                ariaLabel="切换知识导图"
                value={config?._id || ''}
                disabled={!snapshot.maps.length || busy}
                onValueChange={(mapId) => requestMapAction({ kind: 'switch', mapId })}
                options={snapshot.maps.map((map) => ({
                  value: map._id,
                  label: `${map.title} · ${map.visibility === 'public' ? '已公开' : '隐藏'}`,
                }))}
                placeholder="尚未创建导图"
                className="h-10 rounded-xl border-0 bg-muted/55 shadow-none"
              />
            </div>
            <Button className="min-h-10 rounded-xl" variant="outline" disabled={busy} onClick={() => requestMapAction({ kind: 'create' })}>
              <Plus className="size-4" /> 新建导图
            </Button>
            <Button className="min-h-10 rounded-xl" variant="outline" disabled={busy || !config} onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" /> 导图设置
            </Button>
            {config?.visibility === 'public' ? (
              <Button className="min-h-10 rounded-xl" variant="ghost" asChild>
                <a href={`/mindmap?map=${encodeURIComponent(config._id)}`}>
                  <Eye className="size-4" /> 查看公开页
                </a>
              </Button>
            ) : null}
          </div>
          <div className="xl:hidden">
            <MiniTabs
              value={mobilePane}
              onValueChange={(value) => setMobilePane(value as MobilePane)}
              size="md"
              fullWidth
              className="h-11"
              aria-label="导图工作区面板"
              items={[
                { value: 'outline', label: '大纲' },
                { value: 'preview', label: '预览' },
                { value: 'inspector', label: '检查器' },
              ]}
            />
          </div>
          {failure ? (
            <div
              className="flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2.5 text-sm text-destructive shadow-sm ring-1 ring-destructive/20"
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
                        className="inline-flex min-h-10 items-center rounded-lg px-3 py-1 text-xs ring-1 ring-destructive/20 transition-[background-color,color,scale] duration-150 ease-out hover:bg-destructive/10 active:scale-[0.96] motion-reduce:transition-none"
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
                    className="mt-2 min-h-10 rounded-lg px-3 py-1 text-xs ring-1 ring-destructive/20 transition-[background-color,color,scale] duration-150 ease-out hover:bg-destructive/10 active:scale-[0.96] motion-reduce:transition-none"
                    onClick={() => window.location.reload()}
                  >
                    刷新最新导图
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="grid size-10 shrink-0 place-items-center rounded-lg transition-[background-color,scale] duration-150 ease-out hover:bg-destructive/10 active:scale-[0.96] motion-reduce:transition-none"
                onClick={() => setFailure(null)}
                aria-label="关闭错误提示"
              >
                ×
              </button>
            </div>
          ) : null}
        </header>

        {config ? (
          <main
            aria-label="导图管理工作区"
            className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[18rem_minmax(18rem,1fr)_20rem] 2xl:grid-cols-[21rem_minmax(0,1fr)_23rem]"
          >
            <aside
              data-mindmap-panel="outline"
              aria-label="结构大纲"
              className={cn(
                'min-h-0 overflow-hidden rounded-[20px] bg-card shadow-sm ring-1 ring-border/60',
                mobilePane === 'outline' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col',
              )}
            >
              <MindmapOutline
                nodes={snapshot.nodes}
                rootId={config.rootNodeId}
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
            </aside>

            <section
              data-mindmap-panel="preview"
              aria-label="实时预览"
              className={cn(
                'relative min-h-0 overflow-hidden rounded-[20px] bg-card shadow-sm ring-1 ring-border/60',
                mobilePane === 'preview' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col',
              )}
            >
              <div className="flex h-14 shrink-0 items-center justify-between px-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selected ? selected.topic : '实时预览'}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selected
                      ? nodePath(snapshot.nodes, selected._id)
                          .map((node) => node.topic)
                          .join(' / ')
                      : '选择节点查看路径'}
                  </p>
                </div>
                <Badge variant="outline" className="ml-3 shrink-0 font-normal text-muted-foreground">
                  自动布局
                </Badge>
              </div>
              <div className="min-h-0 flex-1 p-2 pt-0">
                <div data-mindmap-canvas className="h-full overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/50">
                  <MindmapCanvas
                    nodes={snapshot.nodes}
                    config={config}
                    selectedId={selectedId}
                    onSelect={selectNode}
                    collapsed={previewCollapsed}
                    onCollapsedChange={setPreviewCollapsed}
                  />
                </div>
              </div>
            </section>

            <aside
              data-mindmap-panel="inspector"
              aria-label="节点检查器"
              className={cn(
                'min-h-0 overflow-hidden rounded-[20px] bg-card shadow-sm ring-1 ring-border/60',
                mobilePane === 'inspector' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col',
              )}
            >
              <MindmapInspector
                key={`${config._id}:${inspectorResetVersion}`}
                mapId={config._id}
                node={selected}
                nodes={snapshot.nodes}
                rootId={config.rootNodeId}
                layoutDirection={config.layoutDirection}
                referenceCount={selected ? snapshot.referenceCounts[selected._id] || 0 : 0}
                busy={busy}
                onSave={async (node, fields) => {
                  await runMutation('update', { id: node._id, expectedUpdatedAt: node.updatedAt, fields });
                }}
                onMoveSide={moveSide}
                onCreateChild={openCreateChild}
                onCreateSibling={openCreateSibling}
                onDelete={setDeleteRequest}
                onDirtyChange={setInspectorDirty}
              />
            </aside>
          </main>
        ) : (
          <main className="grid min-h-0 flex-1 place-items-center rounded-[28px] bg-card/80 p-8 text-center shadow-sm ring-1 ring-border/60">
            <div className="max-w-md">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Network className="size-7" />
              </span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">创建第一张知识导图</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                新导图默认隐藏，只包含一个根节点。整理完成并通过结构校验后，再从设置中公开。
              </p>
              <Button className="mt-5 min-h-11 rounded-xl" onClick={() => setCreateMapOpen(true)}>
                <Plus className="size-4" /> 新建导图
              </Button>
            </div>
          </main>
        )}
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
      <CreateMapDialog
        open={createMapOpen}
        busy={busy}
        onClose={() => setCreateMapOpen(false)}
        onSubmit={async (input) => {
          const next = await runMapMutation('create', input);
          if (next) setCreateMapOpen(false);
          return !!next;
        }}
      />
      <MapSettingsDialog
        map={activeMap}
        open={settingsOpen}
        busy={busy}
        onClose={() => setSettingsOpen(false)}
        onDelete={() => {
          setSettingsOpen(false);
          setDeleteMapOpen(true);
        }}
        onSubmit={async (fields) => {
          if (!config) return false;
          const next = await runMapMutation('update', { id: config._id, expectedUpdatedAt: config.updatedAt, fields });
          if (next) setSettingsOpen(false);
          return !!next;
        }}
      />
      <DeleteMapDialog
        map={activeMap}
        open={deleteMapOpen}
        busy={busy}
        dirty={inspectorDirty}
        onClose={() => setDeleteMapOpen(false)}
        onConfirm={async () => {
          if (!config) return;
          const next = await runMapMutation('delete', { id: config._id, expectedUpdatedAt: config.updatedAt });
          if (next) setDeleteMapOpen(false);
        }}
      />
      <UnsavedMapActionDialog
        action={pendingMapAction}
        onClose={() => setPendingMapAction(null)}
        onDiscard={() => pendingMapAction && performMapAction(pendingMapAction)}
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
        <DialogBody className="space-y-4 p-5">
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
              className="mt-1.5 h-10"
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
            <SimpleSelect
              value={color}
              onValueChange={setColor}
              options={COLOR_OPTIONS}
              className="mt-1.5 min-h-10"
              contentClassName="[&_[role=option]]:min-h-10"
            />
          </div>
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            className="min-h-10"
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
        <DialogBody className="space-y-3 p-5 text-sm">
          {blocked ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100">
              当前不能删除：{childCount > 0 ? `仍有 ${childCount} 个子节点` : ''}
              {childCount > 0 && referenceCount > 0 ? '；' : ''}
              {referenceCount > 0 ? `仍被 ${referenceCount} 道题引用` : ''}。
            </div>
          ) : (
            <p className="leading-6 text-muted-foreground">该操作只删除这个叶子节点，不会删除任何题目。删除后无法在界面中撤销。</p>
          )}
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button className="min-h-10" variant="destructive" disabled={busy || blocked} onClick={() => void onConfirm()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateMapDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { title: string; rootTopic: string; layoutDirection: 'RIGHT' | 'DOWN' }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [rootTopic, setRootTopic] = useState('');
  const [layoutDirection, setLayoutDirection] = useState<'RIGHT' | 'DOWN'>('RIGHT');
  const close = () => {
    if (busy) return;
    setTitle('');
    setRootTopic('');
    setLayoutDirection('RIGHT');
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent className="w-full sm:w-[540px]" onClose={busy ? undefined : close}>
        <DialogHeader>
          <DialogTitle>新建知识导图</DialogTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">新导图默认隐藏，创建后可逐步整理节点，再单独公开。</p>
        </DialogHeader>
        <DialogBody className="space-y-4 p-5">
          <div>
            <label htmlFor="create-map-title" className="text-xs font-medium">
              导图名称
            </label>
            <Input
              id="create-map-title"
              value={title}
              maxLength={100}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1.5 h-10"
              placeholder="例如：面向对象程序设计"
            />
          </div>
          <div>
            <label htmlFor="create-map-root" className="text-xs font-medium">
              根节点主题
            </label>
            <Input
              id="create-map-root"
              value={rootTopic}
              maxLength={100}
              onChange={(event) => setRootTopic(event.target.value)}
              className="mt-1.5 h-10"
              placeholder="例如：面向对象"
            />
          </div>
          <div>
            <label className="text-xs font-medium">布局方向</label>
            <SimpleSelect
              value={layoutDirection}
              onValueChange={(value) => setLayoutDirection(value as 'RIGHT' | 'DOWN')}
              options={LAYOUT_OPTIONS}
              className="mt-1.5 min-h-10"
            />
          </div>
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            className="min-h-10"
            disabled={busy || !title.trim() || !rootTopic.trim()}
            onClick={async () => {
              const created = await onSubmit({ title, rootTopic, layoutDirection });
              if (created) {
                setTitle('');
                setRootTopic('');
                setLayoutDirection('RIGHT');
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 创建导图
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MapSettingsDialog({
  map,
  open,
  busy,
  onClose,
  onDelete,
  onSubmit,
}: {
  map: KnowledgeMapWithUsage | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSubmit: (fields: { title: string; layoutDirection: 'RIGHT' | 'DOWN'; visibility: 'hidden' | 'public' }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [layoutDirection, setLayoutDirection] = useState<'RIGHT' | 'DOWN'>('RIGHT');
  const [visibility, setVisibility] = useState<'hidden' | 'public'>('hidden');

  useEffect(() => {
    if (!open || !map) return;
    setTitle(map.title);
    setLayoutDirection(map.layoutDirection);
    setVisibility(map.visibility);
  }, [map, open]);

  const dirty = !!map && (title.trim() !== map.title || layoutDirection !== map.layoutDirection || visibility !== map.visibility);
  return (
    <Dialog open={open && !!map} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="w-full sm:w-[560px]" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>导图设置</DialogTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">公开状态控制学生可见性；根节点名称直接在右侧节点检查器中编辑。</p>
        </DialogHeader>
        <DialogBody className="space-y-4 p-5">
          <div>
            <label htmlFor="map-settings-title" className="text-xs font-medium">
              导图名称
            </label>
            <Input
              id="map-settings-title"
              value={title}
              maxLength={100}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1.5 h-10"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">布局方向</label>
              <SimpleSelect
                value={layoutDirection}
                onValueChange={(value) => setLayoutDirection(value as 'RIGHT' | 'DOWN')}
                options={LAYOUT_OPTIONS}
                className="mt-1.5 min-h-10"
              />
            </div>
            <div>
              <label className="text-xs font-medium">可见性</label>
              <SimpleSelect
                value={visibility}
                onValueChange={(value) => setVisibility(value as 'hidden' | 'public')}
                options={[
                  { value: 'hidden', label: '隐藏，仅管理员可见' },
                  { value: 'public', label: '公开，学生可见' },
                ]}
                className="mt-1.5 min-h-10"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/45 p-3 text-center">
            <MapUsageMetric label="节点" value={map?.usage?.nodes} />
            <MapUsageMetric label="题目" value={map?.usage?.problems} />
            <MapUsageMetric label="课程" value={map?.usage?.courses} />
          </div>
          {visibility === 'public' && map?.visibility === 'hidden' ? (
            <p className="rounded-xl bg-blue-500/10 p-3 text-xs leading-5 text-blue-800 ring-1 ring-blue-500/20 dark:text-blue-200">
              发布时服务器会验证根节点、父子关系与整棵树的可达性；校验失败不会改变公开状态。
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
            <div>
              <p className="text-sm font-medium text-destructive">删除整张导图</p>
              <p className="mt-0.5 text-xs text-muted-foreground">仅隐藏、只剩根节点且没有题目或课程引用时可用。</p>
            </div>
            <Button className="min-h-10 shrink-0" variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 className="size-4" /> 删除
            </Button>
          </div>
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            className="min-h-10"
            disabled={busy || !dirty || !title.trim()}
            onClick={() => void onSubmit({ title: title.trim(), layoutDirection, visibility })}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 保存设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MapUsageMetric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <p className="text-base font-semibold tabular-nums">{value ?? '—'}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function DeleteMapDialog({
  map,
  open,
  busy,
  dirty,
  onClose,
  onConfirm,
}: {
  map: KnowledgeMapWithUsage | null;
  open: boolean;
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const reasons: string[] = [];
  if (!map?.usage) reasons.push('无法确认节点与引用统计，请刷新后重试');
  if (map?.visibility === 'public') reasons.push('导图仍处于公开状态');
  if (map?.usage && map.usage.nodes !== 1) reasons.push(`仍有 ${Math.max(0, map.usage.nodes - 1)} 个非根节点`);
  if (map?.usage?.problems) reasons.push(`仍被 ${map.usage.problems} 道题引用`);
  if (map?.usage?.courses) reasons.push(`仍被 ${map.usage.courses} 门课程引用`);
  if (dirty) reasons.push('节点检查器仍有未保存内容');
  const blocked = reasons.length > 0;
  return (
    <Dialog open={open && !!map} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="w-full sm:w-[500px]" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>删除「{map?.title}」？</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 p-5 text-sm">
          {blocked ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100">
              <p className="font-medium">当前不能删除</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="leading-6 text-muted-foreground">将永久删除这张隐藏导图及其根节点。该操作无法撤销，也不会删除任何题目或课程。</p>
          )}
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button className="min-h-10" variant="destructive" disabled={busy || blocked} onClick={() => void onConfirm()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 永久删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnsavedMapActionDialog({ action, onClose, onDiscard }: { action: PendingMapAction | null; onClose: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full sm:w-[470px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>放弃未保存的节点修改？</DialogTitle>
        </DialogHeader>
        <DialogBody className="p-5 text-sm leading-6 text-muted-foreground">
          {action?.kind === 'switch' ? '切换导图' : '新建导图'}会清除右侧检查器中尚未保存的内容。已保存的导图和节点不会受影响。
        </DialogBody>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <Button className="min-h-10" variant="outline" onClick={onClose}>
            留在当前导图
          </Button>
          <Button className="min-h-10" variant="destructive" onClick={onDiscard}>
            放弃并继续
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
