import { type JSX } from 'react';
import { Activity, Ban, LocateFixed, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/display';
import {
  formatDate,
  pairingProgress,
  remainingLabel,
  type PairingWindow,
} from './model';

export function PairingCard({
  window: pairingWindow,
  completed,
  now,
  busy,
  recentSeatId,
  displayName,
  onClose,
  onLocateRecent,
}: {
  window: PairingWindow;
  completed: boolean;
  now: number;
  busy: boolean;
  recentSeatId: string | null;
  displayName: (uid: number | null | undefined) => string;
  onClose: () => void;
  onLocateRecent: () => void;
}): JSX.Element {
  const progress = pairingProgress(pairingWindow);
  const boundText = progress.cancelled > 0
    ? `已绑定 ${progress.bound} / ${progress.total} · 已取消 ${progress.cancelled}`
    : `已绑定 ${progress.bound} / ${progress.total}`;
  return (
    <section aria-label="当前配对窗口" className="flex flex-col gap-3 rounded-lg border border-info-line bg-info-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-info-fg">
          <Activity className="size-4 shrink-0" aria-hidden="true" />
          {`${completed ? '配对已完成' : '配对窗口进行中'} · r${pairingWindow.revision}`}
        </p>
        {completed ? null : (
          <span className="font-mono text-xs text-info-fg tabular">
            {`剩余 ${remainingLabel(pairingWindow.expiresAt, now)}`}
          </span>
        )}
      </div>
      <Progress
        value={progress.total ? ((progress.bound + progress.cancelled) / progress.total) * 100 : 0}
        tone="brand"
        size="sm"
      />
      <div className="text-xs text-fg-muted">
        <p>{boundText}</p>
        <p>{`由 ${displayName(pairingWindow.createdBy)} 于 ${formatDate(pairingWindow.createdAt)} 开启`}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {recentSeatId !== null ? (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onLocateRecent}>
            <LocateFixed />
            定位最近响应
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>
          {completed ? '关闭并继续下一台' : '关闭窗口'}
        </Button>
      </div>
    </section>
  );
}

export function RecentActionNotice({
  undoSeatLabel,
  revoke,
  busy,
  onUndo,
  onRevoke,
}: {
  undoSeatLabel: string | null;
  revoke: { endpointId: string; seatLabel: string } | null;
  busy: boolean;
  onUndo: () => void;
  onRevoke: () => void;
}): JSX.Element | null {
  if (undoSeatLabel === null && revoke === null) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
      {undoSeatLabel !== null ? (
        <p className="text-xs text-fg-muted">{`${undoSeatLabel} 刚刚完成绑定，可以撤销。`}</p>
      ) : null}
      {revoke !== null ? (
        <p className="text-xs text-fg-muted">{`${revoke.seatLabel} 已完成换机，旧终端凭据仍然有效。`}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {undoSeatLabel !== null ? (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onUndo}>
            <RotateCcw />
            撤销刚完成的绑定
          </Button>
        ) : null}
        {revoke !== null ? (
          <Button type="button" variant="danger-soft" size="sm" disabled={busy} onClick={onRevoke}>
            <Ban />
            吊销旧终端
          </Button>
        ) : null}
      </div>
    </div>
  );
}
