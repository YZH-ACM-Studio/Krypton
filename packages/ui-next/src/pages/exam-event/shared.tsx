import { useEffect, useState } from 'react';
import { DomainUserSearchOption, domainUserSearchLabel, loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  collaboratorChipLabel,
  ENDPOINT_STATUS_LABELS,
  formatDate,
  loadContestOption,
  presentInfraError,
  searchContests,
  STATUS_LABELS,
  type ConfirmPlan,
  type ContestOption,
  type EventStatus,
  type PreflightItem,
  type ProjectionItem,
} from './model';

export function statusBadge(status: EventStatus) {
  const label = STATUS_LABELS[status];
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-fg">
        <StatusDot tone="success" pulse />
        {label}
      </span>
    );
  }
  if (status === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-info-fg">
        <StatusDot tone="info" />
        {label}
      </span>
    );
  }
  if (status === 'ended') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
        <StatusDot />
        {label}
      </span>
    );
  }
  return <Badge tone="neutral">{label}</Badge>;
}

export function MutationNotice({ error, success }: { error: string | null; success?: string | null }) {
  if (!error && !success) return null;
  const presented = error ? presentInfraError(error) : null;
  if (!presented) return <Alert tone="success">{success}</Alert>;
  return (
    <Alert tone="danger">
      <p>{presented.summary}</p>
      {presented.raw ? (
        <details className="mt-2 text-xs text-fg-subtle">
          <summary className="cursor-pointer text-sm text-fg">技术细节</summary>
          <p className="mt-1 break-all font-mono">{presented.raw}</p>
        </details>
      ) : null}
    </Alert>
  );
}

export function PreflightReadinessBadge({ item }: { item: PreflightItem }) {
  if (item.ready) return <Badge tone="success">就绪</Badge>;
  if (item.compatible === null) return <Badge tone="neutral">未知</Badge>;
  return <Badge tone="danger">阻塞</Badge>;
}

export function EndpointStatusBadge({ status }: { status: ProjectionItem['status'] }) {
  const label = ENDPOINT_STATUS_LABELS[status];
  if (status === 'applied') return <Badge tone="success">{label}</Badge>;
  if (status === 'failed' || status === 'rejected') return <Badge tone="danger">{label}</Badge>;
  if (status === 'offline' || status === 'expired' || status === 'queued' || status === 'sent') {
    return <Badge tone="warning">{label}</Badge>;
  }
  return <Badge tone="neutral">{label}</Badge>;
}

export function ConfirmActionDialog({ plan, busy, error, onClose }: { plan: ConfirmPlan | null; busy: boolean; error: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && !busy && onClose()}>
      {plan ? (
        <DialogContent size="md" onClose={busy ? undefined : onClose}>
          <DialogHeader>
            <DialogTitle>{plan.title}</DialogTitle>
            <DialogDescription>{plan.description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <MutationNotice error={error} />
            {plan.facts.map((fact) => (
              <div key={fact.label} className="grid gap-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 sm:grid-cols-[7rem_1fr]">
                <span className="text-xs font-medium text-fg-subtle">{fact.label}</span>
                <span className="min-w-0 break-words text-sm">{fact.value}</span>
              </div>
            ))}
            {plan.details?.length ? (
              <details className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-fg-subtle">详细标识</summary>
                <div className="mt-2 space-y-2">
                  {plan.details.map((fact) => (
                    <div key={fact.label} className="grid gap-1 sm:grid-cols-[7rem_1fr]">
                      <span className="text-xs font-medium text-fg-subtle">{fact.label}</span>
                      <span className="min-w-0 break-words font-mono text-xs">{fact.value}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} autoFocus onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              variant={plan.tone === 'destructive' ? 'danger' : 'primary'}
              disabled={busy}
              loading={busy}
              onClick={() => void plan.run()}
            >
              {plan.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function ContestSearchSelect({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (contestId: string, option: ContestOption | null) => void;
}) {
  const [known, setKnown] = useState<ContestOption | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [titleState, setTitleState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  useEffect(() => {
    if (!value) {
      setKnown(null);
      setTitleState('idle');
      return;
    }
    if (known?.contestId === value) {
      setTitleState('idle');
      return;
    }
    let current = true;
    setTitleState('loading');
    void loadContestOption(value)
      .then((option) => {
        if (!current) return;
        setKnown(option);
        setTitleState('idle');
      })
      .catch(() => {
        if (!current) return;
        setKnown(null);
        setTitleState('unavailable');
      });
    return () => {
      current = false;
    };
  }, [known, value]);
  const current =
    known && known.contestId === value
      ? known
      : value
        ? {
            contestId: value,
            title: titleState === 'unavailable' ? '比赛标题不可用' : '加载比赛…',
            beginAt: '',
            endAt: '',
          }
        : null;
  return (
    <div className="space-y-2">
      <MutationNotice error={searchError} />
      <div role="group" aria-label="Krypton 比赛" aria-disabled={disabled || undefined}>
        <MultiSelect<ContestOption>
          value={current ? [current] : []}
          onChange={(items) => {
            const next = items[0] || null;
            setKnown(next);
            setSearchError(null);
            setTitleState('idle');
            onChange(next?.contestId || '', next);
          }}
          loadOptions={async (query) => {
            setSearchError(null);
            try {
              return await searchContests(query);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : '搜索比赛失败';
              setSearchError(message);
              throw cause;
            }
          }}
          getKey={(item) => item.contestId}
          getLabel={(item) => item.title}
          getDescription={(item) => (item.beginAt && item.endAt ? `${formatDate(item.beginAt)} → ${formatDate(item.endAt)}` : '')}
          renderChip={(item) => (
            <span>
              {item.title}
              {item.beginAt && item.endAt ? (
                <span className="ml-1 text-2xs text-fg-subtle">
                  {formatDate(item.beginAt)} → {formatDate(item.endAt)}
                </span>
              ) : null}
            </span>
          )}
          name={name}
          maxItems={1}
          disabled={disabled}
          placeholder="搜索比赛标题"
          emptyText={searchError || '没有匹配的比赛'}
        />
      </div>
    </div>
  );
}

export function CollaboratorSelect({
  domainId,
  value,
  onChange,
  disabled,
}: {
  domainId: string;
  value: DomainUserOption[];
  onChange: (users: DomainUserOption[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="协作者" aria-disabled={disabled || undefined}>
      <MultiSelect<DomainUserOption>
        value={value}
        onChange={onChange}
        loadOptions={(query) => loadDomainUsers(domainId, query)}
        getKey={(item) => String(item._id)}
        getLabel={domainUserSearchLabel}
        renderChip={(item) => <span>{collaboratorChipLabel(item)}</span>}
        renderOption={(item) => <DomainUserSearchOption user={item} />}
        disabled={disabled}
        placeholder="搜索 UID / OJ 用户 / 学号 / 姓名"
        emptyText="没有匹配的用户"
      />
    </div>
  );
}
