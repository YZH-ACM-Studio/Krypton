import { type JSX, type ReactNode } from 'react';
import { CheckCircle2, Crosshair, Link2, LocateFixed, Unlink2, UserRoundCog, X } from 'lucide-react';
import { TechDetails, type FactItem } from '@/components/admin/fact-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DescriptionList, Panel } from '@/components/ui/panel';
import {
  compactEndpoint,
  DISABLED_REASON_LABELS,
  FACING_LABELS,
  formatDate,
  STATUS_DOT,
  STATUS_LABELS,
  type EndpointPreflight,
  type PairingEntry,
  type PairingWindow,
  type SeatBinding,
  type SeatHistoryEntry,
  type SeatOperationalEntry,
  type SeatReference,
  type SeatView,
} from './model';

interface SeatDetailProps {
  view: SeatView | null;
  code: string | null;
  window: PairingWindow | null;
  busy: boolean;
  history: SeatHistoryEntry[];
  displayName: (uid: number | null | undefined) => string;
  preflightState: EndpointPreflight['state'];
  onOpenSingle: () => void;
  onOpenReplacement: () => void;
  onConfirmReplacement: () => void;
  onCancelPairing: () => void;
  onUnbind: () => void;
}

function PairingCode({ code, hint }: { code: string | null; hint: string }): JSX.Element {
  const displayCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
  return (
    <div className="rounded-lg border border-info-line bg-info-soft px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-info-fg">当前一次性配对码</span>
        <Badge variant="outline">尾号 {hint}</Badge>
      </div>
      {displayCode ? (
        <p className="mt-2 select-all break-all font-mono text-lg font-semibold tracking-wider text-fg tabular">{displayCode}</p>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">页面刷新后不会恢复明文码；请关闭当前窗口并重新生成。</p>
      )}
    </div>
  );
}

function activeSeatBinding(view: SeatView): SeatBinding | null {
  if (view.binding?.status === 'active' && view.binding.endpointId) return view.binding;
  return null;
}

function openPairingEntry(view: SeatView): PairingEntry | null {
  const entry = view.entry;
  if (entry && (entry.status === 'open' || entry.status === 'claimed')) return entry;
  return null;
}

function versionDetail(view: SeatView, preflightState: EndpointPreflight['state']): string | null {
  const preflight = view.preflight;
  if (activeSeatBinding(view) == null || preflightState !== 'available' || preflight == null) return null;
  const protocol = preflight.protocolVersion ?? '未知';
  return `Service ${preflight.serviceVersion || '未知'} · 协议 ${protocol} · 凭据 ${preflight.credentialStatus || '未知'}`;
}

function OperationalFacts({ entry }: { entry: SeatOperationalEntry }): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={entry.enabled ? 'neutral' : 'danger'} variant="soft">{entry.enabled ? '可用' : '已禁用'}</Badge>
      <span>朝向：{FACING_LABELS[entry.facing]}</span>
      {!entry.enabled && entry.disabledReason != null ? <span>原因：{DISABLED_REASON_LABELS[entry.disabledReason]}</span> : null}
      {entry.note ? <span className="break-words">备注：{entry.note}</span> : null}
    </div>
  );
}

function descriptionItems(
  view: SeatView,
  binding: SeatBinding | null,
  preflightState: EndpointPreflight['state'],
  displayName: SeatDetailProps['displayName'],
): { term: string; detail: ReactNode }[] {
  const items: { term: string; detail: ReactNode }[] = [];
  const endpointId = binding?.endpointId;
  if (binding != null && endpointId) {
    items.push({
      term: '终端',
      detail: <span className="font-mono text-xs break-all">{endpointId}</span>,
    });
    items.push({
      term: '绑定',
      detail: `r${binding.revision} · ${formatDate(binding.updatedAt)} · ${displayName(binding.updatedBy)}`,
    });
  }
  const version = versionDetail(view, preflightState);
  if (version != null) items.push({ term: '版本', detail: version });
  items.push({ term: '运行配置', detail: <OperationalFacts entry={view.operational} /> });
  return items;
}

function referenceSubtitle(reference: SeatReference): string {
  const state = reference.eventState === 'active' ? '进行中' : '未来';
  return `${state} · ${formatDate(reference.startAt)} – ${formatDate(reference.endAt)} · 目标 r${reference.targetRevision}`;
}

function historyEndpoints(entry: SeatHistoryEntry): string {
  switch (entry.action) {
    case 'replace':
      return `${compactEndpoint(entry.previousEndpointId)} → ${compactEndpoint(entry.endpointId)}`;
    case 'bind':
      return compactEndpoint(entry.endpointId);
    case 'unbind':
      return compactEndpoint(entry.previousEndpointId);
    default: {
      const unexpected: never = entry.action;
      throw new Error(`未知绑定历史动作：${String(unexpected)}`);
    }
  }
}

function techItems(view: SeatView): FactItem[] {
  const items: FactItem[] = [{ label: 'sourceSeatId', value: view.seat.sourceSeatId }];
  if (view.binding != null) items.push({ label: 'bindingId', value: view.binding.bindingId });
  items.push(
    { label: '布局状态', value: view.seat.status },
    { label: '绑定版本', value: String(view.binding?.revision || 0) },
  );
  return items;
}

export function SeatDetail({
  view,
  code,
  window: pairingWindow,
  busy,
  history,
  displayName,
  preflightState,
  onOpenSingle,
  onOpenReplacement,
  onConfirmReplacement,
  onCancelPairing,
  onUnbind,
}: SeatDetailProps): JSX.Element {
  if (view === null) {
    return (
      <Panel>
        <EmptyState compact icon={<LocateFixed />} title="选择一个实体座位" description="可点击布局，或从搜索框后用方向键遍历。" />
      </Panel>
    );
  }

  const binding = activeSeatBinding(view);
  const openEntry = openPairingEntry(view);
  const claimedReplacement = view.entry?.mode === 'replace' && view.entry.status === 'claimed';
  const canOpen = pairingWindow == null;
  const showGenerate = binding == null && canOpen;
  const showStartReplacement = binding != null && openEntry == null && canOpen;
  const showUnbind = binding != null && !claimedReplacement;
  const showActions = showGenerate || showStartReplacement || claimedReplacement || showUnbind;

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">座位</p>
            <h2 className="text-lg font-semibold break-words">{view.seat.label || view.seat.sourceSeatId}</h2>
          </div>
          <Badge className="shrink-0" tone={STATUS_DOT[view.status].tone} variant="soft">
            {STATUS_LABELS[view.status]}
          </Badge>
        </div>
        {openEntry ? <PairingCode code={code} hint={openEntry.codeHint} /> : null}
        {claimedReplacement ? (
          <div className="rounded-lg border border-warning-line bg-warning-soft px-3 py-3 text-xs">
            <p className="font-medium text-warning-fg">新终端已完成身份认领，等待教师确认</p>
            <p className="mt-1 break-all font-mono text-warning-fg">{view.entry?.claimedEndpointId}</p>
          </div>
        ) : null}
        <DescriptionList items={descriptionItems(view, binding, preflightState, displayName)} />
        {view.references.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
              活动引用
            </p>
            {view.references.map((reference) => (
              <a
                key={`${reference.kind}:${reference.eventId}:${reference.targetRevision}`}
                href={`/admin/exam-infrastructure/events/${reference.eventId}`}
                className="block min-w-0 rounded-lg border border-line px-3 py-2 text-xs hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-medium">{reference.eventTitle}</span>
                <span className="ml-2 text-fg-subtle">{referenceSubtitle(reference)}</span>
              </a>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-fg-muted">此座位历史</h3>
          {history.length === 0 ? (
            <p className="text-xs text-fg-subtle">这个座位还没有绑定记录。</p>
          ) : (
            <ol className="flex list-none flex-col gap-3">
              {history.map((entry) => (
                <li key={entry.key}>
                  <p className="text-sm">
                    <span className="font-medium">{entry.label}</span>
                    {` · ${formatDate(entry.at)} · ${displayName(entry.actorUid)}`}
                  </p>
                  <p className="font-mono text-2xs text-fg-subtle">{historyEndpoints(entry)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        {showActions ? (
          <div className="grid gap-2 border-t border-line-subtle pt-4">
            {showGenerate ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onOpenSingle}>
                <Crosshair aria-hidden="true" />
                为此座位生成配对码
              </Button>
            ) : null}
            {showStartReplacement ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onOpenReplacement}>
                <UserRoundCog aria-hidden="true" />
                开始换机识别
              </Button>
            ) : null}
            {claimedReplacement ? (
              <Button type="button" variant="soft" disabled={busy} onClick={onConfirmReplacement}>
                <CheckCircle2 aria-hidden="true" />
                确认换机
              </Button>
            ) : null}
            {claimedReplacement ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onCancelPairing}>
                <X aria-hidden="true" />
                取消本次认领
              </Button>
            ) : null}
            {showUnbind ? (
              <Button type="button" variant="danger-soft" disabled={busy} onClick={onUnbind}>
                <Unlink2 aria-hidden="true" />
                解除长期绑定
              </Button>
            ) : null}
          </div>
        ) : null}
        <TechDetails items={techItems(view)} />
      </div>
    </Panel>
  );
}
