import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface ProblemRejudgeDialogProps {
  open: boolean;
  endpoint: string;
  pid: string;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (rejudged: number) => void;
}

async function readRejudgeSuccess(response: Response): Promise<number> {
  if (!response.ok) throw new Error(await readHydroResponseError(response, '整题重测失败'));
  if (response.redirected) throw new Error('整题重测请求发生了非预期重定向');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('整题重测响应不是 JSON，服务器未确认操作成功');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('整题重测响应格式无效');
  }
  const result = payload as Record<string, unknown>;
  if (result.ok !== true || typeof result.rejudged !== 'number' || !Number.isSafeInteger(result.rejudged) || result.rejudged < 0) {
    throw new Error('整题重测响应缺少明确的成功计数');
  }
  return Number(result.rejudged);
}

export function ProblemRejudgeDialog({ open, endpoint, pid, title, onOpenChange, onSuccess }: ProblemRejudgeDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (busy) return;
    setError('');
    onOpenChange(false);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetchHydroResponse(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ operation: 'rejudge' }),
      });
      const rejudged = await readRejudgeSuccess(response);
      onSuccess?.(rejudged);
      toast.success(rejudged ? `已提交 ${rejudged} 条记录重新评测` : '没有符合整题重测条件的记录');
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : '整题重测失败';
      console.error('Whole-problem rejudge failed', { endpoint, pid, cause });
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="md" onClose={close}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-fg">
              <RotateCcw className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle>整题重测</DialogTitle>
              <DialogDescription className="whitespace-normal break-words">
                {pid} · <span className="text-fg">{title}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="warning" title="所有可自动评测的历史提交都会使用当前配置和测试数据重新评测。">
            预评测、生成器、Hack、已取消成绩和人工评分记录不会进入本次队列；相关比赛榜单会随新结果重新计算。
          </Alert>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="button" variant="primary" loading={busy} onClick={() => void submit()}>
            <RotateCcw aria-hidden="true" />
            确认重测
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
