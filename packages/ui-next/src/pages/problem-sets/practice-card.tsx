import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/display';
import { cn } from '@/lib/cn';
import { formatPlainTextSummary } from '@/lib/format';
import type { PracticeRow } from './model';

const STAGE_STYLE = {
  done: { className: 'bg-success', label: '已完成' },
  progress: { className: 'bg-info', label: '进行中' },
  open: { className: 'bg-surface-active', label: '未开始' },
  locked: { className: 'bg-surface-sunken', label: '前置阶段未完成' },
} as const;

export function PracticeCard({ row, footer }: { row: PracticeRow; footer?: ReactNode }) {
  const percent = row.problemCount > 0 ? Math.round(row.doneCount / row.problemCount * 100) : 0;
  const done = row.problemCount > 0 && row.doneCount === row.problemCount;
  const inProgress = row.enrolled || row.doneCount > 0 || row.stages.some((stage) => stage.status === 'progress');
  const content = (
    <>
    <div className="flex items-start justify-between gap-2">
      <h3 className="min-w-0 flex-1 line-clamp-2 text-md font-semibold leading-tight text-fg">{row.title}</h3>
      <Badge tone={done ? 'success' : inProgress ? 'info' : 'neutral'} size="sm">
        {done ? '已完成' : inProgress ? '进行中' : '未开始'}
      </Badge>
    </div>
    {row.sourceLabels.length > 0 ? (
      <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
        {row.sourceLabels.map((label, index) => (
          <Badge key={`${index}:${label}`} variant="outline" tone="neutral" size="sm">{label}</Badge>
        ))}
      </span>
    ) : null}
    <p className="min-h-10 line-clamp-2 text-sm text-fg-muted text-pretty">
      {formatPlainTextSummary(row.description) || '精选题集'}
    </p>
    {row.stages.length > 0 ? (
      <div className="flex h-3 w-full gap-0.5" aria-label="阶段进度">
        {row.stages.map((stage) => (
          <div
            key={stage.id}
            className={cn('flex-1 rounded-sm', STAGE_STYLE[stage.status].className)}
            title={`${stage.title} · ${STAGE_STYLE[stage.status].label}`}
          />
        ))}
      </div>
    ) : null}
    <div className="flex items-center justify-between text-xs text-fg-subtle">
      <span className="inline-flex items-center gap-1" title="参与人数">
        <Users className="size-3" aria-hidden="true" />
        <span className="tabular">{row.participantCount}</span>
      </span>
      <span className="tabular">{row.stageCount} 段 · {row.problemCount} 题</span>
    </div>
    {row.enrolled ? (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-subtle">进度</span>
          <span className="tabular text-fg">{row.doneCount}/{row.problemCount} · {percent}%</span>
        </div>
        <Progress value={percent} />
      </div>
    ) : null}
    </>
  );
  if (footer !== undefined) {
    return (
      <article className="flex h-full w-full min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-(--dur-2) ease-(--ease-out) hover:border-line-strong hover:shadow-sm">
        <a href={row.href} className="flex min-w-0 flex-1 flex-col gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {content}
        </a>
        <div className="mt-auto border-t border-line-subtle pt-3">{footer}</div>
      </article>
    );
  }
  return (
    <a href={row.href} className="flex h-full w-full min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-(--dur-2) ease-(--ease-out) hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {content}
    </a>
  );
}
