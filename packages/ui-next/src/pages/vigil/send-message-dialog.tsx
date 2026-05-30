/**
 * SendMessageDialog — single-target or group send for the proctor messaging
 * commands (CLIENT_PROCTOR_MONITORING_DESIGN §8.7).
 *
 * UX flow:
 *   - When opened from a student card → audience defaults to "single" and
 *     `student.name` is shown in the recipient row (cannot be changed).
 *   - When opened from the top "📢 群发" button → audience radio is enabled,
 *     defaulting to "all" with helper counts.
 *
 * Severity maps to client-side UI:
 *   - info     → toast (InfoBar, non-blocking)
 *   - warning  → modal dialog (ContentDialog, must dismiss to resume)
 *   - critical → full-screen lock overlay + modal (cannot ignore)
 *
 * A reason is optional but encouraged — it lands in vigil.command_audit so a
 * playback of "why did the proctor lock #15" survives the contest.
 */
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { VigilStudentCard } from '@/lib/vigil-api';
import type { useProctorCommands as UseProctorCommandsT } from '@/hooks/use-proctor-commands';

type Severity = 'info' | 'warning' | 'critical';
type Audience = 'single' | 'all' | 'online' | 'anomaly';

interface SendMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, audience is fixed to "single" and the radios are hidden. */
  student?: VigilStudentCard | null;
  /** For the group-send entry point — used to label "全员 N 人 / 在线 M 人 / 异常 K 人". */
  counters?: {
    total?: number;
    online?: number;
    anomaly?: number;
  };
  /** sendCommand from useProctorCommands(). Required so we don't redo the WS wiring. */
  sendCommand: ReturnType<typeof UseProctorCommandsT>['sendCommand'];
}

export function SendMessageDialog({
  open, onOpenChange, student, counters, sendCommand,
}: SendMessageDialogProps) {
  const [severity, setSeverity] = useState<Severity>('info');
  const [audience, setAudience] = useState<Audience>(student ? 'single' : 'all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCritical, setConfirmCritical] = useState(false);

  // Reset form whenever the dialog reopens — feels right and prevents stale
  // "全员消息" toasts after closing/opening with a different student.
  useEffect(() => {
    if (!open) return;
    setSeverity('info');
    setAudience(student ? 'single' : 'all');
    setTitle('');
    setBody('');
    setReason('');
    setBusy(false);
    setConfirmCritical(false);
  }, [open, student]);

  const audienceLabel = (a: Audience): string => {
    if (a === 'single' && student) return `${student.name} ${student.studentId || ''}`.trim();
    if (a === 'all') return `全员${counters?.total != null ? ` ${counters.total} 人` : ''}`;
    if (a === 'online') return `仅在线${counters?.online != null ? ` ${counters.online} 人` : ''}`;
    if (a === 'anomaly') return `仅异常${counters?.anomaly != null ? ` ${counters.anomaly} 人` : ''}`;
    return a;
  };

  const isCriticalGroup = severity === 'critical' && audience !== 'single';

  const submit = async () => {
    if (!body.trim()) return;
    // Critical group send requires explicit confirmation toggle — extra
    // friction so the proctor doesn't accidentally lock 300 screens at once.
    if (isCriticalGroup && !confirmCritical) return;

    setBusy(true);
    try {
      const payload = { severity, title: title.trim(), body: body.trim() };
      if (audience === 'single' && student) {
        await sendCommand({
          targetMachineId: student.machineId,
          command: 'show_message',
          payload,
          reason: reason.trim() || undefined,
        });
      } else {
        await sendCommand({
          audienceFilter: audience as 'all' | 'online' | 'anomaly',
          command: 'show_message',
          payload,
          reason: reason.trim() || undefined,
        });
      }
      onOpenChange(false);
    } catch {
      // useProctorCommands already showed an error toast.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-[640px]"
        onClose={() => !busy && onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" />
            {student ? `向 ${student.name} 发送消息` : '群发消息'}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          {/* Severity */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              类型
            </label>
            <RadioGroup orientation="horizontal">
              <RadioGroupItem
                name="severity"
                value="info"
                checked={severity === 'info'}
                onChange={() => setSeverity('info')}
                label="提醒 (toast)"
                description="角落滑入，不打断答题"
              />
              <RadioGroupItem
                name="severity"
                value="warning"
                checked={severity === 'warning'}
                onChange={() => setSeverity('warning')}
                label="通知 (modal)"
                description="弹窗，必须点确认"
              />
              <RadioGroupItem
                name="severity"
                value="critical"
                checked={severity === 'critical'}
                onChange={() => setSeverity('critical')}
                label="强制 (全屏)"
                description="全屏遮挡屏幕"
              />
            </RadioGroup>
          </div>

          {/* Audience */}
          {student ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">收件人</p>
              <p className="mt-1">{audienceLabel('single')}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                收件人
              </label>
              <RadioGroup orientation="horizontal">
                <RadioGroupItem
                  name="audience"
                  value="all"
                  checked={audience === 'all'}
                  onChange={() => setAudience('all')}
                  label={audienceLabel('all')}
                />
                <RadioGroupItem
                  name="audience"
                  value="online"
                  checked={audience === 'online'}
                  onChange={() => setAudience('online')}
                  label={audienceLabel('online')}
                />
                <RadioGroupItem
                  name="audience"
                  value="anomaly"
                  checked={audience === 'anomaly'}
                  onChange={() => setAudience('anomaly')}
                  label={audienceLabel('anomaly')}
                />
              </RadioGroup>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              标题（可选）
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：监考通知"
              maxLength={80}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              内容 *
            </label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="发送给学生的消息内容…"
              required
              rows={4}
              maxLength={500}
            />
            <p className="text-[10px] text-muted-foreground text-right">{body.length}/500</p>
          </div>

          {/* Reason (audit) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              操作原因（可选，写入审计日志）
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：例行提醒考试纪律"
            />
          </div>

          {isCriticalGroup && (
            <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <input
                type="checkbox"
                checked={confirmCritical}
                onChange={(e) => setConfirmCritical(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-destructive">
                我已知晓：此操作将向多名学生 <strong>全屏遮挡屏幕</strong>，影响他们的答题。
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !body.trim() || (isCriticalGroup && !confirmCritical)}
            >
              {audience === 'single' ? '发送' : `发送给${audienceLabel(audience).replace('仅', '')}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
