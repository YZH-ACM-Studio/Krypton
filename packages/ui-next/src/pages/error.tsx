import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Bug, Home } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';

/**
 * Substitute Hydro-style `{0}`, `{1}` placeholders in an error template with
 * the matching entries from `params`. Falls back to leaving the literal token
 * in place if the index is missing — that's strictly better than emitting raw
 * "{1}" to end users.
 */
function substituteErrorParams(template: string, params: unknown[] | undefined): string {
  if (!template) return '';
  const safeParams = Array.isArray(params) ? params : [];
  return template.replace(/\{(\d+)\}/g, (token, idx) => {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= safeParams.length) return token;
    const value = safeParams[i];
    if (value == null) return token;
    return String(value);
  });
}

export function ErrorPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const error = data.error;
  const rawMessage = typeof error === 'string'
    ? error
    : error?.message || error?.msg || '发生了一个错误';
  const params = typeof error === 'object' && error !== null
    ? (error.params as unknown[] | undefined)
    : undefined;
  const message = substituteErrorParams(String(rawMessage), params);
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
          {code ? (
            <p className="text-4xl font-bold text-muted-foreground">{code}</p>
          ) : null}
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
  const data = bs.page.data;
  const error = typeof data.error === 'string' ? data.error : '';

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
          <p className="text-sm text-muted-foreground">
            服务器遇到了未预期的错误，请稍后重试或联系管理员。
          </p>
          {error ? (
            <pre className="mt-4 max-h-64 w-full overflow-auto rounded-md bg-muted p-4 text-left text-xs text-muted-foreground">
              {error}
            </pre>
          ) : null}
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
