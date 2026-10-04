import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

export interface ActiveContainer {
  id: string;
  title?: string;
  rule?: string;
  endAt?: string | Date;
}
export type ProblemDataWriteOperation = 'files-upload' | 'files-rename' | 'files-delete' | 'generate-testdata-request' | 'statement-edit';
export type ProblemDataWriteConfirmationResult = true | string | false;
export interface ProblemDataWritePreparation {
  active: ActiveContainer[];
  canOverride: boolean;
  confirmationRequestId?: string;
}
export type PrepareProblemDataWrite = (operation: ProblemDataWriteOperation) => Promise<ProblemDataWritePreparation>;

export interface ProblemDataWriteGuardState {
  active?: ActiveContainer[];
  canOverride?: boolean;
  confirmationRequestIds?: Partial<Record<ProblemDataWriteOperation, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseActiveContainers(value: unknown): ActiveContainer[] {
  if (!Array.isArray(value)) throw new Error('赛中数据确认响应缺少容器列表');
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) throw new Error('赛中数据确认响应包含无效容器');
    return {
      id: entry.id,
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
      ...(typeof entry.rule === 'string' ? { rule: entry.rule } : {}),
      ...(typeof entry.endAt === 'string' ? { endAt: entry.endAt } : {}),
    };
  });
}

export async function prepareProblemDataWrite(endpoint: string, operation: ProblemDataWriteOperation): Promise<ProblemDataWritePreparation> {
  const form = new FormData();
  form.set('operation', 'prepare_data_write');
  form.set('writeOperation', operation);
  const response = await fetchHydroResponse(endpoint, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '获取赛中数据修改确认失败'));
  if (response.redirected) throw new Error('赛中数据确认请求发生了非预期重定向');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.error('Problem data write preparation returned invalid JSON', { endpoint, operation, error });
    throw new Error('赛中数据确认响应不是有效 JSON');
  }
  if (!isRecord(payload) || payload.ok !== true || typeof payload.canOverride !== 'boolean') {
    throw new Error('服务器未明确确认赛中数据修改状态');
  }
  const active = parseActiveContainers(payload.active);
  const confirmationRequestId = typeof payload.confirmationRequestId === 'string' ? payload.confirmationRequestId : undefined;
  if (active.length && payload.canOverride && !confirmationRequestId) {
    throw new Error('服务器未签发赛中数据修改确认凭据');
  }
  return { active, canOverride: payload.canOverride, confirmationRequestId };
}

export function useProblemDataWriteGuard(
  state: ProblemDataWriteGuardState | undefined,
  scope: 'data' | 'statement' | 'attachment' = 'data',
  prepare?: PrepareProblemDataWrite,
) {
  const active = Array.isArray(state?.active) ? state.active : [];
  const canOverride = state?.canOverride === true;
  const confirmationRequestIds = state?.confirmationRequestIds;
  const blocked = !prepare && active.length > 0 && (!canOverride || !confirmationRequestIds);
  const [preparationError, setPreparationError] = useState('');
  const [action, setAction] = useState<{
    label: string;
    operation: ProblemDataWriteOperation;
    active: ActiveContainer[];
    confirmationRequestId: string;
  } | null>(null);
  const resolver = useRef<((confirmed: ProblemDataWriteConfirmationResult) => void) | null>(null);
  const preparing = useRef(false);
  const scopeLabel = scope === 'statement' ? '题面' : scope === 'attachment' ? '题面附件' : '评测数据';

  const settle = useCallback(
    (confirmed: boolean) => {
      const result = confirmed && action ? action.confirmationRequestId : false;
      resolver.current?.(result);
      resolver.current = null;
      preparing.current = false;
      setAction(null);
    },
    [action],
  );

  useEffect(
    () => () => {
      resolver.current?.(false);
      preparing.current = false;
    },
    [],
  );

  const confirm = useCallback(
    async (nextAction: string, operation: ProblemDataWriteOperation = 'files-upload'): Promise<ProblemDataWriteConfirmationResult> => {
      if (resolver.current || preparing.current) return false;
      preparing.current = true;
      setPreparationError('');
      let prepared: ProblemDataWritePreparation;
      try {
        prepared = prepare
          ? await prepare(operation)
          : {
              active,
              canOverride,
              confirmationRequestId: confirmationRequestIds?.[operation],
            };
      } catch (error) {
        console.error('Problem data write preparation failed', { operation, error });
        setPreparationError(error instanceof Error ? error.message : '获取赛中数据修改确认失败');
        preparing.current = false;
        return false;
      }
      if (!prepared.active.length) {
        preparing.current = false;
        return true;
      }
      if (!prepared.canOverride) {
        setPreparationError(`此题正在比赛或考试中使用，当前角色不能修改${scopeLabel}。`);
        preparing.current = false;
        return false;
      }
      if (!prepared.confirmationRequestId) {
        setPreparationError('服务器未签发赛中数据修改确认凭据，请重试。');
        preparing.current = false;
        return false;
      }
      setAction({
        label: nextAction,
        operation,
        active: prepared.active,
        confirmationRequestId: prepared.confirmationRequestId,
      });
      return new Promise((resolve) => {
        resolver.current = resolve;
      });
    },
    [active, canOverride, confirmationRequestIds, prepare, scopeLabel],
  );

  const notice =
    active.length || preparationError ? (
      <div className="space-y-2">
        {active.length ? (
          <Alert tone="warning">
            <p className="font-medium text-fg">此题正在比赛或考试中使用</p>
            <p className="mt-1 text-xs text-fg-subtle">
              {!canOverride
                ? `当前角色不能在比赛或考试进行中修改${scopeLabel}；操作时会重新检查当前状态。`
                : blocked
                  ? `赛中${scopeLabel}修改确认已失效，请重试。`
                  : `系统管理员每次修改${scopeLabel}前都必须在自定义确认框中明确确认，操作会写入审计日志。`}
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-fg-subtle">
              {active.map((item) => (
                <li key={item.id} className="min-w-0 break-words">
                  {item.title || item.id}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {preparationError ? <Alert tone="danger">{preparationError}</Alert> : null}
      </div>
    ) : null;

  const dialog = action ? (
    <Dialog open onOpenChange={(open) => !open && settle(false)}>
      <DialogContent size="sm" onClose={() => settle(false)}>
        <DialogHeader>
          <DialogTitle>确认修改赛中{scopeLabel}</DialogTitle>
          <DialogDescription>
            你即将执行“{action.label}”。此题正被 {action.active.length} 个进行中的比赛或考试引用，修改可能影响正在答题的学生。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="list-inside list-disc text-xs text-fg-subtle">
            {action.active.map((item) => (
              <li key={item.id} className="min-w-0 break-words">
                {item.title || item.id}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => settle(false)}>
            取消
          </Button>
          <Button type="button" variant="danger" onClick={() => settle(true)}>
            我已确认，继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { active: active.length > 0, blocked, confirm, notice, dialog };
}
