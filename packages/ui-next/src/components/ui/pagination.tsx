import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Pagination({
  current,
  total,
  baseUrl,
}: {
  current: number;
  total: number;
  baseUrl: string;
}) {
  if (total <= 1) return null;

  const pages: (number | '...')[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  const href = (p: number) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}page=${p}`;
  };

  return (
    <nav className="flex items-center justify-center gap-1 pt-4">
      <Button asChild variant="ghost" size="icon" disabled={current <= 1}>
        <a href={current > 1 ? href(current - 1) : '#'}>
          <ChevronLeft className="size-4" />
        </a>
      </Button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} className="px-2 text-sm text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            asChild
            variant={p === current ? 'default' : 'ghost'}
            size="icon"
          >
            <a href={href(p)}>{p}</a>
          </Button>
        ),
      )}
      <Button asChild variant="ghost" size="icon" disabled={current >= total}>
        <a href={current < total ? href(current + 1) : '#'}>
          <ChevronRight className="size-4" />
        </a>
      </Button>
    </nav>
  );
}
