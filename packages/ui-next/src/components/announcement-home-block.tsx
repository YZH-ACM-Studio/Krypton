/**
 * Top-of-homepage announcement block. Fetches pinned + latest 3 from
 * /api/announce/homepage and renders them in a card with the pinned items
 * styled with a primary tint. Returns null if no visible announcements.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Pin } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { Panel } from '@/components/ui/panel';
import { fetchHydroResponse } from '@/lib/error-presenter';
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

const CATEGORY_TONE: Record<string, BadgeTone> = {
  gray: 'neutral',
  amber: 'warning',
  blue: 'info',
  purple: 'violet',
  green: 'success',
  rose: 'danger',
  sky: 'info',
};

function categoryTone(color: string): BadgeTone {
  return CATEGORY_TONE[color] ?? 'neutral';
}

export function AnnouncementHomeBlock() {
  const [docs, setDocs] = useState<HomeAnnounce[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchHydroResponse('/api/announce/homepage', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setDocs(body.docs || []);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || docs.length === 0) return null;

  return (
    <Panel
      title="最新公告"
      flush
      actions={(
        <Button asChild variant="ghost" size="sm">
          <a href="/announce">
            查看全部
            <ArrowRight />
          </a>
        </Button>
      )}
    >
      <ul className="divide-y divide-line-subtle">
        {docs.map((doc) => (
          <li key={doc._id}>
            <a
              href={`/announce/${doc._id}`}
              className={cn('flex min-h-11 min-w-0 items-center gap-3 px-4 py-2.5 hover:bg-surface-hover', doc.pin && 'bg-brand-soft')}
            >
              {doc.pin ? <Pin className="size-3.5 shrink-0 text-warning-fg" /> : <span className="size-3.5 shrink-0" />}
              <Badge tone={categoryTone(doc.categoryColor)} size="sm" className="max-w-24 min-w-0 shrink-0 truncate">
                {doc.categoryName}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
              <span className="shrink-0 text-xs text-fg-subtle">
                <DateTime value={doc.publishAt} mode="date" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
