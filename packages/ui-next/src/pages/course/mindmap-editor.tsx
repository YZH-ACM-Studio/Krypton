import { ReactFlowProvider } from '@xyflow/react';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { MindmapCanvas } from '../mindmap/canvas';
import { MindmapOutline } from '../mindmap/outline';
import type { PlannedMove } from '../mindmap/tree';
import type { MindmapNode } from '../mindmap/types';

interface CoursePin {
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
  inCourse: boolean;
}

interface EditorPayload {
  course: { docId: string; title: string };
  config: {
    _id: string;
    title: string;
    rootNodeId: string;
    visibility: 'hidden';
    layoutDirection: 'RIGHT' | 'DOWN';
    createdAt: string;
    updatedAt: string;
  };
  nodes: MindmapNode[];
  problems: CoursePin[];
}

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

function pinsInStoredOrder(problems: CoursePin[], ids: number[] | undefined) {
  const byDoc = new Map(problems.map((pin) => [pin.docId, pin]));
  return (ids || []).flatMap((id) => {
    const pin = byDoc.get(id);
    return pin ? [pin] : [];
  });
}

function pinLabel(pin: CoursePin) {
  const name = `${pin.pid} ${pin.title}`;
  if (!pin.inCourse) return `${name} · 已不在本课`;
  if (pin.hidden) return `${name} · 学生不可见`;
  return name;
}

export function CourseMindmapEditPage() {
  const bootstrap = useBootstrap();
  const initial = bootstrap.page.data as EditorPayload;
  const initialNode = initial.nodes.find((node) => node._id === initial.config.rootNodeId) || null;
  const [payload, setPayload] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initialNode?._id || null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialNode ? [initialNode._id] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mapTitle, setMapTitle] = useState(initial.config.title);
  const [layout, setLayout] = useState<'RIGHT' | 'DOWN'>(initial.config.layoutDirection);
  const [topic, setTopic] = useState(initialNode?.topic || '');
  const [description, setDescription] = useState(initialNode?.description || '');
  const [color, setColor] = useState(initialNode?.color || '');
  const [pins, setPins] = useState<CoursePin[]>(() => pinsInStoredOrder(initial.problems, initialNode?.coursePins));
  const [childTopic, setChildTopic] = useState('');

  const byId = useMemo(() => new Map(payload.nodes.map((node) => [node._id, node])), [payload.nodes]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const referenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of payload.nodes) counts[node._id] = node.coursePins?.length || 0;
    return counts;
  }, [payload.nodes]);

  const applyNode = (node: MindmapNode | null) => {
    setSelectedId(node?._id || null);
    setTopic(node?.topic || '');
    setDescription(node?.description || '');
    setColor(node?.color || '');
    setPins(pinsInStoredOrder(payload.problems, node?.coursePins));
  };

  const selectNode = (id: string | null) => {
    if (id === selectedId) return;
    if (rejectUnsaved()) return;
    applyNode(id ? byId.get(id) || null : null);
  };

  const mutate = async (operation: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const requestBody = operation === 'update_map' ? body : { ...body, expectedMapUpdatedAt: payload.config.updatedAt };
      const response = await fetchHydroResponse(`/course/${payload.course.docId}/mindmap`, {
        method: 'POST',
        body: new URLSearchParams({ operation, payload: JSON.stringify(requestBody) }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '导图保存失败'));
      const next = (await response.json()) as EditorPayload;
      setPayload(next);
      setMapTitle(next.config.title);
      setLayout(next.config.layoutDirection);
      const current = next.nodes.find((node) => node._id === selectedId) || next.nodes.find((node) => node._id === next.config.rootNodeId) || null;
      setTopic(current?.topic || '');
      setDescription(current?.description || '');
      setColor(current?.color || '');
      setPins(pinsInStoredOrder(next.problems, current?.coursePins));
      if (current) setSelectedId(current._id);
      return next;
    } catch (cause) {
      setError((cause as { message?: string } | null)?.message || '导图保存失败');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveMap = async () => {
    await mutate('update_map', { expectedUpdatedAt: payload.config.updatedAt, fields: { title: mapTitle, layoutDirection: layout } });
  };

  const saveNode = async () => {
    if (!selected) return;
    const inCourse = new Set(payload.problems.filter((pin) => pin.inCourse).map((pin) => pin.docId));
    const coursePins = pins.map((pin) => pin.docId).filter((docId, index, all) => all.indexOf(docId) === index);
    if (coursePins.some((docId) => !inCourse.has(docId) && !(selected.coursePins || []).includes(docId))) {
      setError('只能钉本课已保存章节里的题目。已离开本课的题目只能保留或去掉。');
      return;
    }
    await mutate('update_node', {
      id: selected._id,
      expectedUpdatedAt: selected.updatedAt,
      fields: { topic, description, color, coursePins },
    });
  };

  const unsavedMindmapEdit = () => {
    if (mapTitle !== payload.config.title || layout !== payload.config.layoutDirection) return '请先保存导图';
    if (!selected) return '';
    const savedPins = selected.coursePins || [];
    const currentPins = pins.map((pin) => pin.docId);
    const pinsChanged = savedPins.length !== currentPins.length || savedPins.some((id, index) => id !== currentPins[index]);
    if (topic !== selected.topic || description !== (selected.description || '') || color !== (selected.color || '') || pinsChanged) return '请先保存节点';
    return '';
  };

  const rejectUnsaved = () => {
    const pending = unsavedMindmapEdit();
    if (!pending) return false;
    setError(pending);
    return true;
  };

  const createChild = async () => {
    if (rejectUnsaved()) return;
    if (!selected || !childTopic.trim()) return;
    const next = await mutate('create_node', {
      parentId: selected._id,
      expectedParentUpdatedAt: selected.updatedAt,
      topic: childTopic.trim(),
    });
    if (next) {
      setExpanded((current) => new Set(current).add(selected._id));
      setChildTopic('');
    }
  };

  const removeNode = async (node = selected) => {
    if (rejectUnsaved()) return;
    if (!node || node._id === payload.config.rootNodeId) return;
    const accepted = await confirmDialog(`确定删除节点「${node.topic}」？它的钉选会一起删除。`, {
      title: '删除节点',
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    const next = await mutate('delete_node', { id: node._id, expectedUpdatedAt: node.updatedAt });
    if (next) setSelectedId(next.config.rootNodeId);
  };

  const moveNode = async (node: MindmapNode, move: PlannedMove) => {
    if (rejectUnsaved()) return;
    const parent = byId.get(move.newParentId);
    if (!parent) {
      setError('目标父节点不在当前导图里，请刷新页面。');
      return;
    }
    await mutate('move_node', {
      id: node._id,
      newParentId: parent._id,
      targetIndex: move.targetIndex,
      expectedUpdatedAt: node.updatedAt,
      expectedParentUpdatedAt: parent.updatedAt,
    });
  };

  const pinOptions = payload.problems.filter((pin) => pin.inCourse || pins.some((selectedPin) => selectedPin.docId === pin.docId));

  return (
    <ReactFlowProvider>
      <section className="grid min-w-0 gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <a href={`/course/${payload.course.docId}/edit#course-mindmap-settings`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground">
              <ArrowLeft className="size-4" strokeWidth={1.75} />
              返回课程
            </a>
            <h1 className="truncate text-xl font-semibold">{payload.course.title}</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input aria-label="导图名称" value={mapTitle} onChange={(event) => setMapTitle(event.target.value)} className="min-h-11 w-56" />
            <SimpleSelect
              value={layout}
              onValueChange={(value) => setLayout(value === 'DOWN' ? 'DOWN' : 'RIGHT')}
              options={[
                { value: 'RIGHT', label: '向右展开' },
                { value: 'DOWN', label: '向下展开' },
              ]}
              ariaLabel="布局方向"
              className="min-h-11"
            />
            <Button type="button" className="min-h-11" disabled={busy} onClick={() => void saveMap()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              保存导图
            </Button>
          </div>
        </header>
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid min-h-[36rem] min-w-0 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          <MindmapOutline
            nodes={payload.nodes}
            rootId={payload.config.rootNodeId}
            selectedId={selectedId}
            expanded={expanded}
            referenceCounts={referenceCounts}
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
              if (!parent || (parent._id !== selectedId && rejectUnsaved())) return;
              if (parent._id !== selectedId) applyNode(parent);
            }}
            onDelete={(node) => {
              if (rejectUnsaved()) return;
              void removeNode(node);
            }}
          />
          <div className="min-h-[24rem] min-w-0 overflow-hidden rounded-xl border bg-card">
            <MindmapCanvas nodes={payload.nodes} config={payload.config} selectedId={selectedId} onSelect={selectNode} />
          </div>
          <aside className="grid content-start gap-3 rounded-xl border bg-card p-4">
            {selected ? (
              <>
                <label className="grid gap-1.5 text-sm font-medium">
                  节点名称
                  <Input value={topic} onChange={(event) => setTopic(event.target.value)} className="min-h-11" />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  说明
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  颜色
                  <SimpleSelect value={color} onValueChange={setColor} options={COLORS} ariaLabel="节点颜色" className="min-h-11" />
                </label>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">钉选题目</span>
                  <MultiSelect
                    options={pinOptions}
                    value={pins}
                    onChange={setPins}
                    getKey={(pin) => String(pin.docId)}
                    getLabel={pinLabel}
                    placeholder="搜索本课已保存的题目"
                    emptyText="没有可钉的题目"
                  />
                  <p className="text-xs text-muted-foreground">只显示已经保存在课程章节里的题目。同一题可以钉在多个节点上。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11" disabled={busy} onClick={() => void saveNode()}>
                    保存节点
                  </Button>
                  {selected._id !== payload.config.rootNodeId ? (
                    <Button type="button" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void removeNode()}>
                      <Trash2 className="size-4" />
                      删除节点
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-1.5 border-t pt-3">
                  <span className="text-sm font-medium">子节点</span>
                  <div className="flex gap-2">
                    <Input aria-label="子节点名称" value={childTopic} onChange={(event) => setChildTopic(event.target.value)} className="min-h-11" placeholder="新节点名称" />
                    <Button type="button" variant="outline" className="min-h-11" disabled={busy || !childTopic.trim()} onClick={() => void createChild()}>
                      <Plus className="size-4" />
                      添加
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">选择一个节点后编辑。</p>
            )}
          </aside>
        </div>
      </section>
    </ReactFlowProvider>
  );
}
