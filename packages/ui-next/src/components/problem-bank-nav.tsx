import { cn } from '@/lib/cn';

export function ProblemBankNav({
  active,
  problemsUrl,
  reviewUrl,
  canReview,
  namespaceUrl = '',
  canManageNamespaces = false,
  sourceTemplateUrl = '',
}: {
  active: 'problems' | 'review' | 'namespaces' | 'sources';
  problemsUrl: string;
  reviewUrl: string;
  canReview: boolean;
  namespaceUrl?: string;
  canManageNamespaces?: boolean;
  sourceTemplateUrl?: string;
}) {
  if (!canReview && !canManageNamespaces && !sourceTemplateUrl) return null;
  const items = [
    { key: 'problems' as const, label: '全部题目', href: problemsUrl },
    ...(canReview && reviewUrl ? [{ key: 'review' as const, label: '审核队列', href: reviewUrl }] : []),
    ...(canManageNamespaces && namespaceUrl ? [{ key: 'namespaces' as const, label: '题号命名空间', href: namespaceUrl }] : []),
    ...(sourceTemplateUrl ? [{ key: 'sources' as const, label: '来源模板', href: sourceTemplateUrl }] : []),
  ];
  return (
    <nav aria-label="题库工作区" className="-mb-px flex min-w-0 gap-5 overflow-x-auto">
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <a
            key={item.key}
            href={item.href}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'relative flex h-10 shrink-0 items-center text-sm font-medium',
              'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)',
              selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {item.label}
            {selected ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-fg" /> : null}
          </a>
        );
      })}
    </nav>
  );
}
