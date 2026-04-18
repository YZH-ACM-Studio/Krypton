/**
 * Sudo verification page — shown when a privileged action requires
 * re-authentication (e.g. accessing security settings).
 */

import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
          <p className="text-sm text-muted-foreground">
            此操作需要重新验证您的身份，请输入密码以继续。
          </p>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sudo-password">密码</label>
              <Input
                id="sudo-password"
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                placeholder="请输入您的密码"
              />
            </div>
            <Button type="submit" className="w-full">验证</Button>
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
  return (
    <motion.div
      className="flex min-h-[60vh] items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <p className="text-sm text-muted-foreground">正在跳转…</p>
    </motion.div>
  );
}
