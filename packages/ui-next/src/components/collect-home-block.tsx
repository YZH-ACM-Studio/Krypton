/**
 * Homepage right-column pending file-collect prompt.
 * Fetches GET /api/collect/pending and returns null when count is 0.
 */
import { useEffect, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { fetchHydroResponse } from '@/lib/error-presenter';

interface PendingCollectDoc {
  _id: string;
  title: string;
  dueAt: string;
}

interface PendingCollectPayload {
  count: number;
  docs: PendingCollectDoc[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePendingDoc(value: unknown): PendingCollectDoc | null {
  if (!isRecord(value)) return null;
  const id = typeof value._id === 'string' ? value._id : '';
  const title = typeof value.title === 'string' ? value.title : '';
  if (!id || !title) return null;
  return {
    _id: id,
    title,
    dueAt: typeof value.dueAt === 'string' ? value.dueAt : '',
  };
}

function parsePendingPayload(body: unknown): PendingCollectPayload {
  if (!isRecord(body)) return { count: 0, docs: [] };
  const docs = Array.isArray(body.docs)
    ? body.docs.flatMap((item) => {
        const doc = parsePendingDoc(item);
        return doc ? [doc] : [];
      })
    : [];
  const count = typeof body.count === 'number' && Number.isFinite(body.count) ? Math.max(0, Math.floor(body.count)) : 0;
  return { count, docs };
}

export function CollectHomeBlock() {
  const [count, setCount] = useState(0);
  const [docs, setDocs] = useState<PendingCollectDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchHydroResponse('/api/collect/pending', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body: unknown) => {
        if (cancelled) return;
        const payload = parsePendingPayload(body);
        setCount(payload.count);
        setDocs(payload.docs);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || count === 0) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <FolderInput className="size-4 text-primary" />
          <span className="text-sm font-semibold">未交文件</span>
        </div>
        <ul className="divide-y">
          {docs.slice(0, 3).map((doc) => (
            <li key={doc._id}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    截止 <DateTime value={doc.dueAt} mode="datetime" />
                  </p>
                </div>
                <a href={`/collect/${doc._id}`} className="shrink-0 text-xs text-primary hover:underline">
                  去交文件
                </a>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t px-4 py-2">
          <a href="/collect" className="text-xs text-primary hover:underline">
            查看全部 →
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
