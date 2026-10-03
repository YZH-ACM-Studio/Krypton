import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

interface RedeemPageData {
  result?: { ok?: boolean; redemptionId?: string; batchId?: string; title?: string | null; href?: string | null } | null;
}

export function RedeemPage() {
  const bs = useBootstrap();
  const data = bs.page.data as RedeemPageData;
  const result = data.result;
  return (
    <Page width="form">
      <PageHeader title="兑换码" />
      <Panel title="输入兑换码" description="成功后会写入对应题集或课程的访问权益并开始学习记录。猜码会被限速。">
        <div className="flex flex-col gap-4">
          {result?.ok ? (
            <Alert tone="success">
              兑换成功{typeof result.title === 'string' && result.title ? `：${result.title}` : '。可以打开对应内容继续学习。'}
              {typeof result.href === 'string' && /^\/(?:course|problem-sets)\/[A-Za-z0-9]+$/.test(result.href) ? (
                <>
                  {' '}
                  <a href={result.href} className="font-medium text-brand-fg underline-offset-2 hover:underline">
                    打开内容
                  </a>
                </>
              ) : null}
            </Alert>
          ) : null}
          <form method="post" className="flex flex-col items-start gap-5" autoComplete="off">
            <Input name="code" required placeholder="兑换码" aria-label="兑换码" className="text-lg md:text-sm" />
            <Button type="submit" variant="primary">
              兑换
            </Button>
          </form>
        </div>
      </Panel>
    </Page>
  );
}
