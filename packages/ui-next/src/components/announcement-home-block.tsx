/**
 * Top-of-homepage announcement block. Fetches pinned + latest 3 from
 * /api/announce/homepage and renders them in a card with the pinned items
 * styled with a primary tint. Returns null if no visible announcements.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Megaphone, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { cn } from '@/lib/cn';

interface HomeAnnounce {
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

export function AnnouncementHomeBlock() {
  const [docs, setDocs] = useState<HomeAnnounce[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/announce/homepage', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setDocs(body.docs || []);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  if (!loaded || docs.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            <span className="text-sm font-semibold">最新公告</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
            <a href="/announce">
              查看全部
              <ArrowRight className="size-3" />
            </a>
          </Button>
        </div>
        <ul className="divide-y">
          {docs.map((doc) => (
            <li key={doc._id}>
              <a
                href={`/announce/${doc._id}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40',
                  doc.pin && 'bg-primary/5',
                )}
              >
                {doc.pin
                  ? <Pin className="size-3.5 shrink-0 text-amber-600" />
                  : <span className="size-3.5 shrink-0" />}
                <span className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  COLOR_CLASSES[doc.categoryColor] || COLOR_CLASSES.gray,
                )}>
                  {doc.categoryName}
                </span>
                <span className="flex-1 truncate text-sm font-medium">{doc.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <DateTime value={doc.publishAt} mode="date" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
