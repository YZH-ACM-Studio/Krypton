import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, Check, ChevronLeft, Eye, MoreHorizontal, Network, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar, Workspace } from '@/components/ui/page';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { mindmapProblemHref, MindmapApiError, mutateKnowledgeMap, mutateMindmap, saveCourseNodeSettings } from './api';
import { initialCollapsedNodes, MindmapCanvas } from './canvas';
import { MindmapInspector } from './inspector';
import { MindmapOutline } from './outline';
import { childrenByParent, nodePath, siblingIndex, type PlannedMove } from './tree';
import { readMindmapSnapshot, type MindmapNode, type MindmapSnapshot, type ProblemOption } from './types';

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

const LAYOUT_OPTIONS = [
  { value: 'RIGHT', label: '中心向左右展开' },
  { value: 'DOWN', label: '从上向下展开' },
];

export function AdminMindmapPage() {
  const bootstrap = useBootstrap();
  const initial = readMindmapSnapshot(bootstrap.page.data);
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
  const [mapTitle, setMapTitle] = useState(initial.config?.title ?? '');
  const [layoutDraft, setLayoutDraft] = useState<'RIGHT' | 'DOWN'>(initial.config?.layoutDirection ?? 'RIGHT');
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const mutationInFlight = useRef(false);

  const config = snapshot.config;
  const byId = useMemo(() => new Map(snapshot.nodes.map((node) => [node._id, node])), [snapshot.nodes]);
  const byParent = useMemo(() => childrenByParent(snapshot.nodes), [snapshot.nodes]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const busy = saveState === 'saving';
  const publicMapHref = config ? '/mindmap' : null;
  const mapDirty = !!config && (mapTitle.trim() !== config.title || layoutDraft !== config.layoutDirection);
  const { guardDialog } = useUnsavedChangesGuard(mapDirty || inspectorDirty || busy);

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
    const path = nodePath(snapshot.nodes, id);
    for (const node of path.slice(0, -1)) next.add(node._id);
    setExpanded(next);
  };

  const recordFailure = (error: unknown, fallback: string) => {
    const apiError = error instanceof MindmapApiError ? error : new MindmapApiError(error instanceof Error ? error.message : fallback, 500);
    setFailure({ message: apiError.message, problems: apiError.details?.problems || [], status: apiError.status });
    setSaveState('failed');
  };

  const runMutation = async (
    operation: 'create' | 'update' | 'move' | 'delete',
    payload: Record<string, unknown>,
  ): Promise<MindmapSnapshot | null> => {
    if (!config) {
      setFailure({ message: '知识图谱尚未合并，请先运行 mindmap:merge-courses', problems: [], status: 409 });
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

  const saveMapSettings = async () => {
    if (!config || mutationInFlight.current) return;
    const title = mapTitle.trim();
    if (!title) return;
    mutationInFlight.current = true;
    setSaveState('saving');
    setFailure(null);
    try {
      const next = await mutateKnowledgeMap('update', {
        id: config._id,
        expectedUpdatedAt: config.updatedAt,
        fields: { title, layoutDirection: layoutDraft },
      });
      setSnapshot(next);
      if (next.config) {
        setMapTitle(next.config.title);
        setLayoutDraft(next.config.layoutDirection);
      }
      setSaveState('saved');
      setSavedAt(new Date());
    } catch (error) {
      recordFailure(error, '导图操作失败');
    } finally {
      mutationInFlight.current = false;
    }
  };

  const saveCourseSettings = async (
    node: MindmapNode,
    settings: { visibility: 'public' | 'hidden'; ownerUids: number[] },
  ) => {
    if (mutationInFlight.current) throw new MindmapApiError('正在保存，请稍候', 409);
    mutationInFlight.current = true;
    setSaveState('saving');
    setFailure(null);
    try {
      const next = await saveCourseNodeSettings({
        nodeId: node._id,
        expectedUpdatedAt: node.updatedAt,
        visibility: settings.visibility,
        ownerUids: settings.ownerUids,
      });
      setSnapshot(next);
      setSaveState('saved');
      setSavedAt(new Date());
    } catch (error) {
      recordFailure(error, '课程节点设置保存失败');
      throw error;
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
        <Toolbar className="h-auto min-h-10 w-full min-w-0 shrink-0 flex-wrap items-center border-b border-line bg-surface px-2 md:h-10 md:flex-nowrap">
          <span className="shrink-0 truncate text-sm font-semibold text-fg">导图管理</span>
          <Badge variant="outline" size="sm" className="hidden shrink-0 sm:inline-flex">
            <span className="tabular">{snapshot.nodes.length}</span> 节点
          </Badge>
          {config ? (
            <div className="order-last flex w-full min-w-0 basis-full items-center gap-2 md:order-none md:contents">
              <Input
                size="sm"
                aria-label="导图名称"
                value={mapTitle}
                maxLength={100}
                disabled={busy}
                onChange={(event) => setMapTitle(event.target.value)}
                className="min-w-32 w-36 shrink-0 max-md:w-auto max-md:flex-1"
              />
              <SimpleSelect
                ariaLabel="布局方向"
                value={layoutDraft}
                disabled={busy}
                onValueChange={(value) => {
                  if (value === 'RIGHT' || value === 'DOWN') setLayoutDraft(value);
                }}
                options={LAYOUT_OPTIONS}
                size="sm"
                className="w-36 shrink-0"
              />
            </div>
          ) : null}
          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
            <Button asChild variant="ghost" size="sm" iconOnly>
              <a href="/mindmap" aria-label="返回公开导图">
                <ChevronLeft />
              </a>
            </Button>
            {config ? (
              <Button type="button" variant="secondary" size="sm" disabled={busy || !mapDirty || !mapTitle.trim()} onClick={() => void saveMapSettings()}>
                保存设置
              </Button>
            ) : null}
            {publicMapHref ? (
              <Button variant="ghost" size="sm" asChild className="hidden xl:inline-flex">
                <a href={publicMapHref}>
                  <Eye /> 查看公开页
                </a>
              </Button>
            ) : null}
            {publicMapHref ? (
              <Menu
                label="更多操作"
                trigger={(props) => (
                  <Button type="button" variant="ghost" size="sm" iconOnly aria-label="更多操作" className="xl:hidden" {...props}>
                    <MoreHorizontal />
                  </Button>
                )}
                items={[
                  {
                    label: '查看公开页',
                    icon: <Eye />,
                    href: publicMapHref,
                  },
                ]}
              />
            ) : null}
            <SaveStatus state={saveState} savedAt={savedAt} />
          </div>
        </Toolbar>
        <p className="hidden shrink-0 truncate border-b border-line px-2 py-1.5 text-xs text-fg-subtle xl:block">
          节点位置始终由结构自动计算。
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
                key={config._id}
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
                onSaveCourseSettings={saveCourseSettings}
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
              title="知识图谱尚未合并"
              description="请先运行 mindmap:merge-courses。"
            />
          </main>
        )}
      </Workspace>

      {guardDialog}
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
