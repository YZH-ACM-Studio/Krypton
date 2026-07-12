import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface OutlineChapter {
  _id: number;
  title: string;
  progress?: number;
  doneCount?: number;
  totalCount?: number;
}

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
  return (
    <nav aria-label="章节目录" className="space-y-1">
      {chapters.map((chapter, index) => {
        const active = chapter._id === activeId;
        return (
          <div
            key={chapter._id}
            className={cn(
              'group flex min-h-11 items-center rounded-lg border border-transparent transition-colors duration-200',
              active ? 'bg-primary/8 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(chapter._id)}
              className="min-w-0 flex-1 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-current={active ? 'page' : undefined}
            >
              <span className="block text-[11px] tabular-nums text-muted-foreground">第 {index + 1} 章</span>
              <span className="block truncate text-sm font-medium">{chapter.title}</span>
              {typeof chapter.totalCount === 'number' ? (
                <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                  {chapter.doneCount}/{chapter.totalCount} 题 · {chapter.progress}%
                </span>
              ) : null}
            </button>
            {onMove || onRemove ? (
              <div
                className={cn(
                  'mr-1 flex shrink-0 items-center opacity-100',
                  'lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100',
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
                      <ArrowUp className="size-3.5" />
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
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                {onRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive"
                    disabled={chapters.length === 1}
                    onClick={() => onRemove(chapter._id)}
                    aria-label={`删除${chapter.title}`}
                  >
                    <Trash2 className="size-3.5" />
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
