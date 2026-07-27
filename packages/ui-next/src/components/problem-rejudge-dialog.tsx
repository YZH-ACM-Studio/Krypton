import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast, ToastProvider } from '@/components/ui/toast';
import { readHydroResponseError } from '@/lib/problem-save-response';

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
      const response = await fetch(endpoint, {
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
    <>
      <ToastProvider />
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
        <DialogContent className="w-[min(34rem,calc(100vw-1.5rem))]" onClose={close}>
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <RotateCcw className="size-4.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <DialogTitle>整题重测</DialogTitle>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {pid} · <span className="text-foreground">{title}</span>
                </p>
              </div>
            </div>
          </DialogHeader>
          <DialogBody className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">所有可自动评测的历史提交都会使用当前配置和测试数据重新评测。</p>
                  <p className="leading-6 text-muted-foreground">
                    预评测、生成器、Hack、已取消成绩和人工评分记录不会进入本次队列；相关比赛榜单会随新结果重新计算。
                  </p>
                </div>
              </div>
            </div>
            {error ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </DialogBody>
          <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              取消
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
              )}
              确认重测
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
