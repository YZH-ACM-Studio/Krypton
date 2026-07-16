import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  CornerRightDown,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { resolveRootBranchSides } from './layout';
import { childrenByParent, flattenMindmapTree, planDrop, type FlatMindmapNode, type PlannedMove } from './tree';
import type { MindmapNode } from './types';

interface OutlineProps {
  nodes: MindmapNode[];
  rootId: string | null;
  selectedId: string | null;
  expanded: Set<string>;
  referenceCounts: Record<string, number>;
  busy: boolean;
  onSelect: (id: string) => void;
  onExpandedChange: (next: Set<string>) => void;
  onMove: (node: MindmapNode, move: PlannedMove) => void;
  onCreateChild: (node: MindmapNode) => void;
  onCreateSibling: (node: MindmapNode) => void;
  onDelete: (node: MindmapNode) => void;
}

function SortableTreeRow({
  item,
  rootId,
  selected,
  expanded,
  referenceCount,
  busy,
  onSelect,
  onToggle,
  onContextMenu,
  dropZone,
  layoutSide,
}: {
  item: FlatMindmapNode;
  rootId: string | null;
  selected: boolean;
  expanded: boolean;
  referenceCount: number;
  busy: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  dropZone: 'before' | 'inside' | 'after' | null;
  layoutSide?: 'left' | 'right';
}) {
  const isRoot = item.node._id === rootId;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.node._id,
    disabled: busy || isRoot,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, paddingLeft: `${8 + item.depth * 16}px` }}
      className={cn(
        'group relative flex min-h-11 items-center border-l-2 pr-2 text-sm outline-none transition-colors motion-reduce:!transition-none',
        selected ? 'border-l-primary bg-primary/8 text-foreground' : 'border-l-transparent hover:bg-accent/55',
        isDragging && 'z-20 opacity-45',
        dropZone === 'inside' && 'bg-primary/8 ring-1 ring-inset ring-primary/40',
        dropZone === 'before' && 'before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full before:bg-primary',
        dropZone === 'after' && 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary',
      )}
      role="treeitem"
      tabIndex={0}
      aria-level={item.depth + 1}
      aria-selected={selected}
      aria-expanded={item.hasChildren ? expanded : undefined}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        } else if (event.key === 'ArrowRight' && item.hasChildren && !expanded) {
          event.preventDefault();
          onToggle();
        } else if (event.key === 'ArrowLeft' && item.hasChildren && expanded) {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:invisible"
        disabled={!item.hasChildren}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        aria-label={expanded ? '收起节点' : '展开节点'}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <span className="min-w-0 flex-1 truncate font-medium">{item.node.topic}</span>
      {layoutSide ? (
        <span className="mr-1 text-[10px] font-medium uppercase text-muted-foreground">{layoutSide === 'left' ? 'L' : 'R'}</span>
      ) : null}
      {referenceCount > 0 ? (
        <Badge variant="outline" className="mr-1 h-5 min-w-5 justify-center px-1 text-[10px]">
          {referenceCount}
        </Badge>
      ) : null}
      {!isRoot ? (
        <button
          type="button"
          className="grid size-11 shrink-0 touch-none place-items-center rounded-md text-muted-foreground opacity-40 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          aria-label={`拖动 ${item.node.topic}`}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function MindmapOutline(props: OutlineProps) {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [dropCue, setDropCue] = useState<{ nodeId: string; zone: 'before' | 'inside' | 'after' } | null>(null);
  const flat = useMemo(
    () => flattenMindmapTree(props.nodes, props.rootId, props.expanded, query),
    [props.nodes, props.rootId, props.expanded, query],
  );
  const byId = useMemo(() => new Map(props.nodes.map((node) => [node._id, node])), [props.nodes]);
  const byParent = useMemo(() => childrenByParent(props.nodes), [props.nodes]);
  const rootSides = useMemo(() => (props.rootId ? resolveRootBranchSides(props.nodes, props.rootId) : new Map()), [props.nodes, props.rootId]);
  const selected = props.selectedId ? byId.get(props.selectedId) || null : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const toggle = (id: string) => {
    const next = new Set(props.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onExpandedChange(next);
  };

  const moveSelected = (kind: 'up' | 'down' | 'indent' | 'outdent') => {
    if (!selected || selected._id === props.rootId || !selected.parentId) return;
    const siblings = byParent.get(selected.parentId) || [];
    const index = siblings.findIndex((node) => node._id === selected._id);
    if (kind === 'up' && index > 0) props.onMove(selected, { newParentId: selected.parentId, targetIndex: index - 1 });
    if (kind === 'down' && index >= 0 && index < siblings.length - 1) {
      props.onMove(selected, { newParentId: selected.parentId, targetIndex: index + 1 });
    }
    if (kind === 'indent' && index > 0) {
      const previous = siblings[index - 1];
      props.onMove(selected, { newParentId: previous._id, targetIndex: (byParent.get(previous._id) || []).length });
    }
    if (kind === 'outdent') {
      const parent = byId.get(selected.parentId);
      if (!parent?.parentId) return;
      const parentSiblings = byParent.get(parent.parentId) || [];
      const parentIndex = parentSiblings.findIndex((node) => node._id === parent._id);
      props.onMove(selected, { newParentId: parent.parentId, targetIndex: parentIndex + 1 });
    }
  };

  const dropZoneForEvent = (event: DragEndEvent | DragOverEvent): 'before' | 'inside' | 'after' => {
    const overRect = event.over!.rect;
    const activeRect = event.active.rect.current.translated || event.active.rect.current.initial;
    const center = activeRect ? activeRect.top + activeRect.height / 2 : overRect.top + overRect.height / 2;
    const ratio = (center - overRect.top) / Math.max(overRect.height, 1);
    return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
  };

  const onDragOver = (event: DragOverEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      setDropCue(null);
      return;
    }
    setDropCue({ nodeId: String(event.over.id), zone: dropZoneForEvent(event) });
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDropCue(null);
    if (!event.over || event.active.id === event.over.id) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const zone = dropZoneForEvent(event);
    const move = planDrop(props.nodes, activeId, overId, zone);
    const node = byId.get(activeId);
    if (node && move) props.onMove(node, move);
  };

  const currentSiblings = selected?.parentId ? byParent.get(selected.parentId) || [] : [];
  const currentIndex = selected ? currentSiblings.findIndex((node) => node._id === selected._id) : -1;
  const canOutdent = !!(selected?.parentId && byId.get(selected.parentId)?.parentId);
  const menuNode = menu ? byId.get(menu.nodeId) || null : null;

  return (
    <section className="flex min-h-0 flex-col bg-card/40">
      <header className="space-y-3 border-b px-3 py-3">
        <div>
          <h2 className="text-sm font-semibold">结构大纲</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">拖到节点中部成为子节点，拖到边缘调整顺序</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点、说明或标签" className="h-9 pl-8" />
        </div>
        <div className="flex flex-wrap gap-1" aria-label="节点结构操作">
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected || props.busy}
            onClick={() => selected && props.onCreateChild(selected)}
            title="新增子节点"
          >
            <Plus className="size-3.5" /> 子节点
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected?.parentId || props.busy}
            onClick={() => selected && props.onCreateSibling(selected)}
            title="新增同级节点"
          >
            <MoreHorizontal className="size-3.5" /> 同级
          </Button>
          <Button size="icon" variant="ghost" disabled={props.busy || currentIndex <= 0} onClick={() => moveSelected('up')} title="上移">
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={props.busy || currentIndex < 0 || currentIndex >= currentSiblings.length - 1}
            onClick={() => moveSelected('down')}
            title="下移"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={props.busy || currentIndex <= 0}
            onClick={() => moveSelected('indent')}
            title="缩进为上一节点的子节点"
          >
            <CornerRightDown className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" disabled={props.busy || !canOutdent} onClick={() => moveSelected('outdent')} title="提升一级">
            <CornerLeftUp className="size-3.5" />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={onDragOver}
          onDragCancel={() => setDropCue(null)}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={flat.map((item) => item.node._id)} strategy={verticalListSortingStrategy}>
            <div role="tree" aria-label="导图节点">
              {flat.map((item) => (
                <SortableTreeRow
                  key={item.node._id}
                  item={item}
                  rootId={props.rootId}
                  selected={item.node._id === props.selectedId}
                  expanded={props.expanded.has(item.node._id) || !!query.trim()}
                  referenceCount={props.referenceCounts[item.node._id] || 0}
                  busy={props.busy}
                  onSelect={() => props.onSelect(item.node._id)}
                  onToggle={() => toggle(item.node._id)}
                  dropZone={dropCue?.nodeId === item.node._id ? dropCue.zone : null}
                  layoutSide={rootSides.get(item.node._id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    props.onSelect(item.node._id);
                    setMenu({ nodeId: item.node._id, x: event.clientX, y: event.clientY });
                  }}
                />
              ))}
              {!flat.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">没有匹配节点</p> : null}
            </div>
          </SortableContext>
        </DndContext>
      </ScrollArea>

      {menu && menuNode ? (
        <div
          className="fixed z-[180] min-w-40 rounded-xl border bg-popover p-1.5 text-sm shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 150) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-accent"
            disabled={props.busy}
            onClick={() => {
              setMenu(null);
              props.onCreateChild(menuNode);
            }}
          >
            <Plus className="size-4" /> 新增子节点
          </button>
          {menuNode.parentId ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-accent"
              disabled={props.busy}
              onClick={() => {
                setMenu(null);
                props.onCreateSibling(menuNode);
              }}
            >
              <MoreHorizontal className="size-4" /> 新增同级节点
            </button>
          ) : null}
          {menuNode._id !== props.rootId ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-destructive hover:bg-destructive/10"
              disabled={props.busy}
              onClick={() => {
                setMenu(null);
                props.onDelete(menuNode);
              }}
            >
              <Trash2 className="size-4" /> 删除节点
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
