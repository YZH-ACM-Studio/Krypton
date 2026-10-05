import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, AlertTriangle, Check, ChevronLeft, Eye, EyeOff, MoreHorizontal, Network, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar, Workspace } from '@/components/ui/page';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
  const publicMapHref = config?.visibility === 'public'
    ? `/mindmap?map=${encodeURIComponent(config._id)}`
    : null;

  useEffect(() => {
    if (!initial.staleMapId) return;
    const href = initial.config ? `/admin/mindmap?map=${encodeURIComponent(initial.config._id)}` : '/admin/mindmap';
    window.history.replaceState(null, '', href);
  }, [initial.config, initial.staleMapId]);

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
      <Workspace className="flex w-full min-w-0 flex-col xl:overflow-hidden">
        {initial.staleMapId ? (
          <div role="alert" className="flex shrink-0 gap-2 border-b border-warning-line bg-warning-soft px-3 py-2 text-sm text-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" />
            <p>当前链接里的导图已不可用，已打开默认或第一张可用导图。</p>
          </div>
        ) : null}
        <Toolbar className="h-10 w-full min-w-0 shrink-0 flex-nowrap items-center border-b border-line bg-surface px-2">
          <span className="min-w-0 shrink-0 truncate text-sm font-semibold text-fg">导图管理</span>
          <Badge variant="outline" size="sm" className="hidden shrink-0 sm:inline-flex">
            {snapshot.nodes.length} 节点
          </Badge>
          {config ? (
            <Badge tone={config.visibility === 'public' ? 'success' : 'neutral'} size="sm" className="shrink-0">
              {config.visibility === 'public' ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {config.visibility === 'public' ? '已公开' : '隐藏中'}
            </Badge>
          ) : null}
          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
            <Button asChild variant="ghost" size="sm" iconOnly>
              <a href="/mindmap" aria-label="返回公开导图">
                <ChevronLeft />
              </a>
            </Button>
            <SimpleSelect
              ariaLabel="切换知识导图"
              value={config?._id || ''}
              disabled={!snapshot.maps.length || busy}
              onValueChange={(mapId) => requestMapAction({ kind: 'switch', mapId })}
              options={snapshot.maps.map((map) => ({
                value: map._id,
                label: `${map.title} · ${map.visibility === 'public' ? '已公开' : '隐藏'}${map.isDefault ? ' · 默认' : ''}`,
              }))}
              placeholder="尚未创建导图"
              size="sm"
              className="w-40 min-w-0 max-w-full shrink xl:w-48"
            />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => requestMapAction({ kind: 'create' })}>
              <Plus /> 新建导图
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="hidden xl:inline-flex"
              disabled={busy || !config}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 /> 导图设置
            </Button>
            {publicMapHref ? (
              <Button variant="ghost" size="sm" asChild className="hidden xl:inline-flex">
                <a href={publicMapHref}>
                  <Eye /> 查看公开页
                </a>
              </Button>
            ) : null}
            <Menu
              label="更多操作"
              trigger={(props) => (
                <Button type="button" variant="ghost" size="sm" iconOnly aria-label="更多操作" className="xl:hidden" {...props}>
                  <MoreHorizontal />
                </Button>
              )}
              items={[
                {
                  label: '导图设置',
                  icon: <Settings2 />,
                  disabled: busy || !config,
                  onSelect: () => setSettingsOpen(true),
                },
                ...(publicMapHref
                  ? [{
                    label: '查看公开页',
                    icon: <Eye />,
                    href: publicMapHref,
                  }]
                  : []),
              ]}
            />
            <SaveStatus state={saveState} savedAt={savedAt} />
          </div>
        </Toolbar>
        <p className="hidden shrink-0 truncate border-b border-line px-2 py-1.5 text-xs text-fg-subtle xl:block">
          每张导图独立维护结构与题目标签；节点位置始终由结构自动计算。
        </p>
        {failure ? (
          <div role="alert" className="flex min-w-0 shrink-0 items-start gap-2 border-b border-danger-line bg-danger-soft px-3 py-2 text-sm text-fg">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-fg" />
            <div className="min-w-0 flex-1">
              <p>{failure.message}</p>
              {failure.problems.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {failure.problems.map((problem) => (
                    <a
                      key={problem.docId}
                      href={mindmapProblemHref(problem)}
                      className="block min-h-10 w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-xs text-brand-fg underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {problem.pid} · {problem.title}
                    </a>
                  ))}
                </div>
              ) : null}
              {failure.status >= 500 ? (
                <p className="mt-1.5 text-xs text-fg-subtle">服务器未能确认最终结果；请先刷新核对，不要重复执行刚才的操作。</p>
              ) : null}
              {failure.status === 409 || failure.status >= 500 ? (
                <div className="mt-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
                    刷新最新导图
                  </Button>
                </div>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label="关闭错误提示" onClick={() => setFailure(null)}>
              <X />
            </Button>
          </div>
        ) : null}

        <div className="sticky top-0 z-20 shrink-0 border-b border-line bg-surface xl:hidden">
          <MiniTabs
            value={mobilePane}
            onValueChange={(value) => setMobilePane(value as MobilePane)}
            size="md"
            fullWidth
            aria-label="导图工作区面板"
            items={[
              { value: 'outline', label: '大纲' },
              { value: 'preview', label: '预览' },
              { value: 'inspector', label: '检查器' },
            ]}
          />
        </div>

        {config ? (
          <main
            aria-label="导图管理工作区"
            className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[18rem_minmax(18rem,1fr)_20rem]"
          >
            <aside
              data-mindmap-panel="outline"
              aria-label="结构大纲"
              className={cn(
                'min-h-0 min-w-0 overflow-hidden border-b border-line xl:border-r xl:border-b-0',
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
                'relative min-h-0 min-w-0 overflow-hidden border-b border-line xl:border-r xl:border-b-0',
                mobilePane === 'preview' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col',
              )}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">{selected ? selected.topic : '实时预览'}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {selected
                      ? nodePath(snapshot.nodes, selected._id)
                          .map((node) => node.topic)
                          .join(' / ')
                      : '选择节点查看路径'}
                  </p>
                </div>
                <Badge variant="outline" size="sm" className="shrink-0">
                  自动布局
                </Badge>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <div data-mindmap-canvas className="h-full overflow-hidden bg-surface-sunken">
                  <MindmapCanvas
                    nodes={snapshot.nodes}
                    config={config}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      selectNode(id);
                      if (id) setMobilePane('inspector');
                    }}
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
                'min-h-0 min-w-0 overflow-hidden border-b border-line xl:border-b-0',
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
          <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto">
            <EmptyState
              icon={<Network />}
              title="创建第一张知识导图"
              description="新导图默认隐藏，只包含一个根节点。整理完成并通过结构校验后，再从设置中公开。"
              action={
                <Button variant="primary" onClick={() => setCreateMapOpen(true)}>
                  <Plus /> 新建导图
                </Button>
              }
            />
          </main>
        )}
      </Workspace>

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
      <Badge tone="info" size="sm" className="shrink-0">
        <Spinner className="size-3.5" /> 保存中
      </Badge>
    );
  }
  if (state === 'failed') {
    return (
      <Badge tone="danger" size="sm" className="shrink-0">
        <AlertCircle className="size-3.5" /> 保存失败
      </Badge>
    );
  }
  return (
    <Badge tone="success" size="sm" className="shrink-0">
      {savedAt ? <Check className="size-3.5" /> : <StatusDot tone="success" />}
      {savedAt ? `已保存 ${savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已同步'}
    </Badge>
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
      <DialogContent size="md" onClose={close}>
        <DialogHeader>
          <DialogTitle>{request?.kind === 'child' ? '新增子节点' : '新增同级节点'}</DialogTitle>
          <DialogDescription>将添加到「{request?.parent.topic}」下方，保存后立即进入树结构。</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <FormField label="名称" htmlFor="create-mindmap-topic">
            <Input
              id="create-mindmap-topic"
              value={topic}
              maxLength={100}
              autoFocus
              onChange={(event) => setTopic(event.target.value)}
              className="h-10"
            />
          </FormField>
          <FormField label="说明（可选）" htmlFor="create-mindmap-description">
            <Textarea
              id="create-mindmap-description"
              value={description}
              maxLength={2000}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              className="resize-y"
            />
          </FormField>
          <FormField label="颜色">
            <SimpleSelect
              value={color}
              onValueChange={setColor}
              options={COLOR_OPTIONS}
              contentClassName="[&_[role=option]]:min-h-10"
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
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
            {busy ? <Spinner /> : <Plus />} 创建节点
          </Button>
        </DialogFooter>
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
      <DialogContent size="md" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>删除「{node?.topic}」？</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 text-sm">
          {blocked ? (
            <Alert tone="warning">
              当前不能删除：{childCount > 0 ? `仍有 ${childCount} 个子节点` : ''}
              {childCount > 0 && referenceCount > 0 ? '；' : ''}
              {referenceCount > 0 ? `仍被 ${referenceCount} 道题引用` : ''}。
            </Alert>
          ) : (
            <p className="text-fg-muted">该操作只删除这个叶子节点，不会删除任何题目。删除后无法在界面中撤销。</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={busy || blocked} onClick={() => void onConfirm()}>
            {busy ? <Spinner /> : <Trash2 />} 确认删除
          </Button>
        </DialogFooter>
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
      <DialogContent size="md" onClose={busy ? undefined : close}>
        <DialogHeader>
          <DialogTitle>新建知识导图</DialogTitle>
          <DialogDescription>新导图默认隐藏，创建后可逐步整理节点，再单独公开。</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <FormField label="导图名称" htmlFor="create-map-title">
            <Input
              id="create-map-title"
              value={title}
              maxLength={100}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：面向对象程序设计"
            />
          </FormField>
          <FormField label="根节点主题" htmlFor="create-map-root">
            <Input
              id="create-map-root"
              value={rootTopic}
              maxLength={100}
              onChange={(event) => setRootTopic(event.target.value)}
              placeholder="例如：面向对象"
            />
          </FormField>
          <FormField label="布局方向">
            <SimpleSelect
              value={layoutDirection}
              onValueChange={(value) => setLayoutDirection(value as 'RIGHT' | 'DOWN')}
              options={LAYOUT_OPTIONS}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
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
            {busy ? <Spinner /> : <Plus />} 创建导图
          </Button>
        </DialogFooter>
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
  onSubmit: (fields: {
    title: string;
    layoutDirection: 'RIGHT' | 'DOWN';
    visibility: 'hidden' | 'public';
    isDefault: boolean;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [layoutDirection, setLayoutDirection] = useState<'RIGHT' | 'DOWN'>('RIGHT');
  const [visibility, setVisibility] = useState<'hidden' | 'public'>('hidden');
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!open || !map) return;
    setTitle(map.title);
    setLayoutDirection(map.layoutDirection);
    setVisibility(map.visibility);
    setIsDefault(map.isDefault === true);
  }, [map, open]);

  const dirty =
    !!map &&
    (title.trim() !== map.title ||
      layoutDirection !== map.layoutDirection ||
      visibility !== map.visibility ||
      isDefault !== (map.isDefault === true));
  return (
    <Dialog open={open && !!map} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent size="md" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>导图设置</DialogTitle>
          <DialogDescription>公开状态控制学生可见性；根节点名称直接在右侧节点检查器中编辑。</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <FormField label="导图名称" htmlFor="map-settings-title">
            <Input id="map-settings-title" value={title} maxLength={100} autoFocus onChange={(event) => setTitle(event.target.value)} />
          </FormField>
          <FormRow columns={2}>
            <FormField label="布局方向">
              <SimpleSelect
                value={layoutDirection}
                onValueChange={(value) => setLayoutDirection(value as 'RIGHT' | 'DOWN')}
                options={LAYOUT_OPTIONS}
              />
            </FormField>
            <FormField label="可见性">
              <label className="flex min-h-10 cursor-pointer items-center gap-2">
                <Switch
                  checked={visibility === 'public'}
                  onCheckedChange={(checked) => {
                    setVisibility(checked ? 'public' : 'hidden');
                    if (!checked) setIsDefault(false);
                  }}
                />
                <span className="text-xs text-fg-subtle">{visibility === 'public' ? '公开，学生可见' : '隐藏，仅管理员可见'}</span>
              </label>
            </FormField>
          </FormRow>
          <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2.5">
            <Switch
              checked={isDefault}
              disabled={visibility !== 'public'}
              onCheckedChange={(checked) => {
                if (visibility !== 'public') return;
                setIsDefault(checked);
              }}
              className="mt-0.5"
              aria-label="作为公开页默认导图"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">作为公开页默认导图</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">
                {visibility === 'public' ? '打开 /mindmap 且未指定导图时显示这一张。同时只能有一张默认。' : '先公开这张导图，才能设为默认。'}
              </span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-sunken p-3 text-center">
            <MapUsageMetric label="节点" value={map?.usage?.nodes} />
            <MapUsageMetric label="题目" value={map?.usage?.problems} />
            <MapUsageMetric label="课程" value={map?.usage?.courses} />
          </div>
          {visibility === 'public' && map?.visibility === 'hidden' ? (
            <Alert tone="info">发布时服务器会验证根节点、父子关系与整棵树的可达性；校验失败不会改变公开状态。</Alert>
          ) : null}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-danger-line bg-danger-soft p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-danger-fg">删除整张导图</p>
              <p className="mt-0.5 text-xs text-fg-subtle">仅隐藏、只剩根节点且没有题目或课程引用时可用。</p>
            </div>
            <Button type="button" variant="danger-soft" size="sm" className="shrink-0" disabled={busy} onClick={onDelete}>
              <Trash2 /> 删除
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !dirty || !title.trim()}
            onClick={() =>
              void onSubmit({
                title: title.trim(),
                layoutDirection,
                visibility,
                isDefault: visibility === 'public' && isDefault,
              })
            }
          >
            {busy ? <Spinner /> : <Check />} 保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MapUsageMetric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <p className="text-lg font-semibold text-fg tabular">{value ?? '—'}</p>
      <p className="mt-0.5 text-2xs text-fg-subtle">{label}</p>
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
      <DialogContent size="md" onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>删除「{map?.title}」？</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 text-sm">
          {blocked ? (
            <Alert tone="warning" title="当前不能删除">
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <p className="text-fg-muted">将永久删除这张隐藏导图及其根节点。该操作无法撤销，也不会删除任何题目或课程。</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={busy || blocked} onClick={() => void onConfirm()}>
            {busy ? <Spinner /> : <Trash2 />} 永久删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnsavedMapActionDialog({ action, onClose, onDiscard }: { action: PendingMapAction | null; onClose: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>放弃未保存的节点修改？</DialogTitle>
        </DialogHeader>
        <DialogBody className="text-sm text-fg-muted">
          {action?.kind === 'switch' ? '切换导图' : '新建导图'}会清除右侧检查器中尚未保存的内容。已保存的导图和节点不会受影响。
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            留在当前导图
          </Button>
          <Button type="button" variant="danger" onClick={onDiscard}>
            放弃并继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
