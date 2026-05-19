import { useEffect } from 'react';
import { motion } from 'motion/react';
import { FileArchive, Info, LogIn, Trophy, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBootstrap } from '@/lib/bootstrap';

export function FpsImportPage() {
  return (
    <motion.div
      className="grid gap-5 lg:grid-cols-[1fr_280px]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <main>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <FileArchive className="size-5 text-primary" />
              从 FPS 文件导入题目
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" encType="multipart/form-data" className="space-y-5">
              <div className="rounded-md border bg-muted/30 p-5">
                <label htmlFor="fps-file" className="text-sm font-medium">FPS / XML / ZIP 文件</label>
                <p className="mt-1 text-sm text-muted-foreground">选择由 HUSTOJ/FPS 工具导出的题目包，系统会导入题面、标签、测试数据和题解。</p>
                <input
                  id="fps-file"
                  type="file"
                  name="file"
                  required
                  className="mt-4 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" className="gap-2">
                  <Upload className="size-4" />
                  上传并导入
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
      <aside>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" />
              导入说明
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>大型 XML 会消耗较多内存；如果文件很大，建议先拆分题目包或移除测试数据后再分别上传。</p>
            <p>导入完成后会返回题库列表，你可以继续编辑题面、配置评测文件和补充标签。</p>
          </CardContent>
        </Card>
      </aside>
    </motion.div>
  );
}

export function TelegramLoginPage() {
  const bs = useBootstrap();
  const botLogin = bs.page.data.botLogin || '';

  useEffect(() => {
    if (!botLogin) return undefined;
    (window as any).onTelegramAuth = (user: unknown) => {
      window.location.href = `/oauth/telegram/callback?payload=${encodeURIComponent(JSON.stringify(user))}`;
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset.telegramLogin = botLogin;
    script.dataset.size = 'large';
    script.dataset.onauth = 'onTelegramAuth(user)';
    script.dataset.requestAccess = 'write';
    document.getElementById('telegram-login-widget')?.appendChild(script);
    return () => {
      script.remove();
      delete (window as any).onTelegramAuth;
    };
  }, [botLogin]);

  return (
    <motion.div
      className="mx-auto flex min-h-[60vh] max-w-md items-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="w-full">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LogIn className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">使用 Telegram 登录</h1>
          <p className="mt-2 text-sm text-muted-foreground">请在弹出的 Telegram 授权组件中确认身份。</p>
          <div id="telegram-login-widget" className="mt-6 min-h-10" />
          {!botLogin ? (
            <p className="mt-4 text-sm text-destructive">Telegram Bot 尚未配置。</p>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function XcpcioBoardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const scriptSrc = data.js ? `/assets/index-${data.js}.js` : '';
  const cssHref = data.css ? `/assets/index-${data.css}.css` : '';

  useEffect(() => {
    (window as any).CDN_HOST = '/';
    (window as any).__toAssetUrl = (url: string) => `/${url}`.replace(/\/+/g, '/');
    (window as any).DATA_HOST = '/';
    (window as any).DATA_REGION = 'Hydro';
    (window as any).DEFAULT_LANG = bs.locale?.startsWith('zh') ? 'zh-CN' : 'en';
    (window as any).DATA_SOURCE = data.dataSource || '';
    if (data.refreshInterval) (window as any).REFRESH_INTERVAL = data.refreshInterval;

    const created: HTMLElement[] = [];
    if (cssHref) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      created.push(link);
    }
    if (scriptSrc) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = scriptSrc;
      script.crossOrigin = 'anonymous';
      document.body.appendChild(script);
      created.push(script);
    }
    return () => {
      created.forEach((node) => node.remove());
    };
  }, [bs.locale, cssHref, data.dataSource, data.refreshInterval, scriptSrc]);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Trophy className="size-5 text-primary" />
            XCPCIO 榜单
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.tdoc?.title || '比赛榜单'} · 外榜视图
          </p>
        </div>
        {data.realtime ? <Badge variant="secondary">实时</Badge> : <Badge variant="outline">封榜/静态</Badge>}
      </div>
      {scriptSrc && cssHref ? (
        <div className="overflow-hidden rounded-md border bg-card">
          <div id="app" className="min-h-[70vh]" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            榜单资源尚未准备好，请确认 scoreboard-xcpcio 静态资源已构建并复制到公开目录。
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
