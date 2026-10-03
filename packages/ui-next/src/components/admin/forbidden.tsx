import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useBootstrap } from '@/lib/bootstrap';

const DEFAULT_TITLE = '无权访问';
const DEFAULT_DESCRIPTION = '当前账号缺少访问该管理页面所需的权限。请联系管理员。';

export function ForbiddenPanel({ message }: { message?: string }) {
  const bs = useBootstrap();
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={message ?? DEFAULT_TITLE}
      description={message ? undefined : DEFAULT_DESCRIPTION}
      action={(
        <>
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>
            返回上一页
          </Button>
          <Button asChild size="sm">
            <a href={bs.urls.home}>回到首页</a>
          </Button>
        </>
      )}
    />
  );
}
