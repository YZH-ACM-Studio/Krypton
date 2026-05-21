/**
 * Megaphone icon + unread announcements dropdown for the topbar.
 *
 * Polls /api/announce/unread on mount to fetch the count + latest 20
 * unread announcements for the current user. Clicking the icon toggles
 * a fixed-position popover anchored to the icon.
 */
import { useEffect, useRef, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { cn } from '@/lib/cn';

interface UnreadDoc {
  _id: string;
  title: string;
  category: string;
  categoryName: string;
  categoryColor: string;
  pin: boolean;
  publishAt: string;
}

const COLOR_CLASSES: Record<string, string> = {
  gray: 'bg-muted text-muted-foreground',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  blue: 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
  purple: 'bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200',
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  rose: 'bg-rose-100 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  sky: 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
};

export function AnnouncementPopover({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [docs, setDocs] = useState<UnreadDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch unread count on mount (cheap — just count + 20 titles).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch('/api/announce/unread', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setCount(body.count || 0);
        setDocs(body.docs || []);
        setLoaded(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [signedIn]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative size-8"
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
        title="公告"
      >
        <Megaphone className="size-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-[360px] rounded-lg border bg-popover shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-medium">公告</span>
            {count > 0 && <Badge variant="secondary" className="text-[10px]">{count} 条未读</Badge>}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">加载中…</p>
            ) : docs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">没有未读公告</p>
            ) : (
              <ul className="divide-y">
                {docs.map((doc) => (
                  <li key={doc._id}>
                    <a
                      href={`/announce/${doc._id}`}
                      className="flex items-start gap-2 px-4 py-3 transition-colors hover:bg-accent/40"
                    >
                      {doc.pin && <Pin className="mt-0.5 size-3 shrink-0 text-amber-600" />}
                      <span className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        COLOR_CLASSES[doc.categoryColor] || COLOR_CLASSES.gray,
                      )}>
                        {doc.categoryName}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          <DateTime value={doc.publishAt} mode="relative" />
                        </p>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t px-4 py-2">
            <a href="/announce" className="text-xs text-primary hover:underline">
              查看全部公告 →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
