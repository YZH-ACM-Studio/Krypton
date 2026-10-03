import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CourseProgressBar } from './ui';

interface OutlineSection {
  _id: number;
  title: string;
  progress?: number;
  doneCount?: number;
  totalCount?: number;
}

interface OutlineChapter {
  _id: number;
  title: string;
  progress?: number;
  doneCount?: number;
  totalCount?: number;
  sections?: OutlineSection[];
}

function AuthoringTools({
  label,
  disableUp,
  disableDown,
  disableRemove,
  onAdd,
  addLabel,
  onMove,
  onRemove,
}: {
  label: string;
  disableUp?: boolean;
  disableDown?: boolean;
  disableRemove?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  onMove?: (direction: -1 | 1) => void;
  onRemove?: () => void;
}) {
  if (!onAdd && !onMove && !onRemove) return null;
  return (
    <div className="mr-1 flex min-h-11 shrink-0 items-center self-center">
      {onAdd ? (
        <Button type="button" variant="ghost" size="sm" iconOnly onClick={onAdd} aria-label={addLabel || `添加${label}的小节`}>
          <Plus strokeWidth={2} />
        </Button>
      ) : null}
      {onMove ? (
        <>
          <Button type="button" variant="ghost" size="sm" iconOnly disabled={disableUp} onClick={() => onMove(-1)} aria-label={`上移${label}`}>
            <ArrowUp strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            disabled={disableDown}
            onClick={() => onMove(1)}
            aria-label={`下移${label}`}
          >
            <ArrowDown strokeWidth={1.75} />
          </Button>
        </>
      ) : null}
      {onRemove ? (
        <Button
          type="button"
          variant="danger-soft"
          size="sm"
          iconOnly
          disabled={disableRemove}
          onClick={onRemove}
          aria-label={`删除${label}`}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Chapter directory, shared by the reader and the author.
 *
 * A leading ordinal chip carries the position so the title never has to
 * compete with a "第 N 章" line, and reader rows carry their own progress
 * rail — the chapter list is where a learner looks to decide where to go next.
 */
export function ChapterOutline({
  chapters,
  activeId,
  activeSectionId = null,
  onSelect,
  onMove,
  onRemove,
  onAddSection,
  onMoveSection,
  onRemoveSection,
}: {
  chapters: OutlineChapter[];
  activeId: number | null;
  activeSectionId?: number | null;
  onSelect: (chapterId: number, sectionId?: number | null) => void;
  onMove?: (chapterId: number, direction: -1 | 1) => void;
  onRemove?: (chapterId: number) => void;
  onAddSection?: (chapterId: number) => void;
  onMoveSection?: (chapterId: number, sectionId: number, direction: -1 | 1) => void;
  onRemoveSection?: (chapterId: number, sectionId: number) => void;
}) {
  const authoring = Boolean(onMove || onRemove || onAddSection);
  return (
    <nav aria-label="章节目录" className="flex flex-col gap-0.5">
      {chapters.map((chapter, index) => {
        const active = chapter._id === activeId;
        const total = typeof chapter.totalCount === 'number' && chapter.totalCount > 0 ? chapter.totalCount : null;
        const done = typeof chapter.doneCount === 'number' ? chapter.doneCount : 0;
        const complete = total !== null && done >= total;
        const sections = chapter.sections || [];
        const chapterSelected = active && activeSectionId == null;
        return (
          <div key={chapter._id} className="flex flex-col gap-0.5">
            <div
              className={cn(
                'relative flex items-stretch gap-0 rounded-md',
                'transition-colors duration-(--dur-1) ease-(--ease-standard) motion-reduce:transition-none',
                chapterSelected ? 'bg-brand-soft' : 'hover:bg-surface-hover',
              )}
            >
              {/* ds-allow DS005: 章节行同时放序号、标题和进度条，固定高度的 Button 会裁掉这三列 */}
              <button
                type="button"
                onClick={() => onSelect(chapter._id, null)}
                aria-current={chapterSelected ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-md px-3 py-2.5 text-left',
                  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-px grid size-5 shrink-0 place-items-center rounded-md text-2xs font-semibold tabular leading-none',
                    'transition-colors duration-(--dur-1) ease-(--ease-standard) motion-reduce:transition-none',
                    chapterSelected
                      ? 'bg-brand text-on-brand'
                      : complete
                        ? 'bg-success-soft text-success-fg'
                        : 'bg-surface-active text-fg-subtle',
                  )}
                >
                  {complete && !chapterSelected ? <Check className="size-3" strokeWidth={2.5} /> : String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-balance text-sm font-medium leading-5 text-fg',
                      'transition-colors duration-(--dur-1) ease-(--ease-standard) motion-reduce:transition-none',
                    )}
                  >
                    {chapter.title}
                  </span>
                  {total !== null ? (
                    <span className="mt-1.5 flex max-w-40 items-center gap-2">
                      <CourseProgressBar
                        value={chapter.progress || 0}
                        label={`${chapter.title} 完成进度 ${chapter.progress || 0}%`}
                        className="flex-1"
                      />
                      <span className="shrink-0 text-xs text-fg-subtle tabular leading-none">
                        {done}/{total}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>
              {authoring ? (
                <AuthoringTools
                  label={chapter.title}
                  disableUp={index === 0}
                  disableDown={index === chapters.length - 1}
                  disableRemove={chapters.length === 1}
                  onAdd={onAddSection ? () => onAddSection(chapter._id) : undefined}
                  addLabel={`给${chapter.title}添加小节`}
                  onMove={onMove ? (direction) => onMove(chapter._id, direction) : undefined}
                  onRemove={onRemove ? () => onRemove(chapter._id) : undefined}
                />
              ) : null}
            </div>
            {sections.map((section, sectionIndex) => {
              const sectionActive = active && activeSectionId === section._id;
              const sectionTotal = typeof section.totalCount === 'number' && section.totalCount > 0 ? section.totalCount : null;
              const sectionDone = typeof section.doneCount === 'number' ? section.doneCount : 0;
              const sectionComplete = sectionTotal !== null && sectionDone >= sectionTotal;
              return (
                <div
                  key={section._id}
                  className={cn(
                    'relative ml-5 flex items-stretch rounded-md',
                    sectionActive ? 'bg-brand-soft' : 'hover:bg-surface-hover',
                  )}
                >
                  {/* ds-allow DS005: 小节行同时放序号、标题和完成数，固定高度的 Button 会裁掉这三列 */}
                  <button
                    type="button"
                    onClick={() => onSelect(chapter._id, section._id)}
                    aria-current={sectionActive ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-3 py-2 text-left',
                      'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-px grid size-5 shrink-0 place-items-center rounded-md text-2xs font-semibold tabular leading-none',
                        sectionActive
                          ? 'bg-brand text-on-brand'
                          : sectionComplete
                            ? 'bg-success-soft text-success-fg'
                            : 'bg-surface-active text-fg-subtle',
                      )}
                    >
                      {sectionComplete && !sectionActive ? <Check className="size-3" strokeWidth={2.5} /> : `${index + 1}.${sectionIndex + 1}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-balance text-xs font-medium leading-5 text-fg">
                        {section.title}
                      </span>
                      {sectionTotal !== null ? (
                        <span className="mt-1 block text-xs text-fg-subtle tabular leading-none">
                          {sectionDone}/{sectionTotal}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {onMoveSection || onRemoveSection ? (
                    <AuthoringTools
                      label={section.title}
                      disableUp={sectionIndex === 0}
                      disableDown={sectionIndex === sections.length - 1}
                      onMove={onMoveSection ? (direction) => onMoveSection(chapter._id, section._id, direction) : undefined}
                      onRemove={onRemoveSection ? () => onRemoveSection(chapter._id, section._id) : undefined}
                    />
                  ) : null}
                </div>
              );
            })}
            {onAddSection && active ? (
              <>
                {/* ds-allow DS005: 「添加小节」是整条缩进行的命中区，标准 Button 会把文字居中并锁死高度 */}
                <button
                  type="button"
                  onClick={() => onAddSection(chapter._id)}
                  className={cn(
                    'ml-5 flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-fg-subtle',
                    'hover:bg-surface-hover hover:text-fg',
                    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  )}
                >
                  <Plus className="size-3.5 shrink-0" strokeWidth={2} />
                  添加小节
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
