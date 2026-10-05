/**
 * StudentCard — single student tile in the 卡片墙.
 *
 * Layout (CLIENT_PROCTOR_MONITORING_DESIGN §8.2):
 *
 *   ┌─────────────────────────────────┐
 *   │ ┌─────────────────────────────┐ │
 *   │ │ 16:9 recent screenshot      │ │
 *   │ └─────────────────────────────┘ │
 *   ├─────────────────────────────────┤
 *   │ 👤  张三                          │
 *   │     20231001 · #A3F2              │
 *   │ 🟢 在线 · 47min                   │
 *   │ ⚠ 2 异常                         │
 *   └─────────────────────────────────┘
 *
 * Interactions:
 *   - single click → opens StudentDetailSheet (callback up to parent)
 *   - double click → opens LivePlayerDialog directly (callback up to parent)
 */
import { Activity, AlertTriangle, ImageIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { VigilStudentCard as StudentData, VigilStudentStatus } from '@/lib/vigil-api';
import { getCachedVigilBaseUrl } from '@/lib/vigil-api';
import { cn } from '@/lib/cn';

/**
 * Server returns thumbnail path relative to vigil-server (e.g.
 * `/api/screenshots/{sid}/thumbnail`). The card is rendered inside the
 * OJ page (10.1.234.2) so a relative thumbnail path would 404 — prefix the
 * cached vigilBaseUrl so the browser hits vigil directly.
 */
function absoluteThumb(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null;
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  const base = getCachedVigilBaseUrl();
  if (!base) return maybeUrl;
  return `${base.replace(/\/+$/, '')}${maybeUrl.startsWith('/') ? '' : '/'}${maybeUrl}`;
}

export function statusLabel(status: VigilStudentStatus): string {
  switch (status) {
    case 'locked':
      return '已锁屏';
    case 'anomaly':
      return '异常';
    case 'offline':
      return '离线';
    case 'disconnected':
      return '未连接';
    case 'ended':
      return '已结束';
    case 'online':
    default:
      return '在线';
  }
}

// 在线 success、离线 neutral。异常是告警，锁屏是违规处置。
const STATUS_TONE: Record<VigilStudentStatus, BadgeTone> = {
  online: 'success',
  anomaly: 'warning',
  offline: 'neutral',
  disconnected: 'neutral',
  locked: 'danger',
  ended: 'neutral',
};

export function StatusPill({ status }: { status: VigilStudentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot size="sm">
      {statusLabel(status)}
    </Badge>
  );
}

interface StudentCardProps {
  student: StudentData;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function StudentCard({ student, onClick, onDoubleClick }: StudentCardProps) {
  const machineShortHash = student.machineId.slice(0, 6).toUpperCase();
  const thumb = absoluteThumb(student.recentScreenshotUrl);

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title="单击查看详情 · 双击打开直播"
      className={cn(
        'w-full min-w-0 shrink flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg p-0 text-left font-normal shadow-xs hover:border-line-strong hover:bg-surface',
        'h-auto! whitespace-normal! active:scale-100!',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-surface-sunken">
        {thumb ? (
          <img
            src={thumb}
            alt={`${student.name} 截屏`}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-fg-subtle">
            <ImageIcon className="size-8!" />
          </div>
        )}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {student.manualRecording === true ? (
            <Badge tone="danger" dot size="sm">录制中</Badge>
          ) : null}
          <StatusPill status={student.status} />
        </div>
      </div>

      <div className="w-full space-y-1.5 px-3 py-2.5">
        <div className="min-w-0">
          <p className="min-w-0 truncate text-sm font-medium text-fg">{student.name}</p>
          <p className="min-w-0 truncate font-mono text-2xs text-fg-subtle">
            {student.studentId || '—'} · #{machineShortHash}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 text-2xs">
          {student.examSeconds != null ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-fg-subtle tabular">
              <Activity className="size-3! shrink-0" />
              {formatExamTimeShort(student.examSeconds)}
            </span>
          ) : (
            <span />
          )}
          {student.eventCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-warning-fg tabular">
              <AlertTriangle className="size-3!" />
              {student.eventCount} 异常
            </span>
          )}
        </div>
      </div>
    </Button>
  );
}

function formatExamTimeShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}min`;
}
