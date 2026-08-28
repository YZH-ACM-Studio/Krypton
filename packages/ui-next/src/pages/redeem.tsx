import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';

interface RedeemPageData {
  result?: { ok?: boolean; redemptionId?: string; batchId?: string; title?: string | null; href?: string | null } | null;
}

export function RedeemPage() {
  const bs = useBootstrap();
  const data = bs.page.data as RedeemPageData;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">兑换码</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">输入兑换码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">成功后会写入对应题集或课程的访问权益并开始学习记录。猜码会被限速。</p>
          {data.result?.ok ? (
            <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200">
              兑换成功{typeof data.result.title === 'string' && data.result.title ? `：${data.result.title}` : '。可以打开对应内容继续学习。'}
              {typeof data.result.href === 'string' && /^\/(course|problem-sets)\/[A-Za-z0-9]+$/.test(data.result.href) ? (
                <>
                  {' '}
                  <a href={data.result.href} className="font-medium underline-offset-2 hover:underline">
                    打开内容
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <form method="post" className="space-y-3" autoComplete="off">
            <Input name="code" required placeholder="兑换码" aria-label="兑换码" />
            <Button type="submit">兑换</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
