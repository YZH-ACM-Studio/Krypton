import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Bug, Home } from 'lucide-react';
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';
import { presentHydroErrorPayload } from '@/lib/error-presenter';

interface ErrorPageData {
  code?: string | number;
  error?: unknown;
  status?: string | number;
}

export function ErrorPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ErrorPageData;
  const message = useMemo(() => presentHydroErrorPayload(data.error, '页面加载失败'), [data.error]);
  const code = data.code || data.status || '';

  return (
    <motion.div
      className="flex min-h-[60vh] items-center justify-center"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-yellow-500/10 p-4">
            <AlertTriangle className="size-8 text-yellow-500" />
          </div>
          {code ? <p className="text-4xl font-bold text-muted-foreground">{code}</p> : null}
          <p className="text-lg font-medium">{message}</p>
          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft className="mr-2 size-4" />
              返回
            </Button>
            <Button asChild>
              <a href={bs.urls.home}>
                <Home className="mr-2 size-4" />
                首页
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function BsodPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ErrorPageData;
  const message = useMemo(() => presentHydroErrorPayload(data.error, '服务器内部错误'), [data.error]);

  return (
    <motion.div
      className="flex min-h-[60vh] items-center justify-center"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="w-full max-w-2xl border-destructive/30">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <Bug className="size-8 text-destructive" />
          </div>
          <p className="text-lg font-semibold">服务器内部错误</p>
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft className="mr-2 size-4" />
              返回
            </Button>
            <Button asChild>
              <a href={bs.urls.home}>
                <Home className="mr-2 size-4" />
                首页
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
