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
import type { VigilStudentCard as StudentData, VigilStudentStatus } from '@/lib/vigil-api';
import { getCachedVigilBaseUrl } from '@/lib/vigil-api';
import { cn } from '@/lib/cn';

/**
 * Server returns thumbnail path relative to vigil-server (e.g.
 * `/api/screenshots/{sid}/thumbnail`). The card is rendered inside the
 * OJ page (10.1.234.2) so a bare `<img src>` would 404 — prefix the
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
    case 'locked': return '已锁屏';
    case 'anomaly': return '异常';
    case 'offline': return '离线';
    case 'disconnected': return '未连接';
    case 'ended': return '已结束';
    case 'online':
    default: return '在线';
  }
}

/** Status → Tailwind class for the badge background + text. */
const STATUS_STYLES: Record<VigilStudentStatus, { bg: string; dot: string; ring: string }> = {
  locked: {
    bg: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-500',
    ring: 'border-purple-500/40',
  },
  anomaly: {
    bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    ring: 'border-amber-500/40',
  },
  offline: {
    bg: 'bg-red-500/15 text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
    ring: 'border-red-500/40',
  },
  disconnected: {
    bg: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
    ring: 'border-muted-foreground/20',
  },
  online: {
    bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    ring: 'border-emerald-500/40',
  },
  // 已结束(交卷/作废/换机)——比 disconnected 更"盖棺定论"的灰,沉底用。
  ended: {
    bg: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
    dot: 'bg-slate-400',
    ring: 'border-slate-400/30',
  },
};

export function StatusPill({ status }: { status: VigilStudentStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
      style.bg,
    )}>
      <span className={cn('size-1.5 rounded-full', style.dot, status === 'online' && 'animate-pulse')} />
      {statusLabel(status)}
    </span>
  );
}

interface StudentCardProps {
  student: StudentData;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function StudentCard({ student, onClick, onDoubleClick }: StudentCardProps) {
  const style = STATUS_STYLES[student.status];
  const machineShortHash = student.machineId.slice(0, 6).toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-all',
        'hover:shadow-md hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        style.ring,
      )}
      title="单击查看详情 · 双击打开直播"
    >
      {/* Screenshot thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {student.recentScreenshotUrl ? (
          <img
            src={absoluteThumb(student.recentScreenshotUrl) ?? undefined}
            alt={`${student.name} 截屏`}
            className="size-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <ImageIcon className="size-8" />
          </div>
        )}
        {/* Status badge over thumbnail */}
        <div className="absolute right-1.5 top-1.5">
          <StatusPill status={student.status} />
        </div>
      </div>

      {/* Identity + status */}
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{student.name}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {student.studentId || '—'} · #{machineShortHash}
          </p>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          {student.examSeconds != null ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Activity className="size-3" />
              {formatExamTimeShort(student.examSeconds)}
            </span>
          ) : <span />}
          {student.eventCount > 0 && (
            <span className="inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              {student.eventCount} 异常
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function formatExamTimeShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}min`;
}
