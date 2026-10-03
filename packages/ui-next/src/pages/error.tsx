import { AlertTriangle, ArrowLeft, Home } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Page } from '@/components/ui/page';
import { useBootstrap } from '@/lib/bootstrap';
import { presentHydroErrorPayload } from '@/lib/error-presenter';

interface ErrorPageData {
  code?: string | number;
  error?: unknown;
  status?: string | number;
}

function errorActions(home: string) {
  return (
    <>
      <Button variant="secondary" type="button" onClick={() => window.history.back()}>
        <ArrowLeft />
        返回
      </Button>
      <Button variant="primary" asChild>
        <a href={home}>
          <Home />
          首页
        </a>
      </Button>
    </>
  );
}

export function ErrorPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ErrorPageData;
  const message = useMemo(() => presentHydroErrorPayload(data.error, '页面加载失败'), [data.error]);
  const code = data.code || data.status || '';

  return (
    <Page width="form">
      <EmptyState
        icon={<AlertTriangle />}
        title={code ? <span className="tabular break-words">{code}</span> : <span className="break-words">{message}</span>}
        description={code ? <span className="break-words">{message}</span> : undefined}
        action={errorActions(bs.urls.home)}
      />
    </Page>
  );
}

export function BsodPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ErrorPageData;
  const message = useMemo(() => presentHydroErrorPayload(data.error, '服务器内部错误'), [data.error]);

  return (
    <Page width="form">
      <EmptyState
        icon={<AlertTriangle />}
        title="服务器内部错误"
        description={<span className="break-words">{message}</span>}
        action={errorActions(bs.urls.home)}
      />
    </Page>
  );
}
