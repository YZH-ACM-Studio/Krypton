import { type FormEvent, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { cn } from '@/lib/cn';

export interface RedeemResultView {
  ok: true;
  redemptionId: string;
  batchId: string;
  targetKind: string | null;
  title: string | null;
  href: string | null;
}

function parseRedeemResult(value: unknown): RedeemResultView {
  const payload = value && typeof value === 'object' && 'result' in value ? (value as { result: unknown }).result : value;
  if (!payload || typeof payload !== 'object') throw new Error('兑换成功响应格式错误');
  const result = payload as {
    ok?: unknown;
    redemptionId?: unknown;
    batchId?: unknown;
    targetKind?: unknown;
    title?: unknown;
    href?: unknown;
  };
  if (result.ok !== true) throw new Error('兑换成功响应格式错误');
  const redemptionId = String(result.redemptionId || '');
  const batchId = String(result.batchId || '');
  if (!redemptionId || !batchId) throw new Error('兑换成功响应格式错误');
  return {
    ok: true,
    redemptionId,
    batchId,
    targetKind: typeof result.targetKind === 'string' ? result.targetKind : null,
    title: typeof result.title === 'string' && result.title ? result.title : null,
    href: typeof result.href === 'string' && /^\/(course|problem-sets)\/[A-Za-z0-9]+$/.test(result.href) ? result.href : null,
  };
}

export async function redeemCode(code: string): Promise<RedeemResultView> {
  const body = new URLSearchParams({ code });
  const response = await fetchHydroResponse('/redeem', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '兑换失败'));
  return parseRedeemResult(await response.json());
}

export function RedeemForm({ onRedeemed }: { onRedeemed?: (result: RedeemResultView) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RedeemResultView | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextCode = code.trim();
    if (!nextCode) {
      setError('兑换码无效');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const redeemed = await redeemCode(nextCode);
      setResult(redeemed);
      setCode('');
      onRedeemed?.(redeemed);
    } catch (cause) {
      setResult(null);
      setError((cause as { message?: string } | null)?.message || '兑换失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3" autoComplete="off" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">成功后会写入对应题集或课程的访问权益并开始学习记录。猜码会被限速。</p>
      {result ? (
        <div
          role="status"
          className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200"
        >
          <p>兑换成功{result.title ? `：${result.title}` : '。可以打开对应内容继续学习。'}</p>
          {result.href ? (
            <a href={result.href} className="mt-1 inline-flex font-medium underline-offset-2 hover:underline">
              打开{result.targetKind === 'course' ? '课程' : '题集'}
            </a>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Input
        name="code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
        placeholder="兑换码"
        aria-label="兑换码"
        autoComplete="off"
      />
      <Button type="submit" disabled={busy} className="min-h-11 w-full">
        {busy ? '兑换中' : '兑换'}
      </Button>
    </form>
  );
}

export function RedeemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>兑换码</DialogTitle>
        </DialogHeader>
        <DialogBody className="px-6 py-4">
          <RedeemForm />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function RedeemDialogButton({
  label = '兑换码',
  variant = 'outline',
  size = 'sm',
  className,
  iconOnly = false,
}: {
  label?: string;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'icon' | 'default';
  className?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn(iconOnly ? 'size-8' : 'gap-1.5', className)}
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <KeyRound className="size-4" />
        {iconOnly ? <span className="sr-only">{label}</span> : label}
      </Button>
      <RedeemDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
