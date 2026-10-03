/**
 * Topbar FolderInput icon + pending file-collect count.
 * Fetches GET /api/collect/pending and links to /collect.
 */
import { useEffect, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchHydroResponse } from '@/lib/error-presenter';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePendingCount(body: unknown): number {
  if (!isRecord(body)) return 0;
  if (typeof body.count !== 'number' || !Number.isFinite(body.count)) return 0;
  return Math.max(0, Math.floor(body.count));
}

export function CollectPendingBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchHydroResponse('/api/collect/pending', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body: unknown) => {
        if (cancelled) return;
        setCount(parsePendingCount(body));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <a href="/collect" title="文件收集" aria-label="文件收集">
        <FolderInput />
        {count > 0 && (
          <Badge variant="solid" tone="danger" size="sm" className="absolute -top-0.5 -right-0.5">
            {count > 9 ? '9+' : count}
          </Badge>
        )}
      </a>
    </Button>
  );
}
