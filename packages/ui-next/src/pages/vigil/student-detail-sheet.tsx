/**
 * StudentDetailSheet — right-side drawer that opens from a card-wall click.
 *
 * Layout (CLIENT_PROCTOR_MONITORING_DESIGN §8.3):
 *
 *   ┌─────────────────────────────────────┐
 *   │ ✕ 姓名 学号                          │
 *   ├─────────────────────────────────────┤
 *   │ 状态信息卡片                          │
 *   ├─────────────────────────────────────┤
 *   │ [📷 实时截屏]  [📺 查看实时画面]      │
 *   │ [💬 发消息]    [🔒 锁屏]             │
 *   │ [📋 导出日志]  [🎞️ 录屏回放]         │
 *   ├─────────────────────────────────────┤
 *   │ 行为日志（无限滚动）                  │
 *   │  · 11:23  ⚠ ...                     │
 *   │  · 11:18  🟡 ...                    │
 *   └─────────────────────────────────────┘
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Camera, FileText, Film, Lock, MessageSquare, Monitor, ChevronRight, AlertCircle,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
// Vigil server returns naive UTC strings (no Z suffix). Use VigilDateTime
// — a thin wrapper that normalises to UTC before handing to <DateTime/> —
// so heartbeat + event log timestamps render in the proctor's local zone.
import { VigilDateTime as DateTime } from '@/pages/vigil/timestamp';
import { translateEventType } from '@/pages/vigil/i18n';
import {
  listStudentEvents, VigilOfflineError,
  type VigilStudentCard, type VigilStudentEvent,
} from '@/lib/vigil-api';
import { useProctorCommands } from '@/hooks/use-proctor-commands';
import { StatusPill, statusLabel } from '@/pages/vigil/student-card';
import { ConfirmActionDialog } from '@/pages/vigil/confirm-action-dialog';
import { SendMessageDialog } from '@/pages/vigil/send-message-dialog';
import { LivePlayerDialog } from '@/pages/vigil/live-player-dialog';
import { RecordingPlaybackDialog } from '@/pages/vigil/recording-playback-dialog';
import { EventDetailDialog } from '@/pages/vigil/event-detail-dialog';
import { cn } from '@/lib/cn';

interface StudentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  student: VigilStudentCard | null;
  /** From AdminVigilExamDetailPage; needed to forward camera/recording UI. */
  recordEnabled: boolean;
  /** Latest delta-applied event added via WS — bumps the events list. */
  newEventVersion?: number;
}

export function StudentDetailSheet({
  open, onOpenChange, contestId, student, recordEnabled, newEventVersion,
}: StudentDetailSheetProps) {
  const { sendCommand } = useProctorCommands({ contestId });
  const [events, setEvents] = useState<VigilStudentEvent[]>([]);
  const [eventsErr, setEventsErr] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [confirmLock, setConfirmLock] = useState(false);
  const [confirmFlush, setConfirmFlush] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<VigilStudentEvent | null>(null);

  // Reload events whenever the sheet opens for a new student or when a WS
  // `event_added` matching this machineId arrives (newEventVersion bump).
  useEffect(() => {
    if (!open || !student) return undefined;
    let cancelled = false;
    setEventsLoading(true);
    setEventsErr(null);
    listStudentEvents(contestId, student.machineId, { limit: 100 })
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
        setEventsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof VigilOfflineError) {
          setEventsErr('反作弊服务不可用');
        } else {
          setEventsErr(e?.message || '加载失败');
        }
        setEventsLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, student, contestId, newEventVersion]);

  // Local handlers; all UI confirmations wrap sendCommand.
  const handleScreenshot = useCallback(() => {
    if (!student) return;
    void sendCommand({
      targetMachineId: student.machineId,
      command: 'capture_screenshot',
      payload: { reason_tag: 'command' },
    });
  }, [sendCommand, student]);

  const handleFlush = useCallback(async (reason: string) => {
    if (!student) return;
    await sendCommand({
      targetMachineId: student.machineId,
      command: 'flush_logs',
      reason: reason || undefined,
    });
  }, [sendCommand, student]);

  const handleLock = useCallback(async (reason: string) => {
    if (!student) return;
    await sendCommand({
      targetMachineId: student.machineId,
      command: 'lock_screen',
      payload: { message: '请等待监考老师指示' },
      reason: reason || undefined,
    });
  }, [sendCommand, student]);

  if (!student) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[620px] max-w-[100vw]" />
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-[620px] max-w-[100vw] flex-col p-0">
          <SheetHeader className="px-6 py-4">
            <div className="flex items-baseline gap-2 pr-8">
              <h2 className="truncate text-lg font-semibold">{student.name}</h2>
              {student.studentId && (
                <span className="font-mono text-sm text-muted-foreground">{student.studentId}</span>
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{student.machineId}</p>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 px-6 py-4">
              {/* Status card */}
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusPill status={student.status} />
                    {student.status === 'ended' && student.endedReason && (
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {student.endedReason}
                      </span>
                    )}
                  </div>
                  {student.examSeconds != null && (
                    <span className="text-xs text-muted-foreground">
                      已考 {formatExamTime(student.examSeconds)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <StreamLabel name="屏幕" status={student.streamState?.screen} />
                  <StreamLabel name="摄像头" status={student.streamState?.camera} />
                  <StreamLabel name="录屏" status={recordEnabled ? 'started' : 'stopped'} />
                </div>
                {student.lastHeartbeat && (
                  <p className="text-[10px] text-muted-foreground">
                    最近心跳 <DateTime value={student.lastHeartbeat} mode="datetime" />
                  </p>
                )}
              </div>

              {/* Quick actions grid */}
              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  icon={Camera}
                  label="实时截屏"
                  onClick={handleScreenshot}
                />
                <ActionButton
                  icon={Monitor}
                  label="查看实时画面"
                  onClick={() => setLiveOpen(true)}
                  disabled={student.streamState?.screen !== 'started'}
                />
                <ActionButton
                  icon={MessageSquare}
                  label="发消息"
                  onClick={() => setMessageOpen(true)}
                />
                <ActionButton
                  icon={Lock}
                  label={student.status === 'locked' ? '解锁屏幕' : '锁屏'}
                  variant={student.status === 'locked' ? 'default' : 'destructive'}
                  onClick={() => {
                    if (student.status === 'locked') {
                      void sendCommand({
                        targetMachineId: student.machineId,
                        command: 'unlock_screen',
                      });
                    } else {
                      setConfirmLock(true);
                    }
                  }}
                />
                <ActionButton
                  icon={FileText}
                  label="导出日志"
                  onClick={() => setConfirmFlush(true)}
                />
                <ActionButton
                  icon={Film}
                  label="录屏回放"
                  onClick={() => setRecordingOpen(true)}
                  disabled={!recordEnabled}
                />
              </div>

              {/* Event log */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  行为日志
                </p>
                {eventsLoading && !events.length ? (
                  <div className="space-y-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
                    ))}
                  </div>
                ) : eventsErr ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-700 dark:text-amber-300">
                    {eventsErr}
                  </div>
                ) : !events.length ? (
                  <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                    暂无行为日志
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {events.map((e) => (
                      <li key={e.eventId}>
                        <button
                          type="button"
                          onClick={() => setSelectedEvent(e)}
                          className={cn(
                            'group flex w-full items-start gap-3 rounded-md border border-transparent bg-card/30 px-3 py-2.5 text-left text-xs transition-colors',
                            'hover:border-border hover:bg-accent/50',
                          )}
                        >
                          <SeverityDot severity={e.severity} />
                          <div className="min-w-0 flex-1 space-y-1">
                            {/* Row 1: localized event type + count badge */}
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium leading-tight">
                                {translateEventType(e.type)}
                              </span>
                              {e.count > 1 && (
                                <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">×{e.count}</Badge>
                              )}
                            </div>
                            {/* Row 2: timestamp + summary (raw client message), wraps if long */}
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] leading-tight text-muted-foreground">
                              <span className="font-mono">
                                <DateTime value={e.ts} mode="datetime" />
                              </span>
                              {e.summary && (
                                <span className="break-words">· {e.summary}</span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        open={confirmLock}
        onOpenChange={setConfirmLock}
        title="锁定学生屏幕"
        description={(
          <>
            确定要锁定 <strong>{student.name}</strong>
            {student.studentId && <span className="ml-1 font-mono text-xs">{student.studentId}</span>}
            {' '}的屏幕吗？学生将看到全屏遮罩，无法答题，直到解锁。
          </>
        )}
        confirmLabel="确认锁屏"
        confirmVariant="destructive"
        onConfirm={handleLock}
      />

      <ConfirmActionDialog
        open={confirmFlush}
        onOpenChange={setConfirmFlush}
        title="导出客户端日志"
        description="客户端会立即上报缓冲中的事件日志。可能耗时几秒。"
        confirmLabel="确认导出"
        requireReason={false}
        onConfirm={handleFlush}
      />

      <SendMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        student={student}
        sendCommand={sendCommand}
      />

      <LivePlayerDialog
        open={liveOpen}
        onOpenChange={setLiveOpen}
        contestId={contestId}
        student={student}
        recordEnabled={recordEnabled}
        onCaptureScreenshot={handleScreenshot}
        onLockScreen={() => setConfirmLock(true)}
        onSendMessage={() => setMessageOpen(true)}
      />

      <RecordingPlaybackDialog
        open={recordingOpen}
        onOpenChange={setRecordingOpen}
        contestId={contestId}
        student={student}
      />

      <EventDetailDialog
        open={!!selectedEvent}
        onOpenChange={(o) => { if (!o) setSelectedEvent(null); }}
        event={selectedEvent}
      />
    </>
  );
}

/* ─── Subcomponents ────────────────────────────────────────────────────── */

function ActionButton({
  icon: Icon, label, onClick, disabled, variant = 'outline',
}: {
  icon: any;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'destructive';
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-12 justify-start gap-2 text-xs"
    >
      <Icon className="size-4" />
      {label}
    </Button>
  );
}

function StreamLabel({
  name, status,
}: { name: string; status?: 'started' | 'stopped' | 'failed' | undefined }) {
  const colors: Record<string, string> = {
    started: 'text-emerald-600',
    stopped: 'text-muted-foreground',
    failed: 'text-destructive',
  };
  const text = status ? (
    status === 'started' ? 'ON' : status === 'failed' ? 'FAIL' : 'OFF'
  ) : 'OFF';
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-2 py-1">
      <span className="text-muted-foreground">{name}</span>
      <span className={cn('font-mono text-[10px] font-semibold', colors[status || 'stopped'])}>
        {text}
      </span>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: 'bg-muted-foreground/40',
    warning: 'bg-amber-500',
    error: 'bg-orange-500',
    critical: 'bg-destructive',
  };
  return <span className={cn('size-2 shrink-0 rounded-full', colors[severity] || 'bg-muted-foreground/40')} />;
}

function formatExamTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}min`;
}

// Re-export for the parent page (so we don't redefine it).
export { statusLabel };
