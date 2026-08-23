import { ArrowDown, ArrowUp, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CourseProgressBar, riseStyle } from './ui';

interface OutlineChapter {
  _id: number;
  title: string;
  progress?: number;
  doneCount?: number;
  totalCount?: number;
}

/**
 * Chapter directory, shared by the reader and the author.
 *
 * A leading ordinal chip carries the position so the title never has to
 * compete with a "第 N 章" line at 11px, and reader rows carry their own
 * progress rail — the chapter list is where a learner looks to decide
 * where to go next, so the numbers belong here rather than buried in the
 * article header.
 */
export function ChapterOutline({
  chapters,
  activeId,
  onSelect,
  onMove,
  onRemove,
}: {
  chapters: OutlineChapter[];
  activeId: number | null;
  onSelect: (chapterId: number) => void;
  onMove?: (chapterId: number, direction: -1 | 1) => void;
  onRemove?: (chapterId: number) => void;
}) {
  const authoring = Boolean(onMove || onRemove);
  return (
    <nav aria-label="章节目录" className="space-y-0.5">
      {chapters.map((chapter, index) => {
        const active = chapter._id === activeId;
        // Reader rows carry progress; author rows only ever pass the title.
        const total = typeof chapter.totalCount === 'number' && chapter.totalCount > 0 ? chapter.totalCount : null;
        const done = typeof chapter.doneCount === 'number' ? chapter.doneCount : 0;
        const complete = total !== null && done >= total;
        return (
          <div
            key={chapter._id}
            style={riseStyle(index, 30, 10)}
            className={cn(
              'krypton-course-rise group relative flex items-stretch gap-0 rounded-[0.625rem]',
              'transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none',
              active ? 'krypton-course-active' : 'hover:bg-muted/60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full transition-[height,background-color] duration-200',
                'motion-reduce:transition-none',
                active ? 'h-[62%] bg-primary' : 'h-0 bg-transparent',
              )}
            />
            <button
              type="button"
              onClick={() => onSelect(chapter._id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-start gap-2.5 rounded-[0.625rem] px-3 py-2.5 text-left',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-px grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-semibold tabular-nums leading-none',
                  'transition-colors duration-150 motion-reduce:transition-none',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : complete
                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {complete && !active ? <Check className="size-3" strokeWidth={2.5} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[13px] font-medium leading-5 transition-colors duration-150 motion-reduce:transition-none',
                    active ? 'text-foreground' : 'text-foreground/85 group-hover:text-foreground',
                  )}
                >
                  {chapter.title}
                </span>
                {total !== null ? (
                  <span className="mt-1.5 flex max-w-[10.5rem] items-center gap-2">
                    <CourseProgressBar
                      value={chapter.progress || 0}
                      label={`${chapter.title} 完成进度 ${chapter.progress || 0}%`}
                      className="h-[3px] flex-1"
                    />
                    <span className="krypton-course-meta shrink-0 text-[10px] leading-none">
                      {done}/{total}
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
            {authoring ? (
              <div
                className={cn(
                  'mr-1 flex shrink-0 items-center self-center',
                  'lg:opacity-0 lg:transition-opacity lg:duration-150 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100',
                  'motion-reduce:transition-none',
                )}
              >
                {onMove ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === 0}
                      onClick={() => onMove(chapter._id, -1)}
                      aria-label={`上移${chapter.title}`}
                    >
                      <ArrowUp className="size-3.5" strokeWidth={1.75} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === chapters.length - 1}
                      onClick={() => onMove(chapter._id, 1)}
                      aria-label={`下移${chapter.title}`}
                    >
                      <ArrowDown className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </>
                ) : null}
                {onRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:bg-destructive/10"
                    disabled={chapters.length === 1}
                    onClick={() => onRemove(chapter._id)}
                    aria-label={`删除${chapter.title}`}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
