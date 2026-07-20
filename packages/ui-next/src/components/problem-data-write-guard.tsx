import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ActiveContainer {
  id: string;
  title?: string;
  rule?: string;
  endAt?: string | Date;
}
export type ProblemDataWriteOperation = 'files-upload' | 'files-rename' | 'files-delete' | 'generate-testdata-request' | 'statement-edit';
export type ProblemDataWriteConfirmationResult = true | string | false;

export interface ProblemDataWriteGuardState {
  active?: ActiveContainer[];
  canOverride?: boolean;
  confirmationRequestIds?: Partial<Record<ProblemDataWriteOperation, string>>;
}

export function useProblemDataWriteGuard(state: ProblemDataWriteGuardState | undefined, scope: 'data' | 'statement' = 'data') {
  const active = Array.isArray(state?.active) ? state.active : [];
  const canOverride = state?.canOverride === true;
  const confirmationRequestIds = state?.confirmationRequestIds;
  const blocked = active.length > 0 && (!canOverride || !confirmationRequestIds);
  const [action, setAction] = useState<{ label: string; operation: ProblemDataWriteOperation } | null>(null);
  const resolver = useRef<((confirmed: ProblemDataWriteConfirmationResult) => void) | null>(null);

  const settle = useCallback(
    (confirmed: boolean) => {
      const result = confirmed && action ? confirmationRequestIds?.[action.operation] || false : false;
      resolver.current?.(result);
      resolver.current = null;
      setAction(null);
    },
    [action, confirmationRequestIds],
  );

  useEffect(() => () => resolver.current?.(false), []);

  const confirm = useCallback(
    (nextAction: string, operation: ProblemDataWriteOperation = 'files-upload'): Promise<ProblemDataWriteConfirmationResult> => {
      if (!active.length) return Promise.resolve(true);
      if (!canOverride || !confirmationRequestIds?.[operation]) return Promise.resolve(false);
      if (resolver.current) return Promise.resolve(false);
      setAction({ label: nextAction, operation });
      return new Promise((resolve) => {
        resolver.current = resolve;
      });
    },
    [active.length, canOverride, confirmationRequestIds],
  );

  const notice = active.length ? (
    <div
      role={blocked ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div>
        <p className="font-medium">此题正在比赛或考试中使用</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {blocked
            ? canOverride
              ? `赛中${scope === 'statement' ? '题面' : '数据'}修改确认已失效，请刷新页面后重试。`
              : `当前角色不能修改${scope === 'statement' ? '题面' : '评测数据'}。`
            : `系统管理员每次修改${scope === 'statement' ? '题面' : '评测数据'}前都必须在自定义确认框中明确确认，操作会写入审计日志。`}
        </p>
        <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
          {active.map((item) => (
            <li key={item.id}>{item.title || item.id}</li>
          ))}
        </ul>
      </div>
    </div>
  ) : null;

  const dialog = action ? (
    <Dialog open onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="max-w-lg" onClose={() => settle(false)}>
        <DialogHeader>
          <DialogTitle>确认修改赛中{scope === 'statement' ? '题面' : '评测数据'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-5 text-sm">
          <p>
            你即将执行“{action.label}”。此题正被 {active.length} 个进行中的比赛或考试引用，修改可能影响正在答题的学生。
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={() => settle(true)}>
              我已确认，继续
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  return { active: active.length > 0, blocked, confirm, notice, dialog };
}
