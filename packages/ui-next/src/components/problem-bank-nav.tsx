import { cn } from '@/lib/cn';

export function ProblemBankNav({
  active,
  problemsUrl,
  reviewUrl,
  canReview,
}: {
  active: 'problems' | 'review';
  problemsUrl: string;
  reviewUrl: string;
  canReview: boolean;
}) {
  if (!canReview) return null;
  const items = [
    { key: 'problems' as const, label: '全部题目', href: problemsUrl },
    { key: 'review' as const, label: '审核队列', href: reviewUrl },
  ];
  return (
    <nav aria-label="题库工作区" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-max items-center gap-1 rounded-xl bg-muted/70 p-1">
        {items.map((item) => {
          const selected = item.key === active;
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium',
                'transition-[color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
