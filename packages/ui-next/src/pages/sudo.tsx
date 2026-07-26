/**
 * Sudo verification page — shown when a privileged action requires
 * re-authentication (e.g. accessing security settings).
 */

import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';
import { buildSudoReplayFields, resolveSudoReplayTarget } from '@/lib/sudo-replay';

export function SudoPage() {
  return (
    <motion.div
      className="flex min-h-[60vh] items-center justify-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-5 text-primary" />
          </div>
          <CardTitle className="text-lg">身份验证</CardTitle>
          <p className="text-sm text-muted-foreground">此操作需要重新验证您的身份，请输入密码以继续。</p>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sudo-password">
                密码
              </label>
              <Input id="sudo-password" name="password" type="password" autoComplete="current-password" autoFocus placeholder="请输入您的密码" />
            </div>
            <Button type="submit" className="w-full">
              验证
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Sudo redirect page — auto-submits a form to replay the original
 * request after sudo verification succeeds.
 */
export function SudoRedirectPage() {
  const data = useBootstrap().page.data as {
    args?: unknown;
    method?: unknown;
    redirect?: unknown;
  };
  const formRef = useRef<HTMLFormElement | null>(null);
  const submittedRef = useRef(false);
  const target = resolveSudoReplayTarget(data.method, data.redirect);
  const fields = useMemo(() => buildSudoReplayFields(data.args), [data.args]);

  useEffect(() => {
    if (submittedRef.current || !formRef.current) return;
    submittedRef.current = true;
    formRef.current.requestSubmit();
  }, []);

  return (
    <motion.div className="flex min-h-[60vh] items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <form ref={formRef} method="post" action={target} className="space-y-3 text-center">
        {fields.map((field, index) => (
          <input key={`${field.name}-${index}`} type="hidden" name={field.name} value={field.value} />
        ))}
        <p className="text-sm text-muted-foreground">身份验证成功，正在继续原操作…</p>
        <Button type="submit" variant="outline" className="min-h-10">
          立即继续
        </Button>
      </form>
    </motion.div>
  );
}
