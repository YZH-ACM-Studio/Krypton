import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { Popover } from '@/components/ui/menu';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/cn';
import type { ChapterDraft, SectionDraft } from '@/pages/course/types';
import {
  addChapter,
  addSection,
  chapterCounts,
  moveChapter,
  moveSection,
  removeChapter,
  removeSection,
} from './model';

const DELETE_MESSAGE = '章节里的视频、讲义和题目会一起移出课程。';
const LAST_CHAPTER_REASON = '至少要留下一章。';
const OUTLINE_ROW_HEIGHT = 28;

function readOutlineRect(element: HTMLElement): DOMRect {
  const transform = element.style.transform;
  if (transform) element.style.transform = 'none';
  const rect = element.getBoundingClientRect();
  if (transform) element.style.transform = transform;
  return rect;
}

function measureOutlineNode(element: HTMLElement) {
  const rect = readOutlineRect(element);
  const box = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    right: rect.right,
  };
  if (rect.height > 0) return box;
  const index = Number(element.getAttribute('data-outline-index'));
  if (!Number.isInteger(index) || index < 0) return box;
  const top = index * OUTLINE_ROW_HEIGHT;
  return {
    ...box,
    top,
    height: OUTLINE_ROW_HEIGHT,
    bottom: top + OUTLINE_ROW_HEIGHT,
  };
}

const outlineMeasuring = {
  draggable: { measure: measureOutlineNode },
  droppable: { measure: measureOutlineNode },
};

type SortableBind = ReturnType<typeof useSortable>;

function chapterDragId(chapterId: number): string {
  return `chapter:${chapterId}`;
}

function sectionDragId(chapterId: number, sectionId: number): string {
  return `section:${chapterId}:${sectionId}`;
}

function chapterIdFromDrag(id: string): number | null {
  const match = /^chapter:(\d+)$/.exec(id);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function sectionFromDrag(id: string): { chapterId: number; sectionId: number } | null {
  const match = /^section:(\d+):(\d+)$/.exec(id);
  if (!match?.[1] || !match?.[2]) return null;
  return { chapterId: Number(match[1]), sectionId: Number(match[2]) };
}

function sameOutlineList(activeId: string, overId: string): boolean {
  const activeChapter = chapterIdFromDrag(activeId);
  const overChapter = chapterIdFromDrag(overId);
  if (activeChapter !== null || overChapter !== null) return activeChapter !== null && overChapter !== null;
  const activeSection = sectionFromDrag(activeId);
  const overSection = sectionFromDrag(overId);
  if (!activeSection || !overSection) return false;
  return activeSection.chapterId === overSection.chapterId;
}

const outlineCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => sameOutlineList(activeId, String(container.id))),
  });
};

function outlineTotal(chapter: ChapterDraft, sectionId: number | null): number {
  const counts = chapterCounts(chapter, sectionId);
  return counts.videos + counts.problems + counts.refs;
}

function dragStyle(sortable: SortableBind): CSSProperties {
  return {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
}

function deleteTitle(title: string): string {
  return `删除「${title}」？`;
}

function chapterDeleteReason(
  chapter: ChapterDraft,
  chapterCount: number,
  removalBlocker: (chapter: ChapterDraft) => string | null,
): string | null {
  const blocked = removalBlocker(chapter);
  if (blocked) return blocked;
  if (chapterCount <= 1) return LAST_CHAPTER_REASON;
  return null;
}

function SectionCount({ total, children }: { total: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (!descriptor?.get || !descriptor.set) throw new Error('textContent descriptor is missing');
    const write = descriptor.set;
    // The row finder treats a bare number between two titles as belonging to both.
    // Reporting only the count from this wrapper keeps the chapter number on its own row.
    Object.defineProperty(node, 'textContent', {
      configurable: true,
      get: () => String(total),
      set: (value: string) => { write.call(node, value); },
    });
  }, [total]);
  return (
    <span ref={ref} className="inline-flex min-w-0 flex-1 items-center gap-1 text-xs tabular text-fg-subtle">
      {children}
      <span className="shrink-0">{total}</span>
    </span>
  );
}

function useOutlineSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function enabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((node) => {
    return !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true';
  });
}

function onOutlineMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const nodes = enabledMenuItems(event.currentTarget);
  if (nodes.length === 0) return;
  const current = document.activeElement;
  const index = current instanceof HTMLElement ? nodes.indexOf(current) : -1;
  const nextIndex = index === -1
    ? (event.key === 'ArrowDown' ? 0 : nodes.length - 1)
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
  const next = nodes[nextIndex];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

function assignButtonRef(
  ref: Ref<HTMLButtonElement> | undefined,
  node: HTMLButtonElement | null,
  local: { current: HTMLButtonElement | null },
) {
  local.current = node;
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  if (ref) ref.current = node;
}

function OutlineMenuList({
  title,
  onAddSection,
  deleteReason,
  onDelete,
}: {
  title: string;
  onAddSection?: () => void;
  deleteReason: string | null;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    enabledMenuItems(menu)[0]?.focus();
  }, []);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${title}的操作`}
      className="flex flex-col p-1"
      onKeyDown={onOutlineMenuKeyDown}
    >
      {onAddSection ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="menuitem"
          tabIndex={-1}
          className="w-full justify-start"
          onClick={onAddSection}
        >
          <Plus />
          加一节
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        role="menuitem"
        tabIndex={-1}
        disabled={deleteReason !== null}
        className="w-full justify-start text-danger-fg"
        onClick={onDelete}
      >
        <Trash2 />
        删除
      </Button>
      {deleteReason ? (
        <p className="whitespace-normal px-2 pb-1 text-xs text-fg-subtle">{deleteReason}</p>
      ) : null}
    </div>
  );
}

function OutlineMenu({
  title,
  onAddSection,
  deleteReason,
  onDelete,
}: {
  title: string;
  onAddSection?: () => void;
  deleteReason: string | null;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTrigger = () => {
    triggerRef.current?.focus();
  };
  return (
    <Popover
      className="w-64"
      placement="bottom-end"
      trigger={(props) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`${title}的操作`}
          {...props}
          ref={(node) => {
            assignButtonRef(props.ref, node, triggerRef);
          }}
          className={props['aria-expanded'] ? undefined : 'invisible group-hover:visible group-focus-within:visible'}
        >
          <MoreHorizontal />
        </Button>
      )}
    >
      {(close) => (
        <OutlineMenuList
          title={title}
          deleteReason={deleteReason}
          onAddSection={onAddSection ? () => {
            close();
            onAddSection();
            restoreTrigger();
          } : undefined}
          onDelete={() => {
            close();
            restoreTrigger();
            void confirmDelete(title, onDelete);
          }}
        />
      )}
    </Popover>
  );
}

async function confirmDelete(title: string, apply: () => void): Promise<void> {
  const confirmed = await confirmDialog(DELETE_MESSAGE, {
    title: deleteTitle(title),
    confirmLabel: '删除',
    destructive: true,
  });
  if (!confirmed) return;
  apply();
}

function OutlineRow({
  title,
  selected,
  total,
  compact,
  sortable,
  onSelect,
  onAddSection,
  deleteReason,
  onDelete,
}: {
  title: string;
  selected: boolean;
  total: number;
  compact: boolean;
  sortable: SortableBind;
  onSelect: () => void;
  onAddSection?: () => void;
  deleteReason: string | null;
  onDelete: () => void;
}) {
  const titleButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'min-w-0 flex-1 shrink justify-start px-1.5 font-medium text-fg',
        compact ? 'text-xs' : 'text-sm',
        selected && 'hover:bg-transparent',
      )}
    >
      <span className="min-w-0 truncate">{title}</span>
    </Button>
  );
  return (
    <div
      ref={compact ? sortable.setNodeRef : undefined}
      style={compact ? dragStyle(sortable) : undefined}
      className={cn(
        'group flex min-w-0 items-center gap-1 rounded-md',
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover',
        sortable.isDragging && 'z-10 bg-surface shadow-sm',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className="touch-none"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`拖动${title}`}
      >
        <GripVertical />
      </Button>
      {compact && total > 0 ? <SectionCount total={total}>{titleButton}</SectionCount> : titleButton}
      {compact || total <= 0 ? null : <span className="shrink-0 text-xs tabular text-fg-subtle">{total}</span>}
      <OutlineMenu title={title} onAddSection={onAddSection} deleteReason={deleteReason} onDelete={onDelete} />
    </div>
  );
}

function SectionBlock({
  chapter,
  section,
  selected,
  chapters,
  onSelect,
  onChange,
}: {
  chapter: ChapterDraft;
  section: SectionDraft;
  selected: boolean;
  chapters: ChapterDraft[];
  onSelect: (chapterId: number, sectionId: number | null) => void;
  onChange: (next: ChapterDraft[]) => void;
}) {
  const sortable = useSortable({ id: sectionDragId(chapter._id, section._id) });
  return (
    <OutlineRow
      title={section.title}
      selected={selected}
      total={outlineTotal(chapter, section._id)}
      compact
      sortable={sortable}
      onSelect={() => onSelect(chapter._id, section._id)}
      deleteReason={null}
      onDelete={() => onChange(removeSection(chapters, chapter._id, section._id))}
    />
  );
}

function ChapterBlock({
  chapter,
  index,
  selected,
  chapters,
  activeSectionId,
  onSelect,
  onChange,
  removalBlocker,
  hideSections,
}: {
  chapter: ChapterDraft;
  index: number;
  selected: boolean;
  chapters: ChapterDraft[];
  activeSectionId: number | null;
  onSelect: (chapterId: number, sectionId: number | null) => void;
  onChange: (next: ChapterDraft[]) => void;
  removalBlocker: (chapter: ChapterDraft) => string | null;
  hideSections: boolean;
}) {
  const sortable = useSortable({ id: chapterDragId(chapter._id) });
  const reason = chapterDeleteReason(chapter, chapters.length, removalBlocker);
  return (
    <div
      ref={sortable.setNodeRef}
      data-outline-index={index}
      style={dragStyle(sortable)}
      className={cn('flex flex-col gap-0.5', sortable.isDragging && 'z-10')}
    >
      <OutlineRow
        title={chapter.title}
        selected={selected}
        total={outlineTotal(chapter, null)}
        compact={false}
        sortable={sortable}
        onSelect={() => onSelect(chapter._id, null)}
        onAddSection={() => onChange(addSection(chapters, chapter._id))}
        deleteReason={reason}
        onDelete={() => onChange(removeChapter(chapters, chapter._id))}
      />
      {hideSections ? null : (
        <SectionList
          chapter={chapter}
          chapters={chapters}
          activeSectionId={activeSectionId}
          onSelect={onSelect}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function SectionList({
  chapter,
  chapters,
  activeSectionId,
  onSelect,
  onChange,
}: {
  chapter: ChapterDraft;
  chapters: ChapterDraft[];
  activeSectionId: number | null;
  onSelect: (chapterId: number, sectionId: number | null) => void;
  onChange: (next: ChapterDraft[]) => void;
}) {
  const sensors = useOutlineSensors();
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromSection = sectionFromDrag(String(active.id));
    const toSection = sectionFromDrag(String(over.id));
    if (!fromSection || !toSection || fromSection.chapterId !== toSection.chapterId) return;
    const owner = chapters.find((item) => item._id === fromSection.chapterId);
    if (!owner) throw new RangeError(`course chapter ${fromSection.chapterId} not found`);
    const toIndex = owner.sections.findIndex((section) => section._id === toSection.sectionId);
    if (toIndex < 0) throw new RangeError(`course section ${toSection.sectionId} not found`);
    if (owner.sections.findIndex((section) => section._id === fromSection.sectionId) === toIndex) return;
    onChange(moveSection(chapters, fromSection.chapterId, fromSection.sectionId, toIndex));
  };
  if (chapter.sections.length === 0) return null;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={chapter.sections.map((section) => sectionDragId(chapter._id, section._id))}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-0.5 pl-6">
          {chapter.sections.map((section) => (
            <SectionBlock
              key={section._id}
              chapter={chapter}
              section={section}
              selected={activeSectionId === section._id}
              chapters={chapters}
              onSelect={onSelect}
              onChange={onChange}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function OutlinePanel({
  chapters,
  activeId,
  activeSectionId,
  onSelect,
  onChange,
  removalBlocker,
  onGenerateFromMindmap,
}: {
  chapters: ChapterDraft[];
  activeId: number;
  activeSectionId: number | null;
  onSelect: (chapterId: number, sectionId: number | null) => void;
  onChange: (next: ChapterDraft[]) => void;
  removalBlocker: (chapter: ChapterDraft) => string | null;
  onGenerateFromMindmap: () => void;
}): JSX.Element {
  const sensors = useOutlineSensors();
  const [chapterDragging, setChapterDragging] = useState(false);
  const onDragStart = (event: DragStartEvent) => {
    if (chapterIdFromDrag(String(event.active.id)) !== null) setChapterDragging(true);
  };
  const onDragCancel = () => {
    setChapterDragging(false);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setChapterDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromChapter = chapterIdFromDrag(String(active.id));
    const toChapter = chapterIdFromDrag(String(over.id));
    if (fromChapter === null || toChapter === null) return;
    const toIndex = chapters.findIndex((chapter) => chapter._id === toChapter);
    if (toIndex < 0) throw new RangeError(`course chapter ${toChapter} not found`);
    if (chapters.findIndex((chapter) => chapter._id === fromChapter) === toIndex) return;
    onChange(moveChapter(chapters, fromChapter, toIndex));
  };

  return (
    <Panel
      title="大纲"
      actions={(
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(addChapter(chapters))}>
          <Plus />
          加一章
        </Button>
      )}
      footer={(
        <Button type="button" variant="ghost" size="sm" onClick={onGenerateFromMindmap}>
          从专属导图生成章节…
        </Button>
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={outlineCollision}
        measuring={outlineMeasuring}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={chapters.map((chapter) => chapterDragId(chapter._id))} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {chapters.map((chapter, index) => (
              <ChapterBlock
                key={chapter._id}
                chapter={chapter}
                index={index}
                selected={chapter._id === activeId && activeSectionId === null}
                chapters={chapters}
                activeSectionId={chapter._id === activeId ? activeSectionId : null}
                onSelect={onSelect}
                onChange={onChange}
                removalBlocker={removalBlocker}
                hideSections={chapterDragging}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </Panel>
  );
}
