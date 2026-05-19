import { ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';

export function ForbiddenPanel({ message }: { message?: string }) {
  const bs = useBootstrap();
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Card className="w-full max-w-md border-destructive/30">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <ShieldAlert className="size-7 text-destructive" />
          </div>
          <p className="text-base font-semibold">无权访问</p>
          <p className="text-sm text-muted-foreground">
            {message || '当前账号缺少访问该管理页面所需的权限。请联系管理员。'}
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>
              返回上一页
            </Button>
            <Button asChild size="sm">
              <a href={bs.urls.home}>回到首页</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
