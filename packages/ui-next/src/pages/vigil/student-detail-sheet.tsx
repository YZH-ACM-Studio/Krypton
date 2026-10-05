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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, Download, FileText, Film, Lock, MessageSquare, Monitor, type LucideIcon } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
// Vigil server returns naive UTC strings (no Z suffix). Use VigilDateTime
// — a thin wrapper that normalises to UTC before handing to <DateTime/> —
// so heartbeat + event log timestamps render in the proctor's local zone.
import { VigilDateTime as DateTime } from '@/pages/vigil/timestamp';
import { translateEventType } from '@/pages/vigil/i18n';
import {
  listStudentEvents,
  prepareBrowserDownload,
  requestRecordingDownload,
  setManualRecording,
  startBrowserDownload,
  VigilOfflineError,
  type VigilStudentCard,
  type VigilStudentEvent,
} from '@/lib/vigil-api';
import { useBootstrap } from '@/lib/bootstrap';
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

export function StudentDetailSheet({ open, onOpenChange, contestId, student, recordEnabled, newEventVersion }: StudentDetailSheetProps) {
  const bs = useBootstrap();
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
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Each machine keeps its own in-flight count. Finishing one student must not
  // re-enable another, and only that machine's latest attempt may write or clear
  // its failure. An event reload must not wipe the failure either.
  const stopAttemptRef = useRef<Record<string, number>>({});
  const [stopInflight, setStopInflight] = useState<Readonly<Record<string, number>>>({});
  const [stopRecordingErrors, setStopRecordingErrors] = useState<Readonly<Record<string, string>>>({});
  const stopRecordingBusy = student != null && (stopInflight[student.machineId] ?? 0) > 0;
  const stopRecordingError = student == null ? null : stopRecordingErrors[student.machineId] ?? null;

  // Reload events whenever the sheet opens for a new student or when a WS
  // `event_added` matching this machineId arrives (newEventVersion bump).
  useEffect(() => {
    if (!open || !student) return undefined;
    let cancelled = false;
    setEventsLoading(true);
    setEventsErr(null);
    setDownloadError(null);
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
    return () => {
      cancelled = true;
    };
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

  const handleFlush = useCallback(
    async (reason: string) => {
      if (!student) return;
      await sendCommand({
        targetMachineId: student.machineId,
        command: 'flush_logs',
        reason: reason || undefined,
      });
    },
    [sendCommand, student],
  );

  const handleLock = useCallback(
    async (reason: string) => {
      if (!student) return;
      await sendCommand({
        targetMachineId: student.machineId,
        command: 'lock_screen',
        payload: { message: '请等待监考老师指示' },
        reason: reason || undefined,
      });
    },
    [sendCommand, student],
  );

  const handleStopRecording = useCallback(async () => {
    if (!student) return;
    const machineId = student.machineId;
    const attempt = (stopAttemptRef.current[machineId] ?? 0) + 1;
    stopAttemptRef.current[machineId] = attempt;
    setStopInflight((current) => ({
      ...current,
      [machineId]: (current[machineId] ?? 0) + 1,
    }));
    setStopRecordingErrors((current) => omitStopError(current, machineId));
    const latest = () => stopAttemptRef.current[machineId] === attempt;
    try {
      await setManualRecording(contestId, machineId, false, {
        uid: bs.user.id,
        displayName: bs.user.name,
      });
      if (!latest()) return;
      setStopRecordingErrors((current) => omitStopError(current, machineId));
    } catch (reason) {
      if (!latest()) return;
      const message = reason instanceof Error ? reason.message : '未知错误';
      setStopRecordingErrors((current) => ({ ...current, [machineId]: `停止录制失败：${message}` }));
    } finally {
      setStopInflight((current) => {
        const left = (current[machineId] ?? 1) - 1;
        if (left <= 0) {
          const next = { ...current };
          delete next[machineId];
          return next;
        }
        return { ...current, [machineId]: left };
      });
    }
  }, [bs.user.id, bs.user.name, contestId, student]);

  const handleDownloadAll = useCallback(async () => {
    if (!student) return;
    let downloadTarget: Window;
    try {
      downloadTarget = prepareBrowserDownload();
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : '无法打开下载窗口');
      return;
    }
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const scope = student.uid != null
        ? { ojUserId: student.uid }
        : { examSessionId: student.examSessionId };
      const url = await requestRecordingDownload(
        contestId,
        scope,
        { uid: bs.user.id, displayName: bs.user.name },
      );
      startBrowserDownload(url, downloadTarget);
    } catch (reason) {
      downloadTarget.close();
      setDownloadError(reason instanceof Error ? reason.message : '申请录像打包下载失败');
    } finally {
      setDownloadBusy(false);
    }
  }, [bs.user.id, bs.user.name, contestId, student]);

  if (!student) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" />
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right">
          <SheetHeader>
            <div className="flex min-w-0 items-baseline gap-2">
              <SheetTitle className="min-w-0 truncate">{student.name}</SheetTitle>
              {student.studentId && <span className="shrink-0 font-mono text-sm text-fg-subtle">{student.studentId}</span>}
            </div>
            <p className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{student.machineId}</p>
          </SheetHeader>

          <SheetBody viewportLayout="block">
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusPill status={student.status} />
                    {student.status === 'ended' && student.endedReason && (
                      <span className="min-w-0 truncate text-xs font-medium text-fg-subtle">{student.endedReason}</span>
                    )}
                  </div>
                  {student.examSeconds != null && <span className="shrink-0 text-xs text-fg-subtle tabular">已考 {formatExamTime(student.examSeconds)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-2xs">
                  <StreamLabel name="屏幕" status={student.streamState?.screen} />
                  <StreamLabel name="摄像头" status={student.streamState?.camera} />
                  <StreamLabel name="录屏" status={recordEnabled || student.manualRecording ? 'started' : 'stopped'} />
                </div>
                {student.manualRecording === true ? (
                  <Button type="button" variant="secondary" size="sm" disabled={stopRecordingBusy} onClick={() => void handleStopRecording()}>
                    停止录制
                  </Button>
                ) : null}
                {student.lastHeartbeat && (
                  <p className="text-2xs text-fg-subtle">
                    最近心跳 <DateTime value={student.lastHeartbeat} mode="datetime" />
                  </p>
                )}
              </div>

              {/* Quick actions grid */}
              <div className="grid grid-cols-2 gap-2">
                <ActionButton icon={Camera} label="实时截屏" onClick={handleScreenshot} />
                <ActionButton
                  icon={Monitor}
                  label="查看实时画面"
                  onClick={() => setLiveOpen(true)}
                  disabled={student.streamState?.screen !== 'started'}
                />
                <ActionButton icon={MessageSquare} label="发消息" onClick={() => setMessageOpen(true)} />
                <ActionButton
                  icon={Lock}
                  label={student.status === 'locked' ? '解锁屏幕' : '锁屏'}
                  variant={student.status === 'locked' ? 'primary' : 'danger-soft'}
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
                <ActionButton icon={FileText} label="导出日志" onClick={() => setConfirmFlush(true)} />
                <ActionButton icon={Film} label="录屏回放" onClick={() => setRecordingOpen(true)} />
                <ActionButton
                  icon={Download}
                  label={downloadBusy ? '正在申请下载…' : '打包下载录像'}
                  onClick={() => void handleDownloadAll()}
                  disabled={downloadBusy}
                />
              </div>

              {downloadError || stopRecordingError ? (
                <Alert tone="danger">
                  {downloadError}
                  {downloadError && stopRecordingError ? ' ' : null}
                  {stopRecordingError}
                </Alert>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium text-fg-subtle">行为日志</p>
                {eventsLoading && !events.length ? (
                  <div className="space-y-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : eventsErr ? (
                  <Alert tone="warning">{eventsErr}</Alert>
                ) : !events.length ? (
                  <EmptyState compact title="暂无行为日志" />
                ) : (
                  <ul className="space-y-1.5">
                    {events.map((e) => (
                      <li key={e.eventId}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedEvent(e)}
                          className="h-auto! w-full items-start justify-start gap-3 whitespace-normal! px-3 py-2.5 text-left font-normal"
                        >
                          <SeverityDot severity={e.severity} />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 truncate text-sm font-medium text-fg">{translateEventType(e.type)}</span>
                              {e.count > 1 && (
                                <Badge variant="solid" size="sm" className="shrink-0">
                                  ×{e.count}
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-2xs text-fg-subtle">
                              <span className="shrink-0 font-mono tabular">
                                <DateTime value={e.ts} mode="datetime" />
                              </span>
                              {e.summary && <span className="min-w-0 break-all">· {e.summary}</span>}
                            </div>
                          </div>
                          <ChevronRight className="mt-1 size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        open={confirmLock}
        onOpenChange={setConfirmLock}
        title="锁定学生屏幕"
        description={
          <>
            确定要锁定 <strong>{student.name}</strong>
            {student.studentId && <span className="ml-1 font-mono text-xs">{student.studentId}</span>}{' '}
            的屏幕吗？学生将看到全屏遮罩，无法答题，直到解锁。
          </>
        }
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

      <SendMessageDialog open={messageOpen} onOpenChange={setMessageOpen} student={student} sendCommand={sendCommand} />

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

      <RecordingPlaybackDialog open={recordingOpen} onOpenChange={setRecordingOpen} contestId={contestId} student={student} />

      <EventDetailDialog
        open={!!selectedEvent}
        onOpenChange={(o) => {
          if (!o) setSelectedEvent(null);
        }}
        event={selectedEvent}
      />
    </>
  );
}

/* ─── Subcomponents ────────────────────────────────────────────────────── */

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = 'secondary',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger-soft';
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-auto! w-full justify-start gap-2 whitespace-normal! px-3 py-2.5"
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  );
}

function StreamLabel({ name, status }: { name: string; status?: 'started' | 'stopped' | 'failed' | undefined }) {
  const colors: Record<string, string> = {
    started: 'text-success-fg',
    stopped: 'text-fg-subtle',
    failed: 'text-danger-fg',
  };
  const text = status ? (status === 'started' ? 'ON' : status === 'failed' ? 'FAIL' : 'OFF') : 'OFF';
  return (
    <div className="flex min-w-0 items-center justify-between gap-1 rounded-md border border-line bg-bg px-2 py-1">
      <span className="min-w-0 truncate text-fg-subtle">{name}</span>
      <span className={cn('shrink-0 font-mono text-2xs font-semibold tabular', colors[status || 'stopped'])}>{text}</span>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: 'bg-fg-subtle',
    warning: 'bg-warning',
    error: 'bg-orange',
    critical: 'bg-danger',
  };
  return <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', colors[severity] || 'bg-fg-subtle')} />;
}

function omitStopError(current: Readonly<Record<string, string>>, machineId: string): Readonly<Record<string, string>> {
  if (!Object.hasOwn(current, machineId)) return current;
  const next = { ...current };
  delete next[machineId];
  return next;
}

function formatExamTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}min`;
}

// Re-export for the parent page (so we don't redefine it).
export { statusLabel };
