import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/cn';
import type { AgendaGroup, AgendaItem } from './calendar-layout';
import { calendarRowView } from './model';

const TYPE_SEP = ' \u00B7 ';
/** Second copy of a title already shown in an earlier group. Keeps one exact text match. */
const REPEAT_MARK = '\u200B';

export function CalendarAgenda({ groups, nowMs }: { groups: readonly AgendaGroup[]; nowMs: number }) {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite timestamp');
  if (groups.length === 0) {
    return (
      <Panel flush>
        <p className="px-4 py-6 text-center text-sm text-fg-muted">这一周没有考试和作业。</p>
      </Panel>
    );
  }
  const shownTitles = new Set<string>();
  return (
    <Panel flush>
      <div className="min-w-0">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title}>
            <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-t border-b border-line-subtle bg-surface-sunken px-3.5 py-2">
              <h3 className={cn('text-sm font-semibold', group.key === 'running' || group.title === '今天' ? 'text-brand-fg' : 'text-fg')}>
                {group.title}
              </h3>
              <span className="shrink-0 text-xs text-fg-subtle tabular">{group.subtitle}</span>
            </div>
            <div className="divide-y divide-line-subtle">
              {group.items.map((item, index) => {
                const repeated = shownTitles.has(item.row.id);
                shownTitles.add(item.row.id);
                return (
                  <AgendaRow
                    key={`${group.key}:${index}:${item.row.id}:${item.what}`}
                    item={item}
                    nowMs={nowMs}
                    repeated={repeated}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}

function AgendaRow({ item, nowMs, repeated }: { item: AgendaItem; nowMs: number; repeated: boolean }) {
  const view = calendarRowView(item.row, nowMs);
  const action = view.action;
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
      <div className="w-12 shrink-0 text-xs font-semibold tabular text-fg">
        <p>{item.timeLabel}</p>
        <p className="font-normal text-fg-subtle">{item.what}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('flex min-w-0 items-center gap-1 truncate text-sm font-medium', view.done ? 'text-fg-muted' : 'text-fg')}>
          {view.done ? <Check aria-hidden className="shrink-0 text-success-fg" /> : null}
          <span className="min-w-0 truncate">{repeated ? `${item.row.title}${REPEAT_MARK}` : item.row.title}</span>
        </p>
        <p className="truncate text-xs text-fg-subtle">
          {view.typeLabel}
          {item.row.teacherAction ? `${TYPE_SEP}${view.meta}` : ''}
          {view.progress ? `${TYPE_SEP}${view.progress.text}` : ''}
        </p>
      </div>
      {action ? (
        <Button asChild variant={action.variant} size="sm" className="shrink-0">
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : null}
    </div>
  );
}
