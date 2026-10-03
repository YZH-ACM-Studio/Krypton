/**
 * Megaphone icon + unread announcements popover for the topbar.
 *
 * Polls /api/announce/unread on mount for the count and the latest unread
 * announcements. The trigger stays in the topbar; Popover anchors the panel.
 */
import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { StatusDot } from '@/components/ui/display';
import { Popover } from '@/components/ui/menu';
import { fetchHydroResponse } from '@/lib/error-presenter';

interface UnreadDoc {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUnread(body: unknown): { count: number; docs: UnreadDoc[] } {
  if (!isRecord(body)) {
    throw new TypeError('公告未读响应不是对象');
  }
  const { count, docs } = body;
  if (count != null && typeof count !== 'number') {
    throw new TypeError('公告未读数量不是数字');
  }
  if (docs != null && !Array.isArray(docs)) {
    throw new TypeError('公告未读列表不是数组');
  }
  return {
    count: typeof count === 'number' && count ? count : 0,
    docs: Array.isArray(docs) ? docs as UnreadDoc[] : [],
  };
}

export function AnnouncementPopover({ signedIn }: { signedIn: boolean }) {
  const [count, setCount] = useState(0);
  const [docs, setDocs] = useState<UnreadDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Fetch unread count on mount (cheap — just count + 20 titles).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchHydroResponse('/api/announce/unread', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((body: unknown) => {
        if (cancelled) return;
        const unread = readUnread(body);
        setCount(unread.count);
        setDocs(unread.docs);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return (
    <Popover
      placement="bottom-end"
      // ds-allow DS004: 首选宽是 w-80，窄屏仍须取 min(360px, 100vw-1.5rem)，间距阶梯没有这一档
      className="w-80 w-[min(360px,calc(100vw-1.5rem))]"
      trigger={(props) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          title="公告"
          aria-label="公告"
          {...props}
        >
          <Megaphone />
          {count > 0 && (
            <Badge variant="solid" tone="danger" size="sm" className="absolute -top-0.5 -right-0.5">
              {count > 9 ? '9+' : count}
            </Badge>
          )}
        </Button>
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line-subtle bg-surface-raised px-4 py-2.5">
        <span className="text-sm font-medium text-fg">公告</span>
        {count > 0 && (
          <Badge tone="neutral" size="sm">
            {count}
            {' '}
            条未读
          </Badge>
        )}
      </div>
      {!loaded ? (
        <p className="px-4 py-8 text-center text-xs text-fg-subtle">加载中…</p>
      ) : docs.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-fg-subtle">没有未读公告</p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {docs.map((doc) => (
            <li key={doc._id}>
              <a href={`/announce/${doc._id}`} className="flex items-start gap-2 px-4 py-3 hover:bg-surface-hover">
                <StatusDot tone="brand" className="mt-1.5" />
                {doc.pin && <Pin className="mt-0.5 size-3.5 shrink-0 text-warning-fg" />}
                <Badge tone={categoryTone(doc.categoryColor)} size="sm" className="max-w-24 min-w-0 shrink-0 truncate">
                  {doc.categoryName}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{doc.title}</span>
                  <span className="mt-0.5 block text-2xs text-fg-subtle">
                    <DateTime value={doc.publishAt} mode="relative" />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="sticky bottom-0 border-t border-line-subtle bg-surface-raised px-4 py-2">
        <Button asChild variant="link" size="sm">
          <a href="/announce">查看全部公告 →</a>
        </Button>
      </div>
    </Popover>
  );
}
