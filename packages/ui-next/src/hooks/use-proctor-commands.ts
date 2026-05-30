/**
 * useProctorCommands — fire a proctor command and surface the result toast.
 *
 * The vigil-server flow for proctor commands is fundamentally async:
 *
 *   1. POST /api/admin/vigil/proctor/commands  (this hook)
 *   2. Server writes vigil.command_audit + dispatches via client WS
 *   3. Client replies WS command_result (matched by commandId)
 *   4. Server fans out to dashboard WS → useVigilSocket.command_result
 *
 * To paper over (1)…(4) for the caller we:
 *   - immediately show a loading toast and return a Promise
 *   - register the commandId in a global pending map
 *   - listen for `command_result` WS messages and resolve the promise + swap
 *     the loading toast to success / error
 *   - fall back to a 5s timeout (resolves with `result: "timeout"`) if no
 *     WS reply arrives — this is the "client offline" or "server bridge
 *     dropped" failure mode
 *
 * The hook does NOT manage the WS connection itself; it expects the caller
 * (e.g. AdminVigilExamDetailPage) to mount a single `useVigilSocket` that
 * forwards `command_result` messages via the `notifyCommandResult` helper.
 * That keeps the WS connection count bounded to 1 per page.
 *
 * Usage:
 *
 *   const { sendCommand } = useProctorCommands({ contestId });
 *
 *   async function onLockScreen() {
 *     const ok = await confirmDialog({ title: '锁定 #15 张三 的屏幕？' });
 *     if (!ok) return;
 *     await sendCommand({
 *       targetMachineId: 'MX9F2',
 *       command: 'lock_screen',
 *       reason: '怀疑切屏作弊',
 *     });
 *   }
 *
 *   // somewhere with a useVigilSocket:
 *   useVigilSocket({
 *     onMessage: (msg) => {
 *       if (msg.type === 'command_result') notifyCommandResult(msg);
 *     },
 *   });
 */
import { useCallback } from 'react';
import {
  sendProctorCommandV2,
  type ProctorCommandRequest,
  type ProctorCommandResponse,
} from '@/lib/vigil-api';
import type { CommandResultMsg } from '@/hooks/use-vigil-socket';
import { toast } from '@/components/ui/toast';

/* ─── Pending command bookkeeping ──────────────────────────────────────── */

interface PendingCommand {
  toastId: string;
  /** Best-effort label used in the success/error toast. */
  label: string;
  resolve: (result: CommandResultMsg) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Module-level map so it survives re-renders and survives across multiple
// hook callers within the same page. WS messages are global.
const pending = new Map<string, PendingCommand>();

const COMMAND_TIMEOUT_MS = 5_000;

const COMMAND_LABELS: Record<string, string> = {
  capture_screenshot: '实时截屏',
  lock_screen: '锁屏',
  unlock_screen: '解锁屏幕',
  show_message: '发送消息',
  notify_warning: '发送提醒',
  restart_stream: '重启直播',
  flush_logs: '导出日志',
};

function commandLabel(command: string): string {
  return COMMAND_LABELS[command] || command;
}

/**
 * Call this from a single point (typically the AdminVigilExamDetailPage's
 * useVigilSocket onMessage handler) for every `command_result` message.
 *
 * Matching is by `commandId`; if the id is unknown (different page mounted,
 * page reloaded between command + result, etc.) the message is dropped.
 */
export function notifyCommandResult(msg: CommandResultMsg): void {
  const entry = pending.get(msg.commandId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(msg.commandId);
  entry.resolve(msg);
}

/* ─── Hook ─────────────────────────────────────────────────────────────── */

export interface SendCommandInput
  extends Omit<ProctorCommandRequest, 'contestId'> {
  /** Free-form label shown in the toast. Defaults to a friendly name from the command. */
  label?: string;
}

export interface SendCommandOutcome {
  /** Accepted by server. Both group and single sends populate this. */
  accepted: number;
  /** Final result per single-target send. Group sends leave this as `null`. */
  result: CommandResultMsg | null;
  /** For group sends only — server may pre-reject offline clients. */
  rejected?: { machineId: string; reason: string }[];
}

interface UseProctorCommandsOptions {
  contestId: string;
}

export function useProctorCommands({ contestId }: UseProctorCommandsOptions) {
  const sendCommand = useCallback(async (input: SendCommandInput): Promise<SendCommandOutcome> => {
    const { label: rawLabel, ...requestBody } = input;
    const label = rawLabel || commandLabel(input.command);
    const isGroup = !input.targetMachineId && Boolean(input.targetMachineIds?.length || input.audienceFilter);
    const toastId = toast.loading(`${isGroup ? '群发' : ''}${label}…`);

    let response: ProctorCommandResponse;
    try {
      response = await sendProctorCommandV2({ contestId, ...requestBody });
    } catch (e: any) {
      toast.error(`${label}失败`, { id: toastId, description: e?.message || '网络错误' });
      throw e;
    }

    // Group send: we don't wait for individual command_result messages — the
    // server's accepted/rejected breakdown is sufficient for the toast.
    if (isGroup) {
      const rejected = response.rejected || [];
      if (response.accepted > 0 && rejected.length === 0) {
        toast.success(`${label}已下发`, {
          id: toastId,
          description: `共 ${response.accepted} 名学生`,
        });
      } else if (response.accepted > 0 && rejected.length > 0) {
        toast.info(`${label}部分下发`, {
          id: toastId,
          description: `成功 ${response.accepted} · 失败 ${rejected.length}`,
        });
      } else {
        toast.error(`${label}下发失败`, {
          id: toastId,
          description: rejected[0]?.reason || '没有可达的学生',
        });
      }
      return { accepted: response.accepted, result: null, rejected };
    }

    // Single-target send: wait up to 5s for the WS command_result.
    const commandId = response.commandId;
    if (!commandId) {
      // Server didn't acknowledge — surface raw response as-is.
      toast.success(`${label}已下发`, { id: toastId });
      return { accepted: response.accepted, result: null };
    }

    const result = await new Promise<CommandResultMsg>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(commandId);
        resolve({
          type: 'command_result',
          commandId,
          machineId: input.targetMachineId || '',
          result: 'timeout',
          errorMessage: '客户端在 5 秒内未回执',
        });
      }, COMMAND_TIMEOUT_MS);
      pending.set(commandId, { toastId, label, resolve, timer });
    });

    if (result.result === 'ok') {
      toast.success(`${label}已完成`, { id: toastId });
    } else if (result.result === 'client_offline') {
      toast.error(`${label}失败`, { id: toastId, description: '学生客户端离线' });
    } else if (result.result === 'timeout') {
      toast.error(`${label}超时`, { id: toastId, description: result.errorMessage });
    } else {
      toast.error(`${label}失败`, {
        id: toastId,
        description: result.errorMessage || '客户端返回错误',
      });
    }
    return { accepted: response.accepted, result };
  }, [contestId]);

  return { sendCommand };
}
