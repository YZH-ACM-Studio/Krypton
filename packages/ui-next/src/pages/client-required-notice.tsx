/**
 * /client-required-notice — landing page for users dropped here by the
 * vigilguard lockout middleware.
 *
 * Renders:
 *   - explanation of why they're seeing this
 *   - which contest (title) triggered the lockout
 *   - when the lockout ends (DateTime)
 *   - a "Open Qt Client" call-to-action (just informational — we can't
 *     actually launch the client from a browser)
 *   - logout link in case the user wanted to sign out
 */
import { motion } from 'motion/react';
import { AlertOctagon, ExternalLink, LogOut, ShieldAlert } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';

interface NoticeData {
  title?: string | null;
  blockStart?: string | null;
  blockEnd?: string | null;
  entryMode?: 'open' | 'client_required' | null;
}

export function ClientRequiredNoticePage() {
  const data = useBootstrap().page.data as NoticeData;
  const title = data?.title;
  const blockEnd = data?.blockEnd;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full"
      >
        <Card className="border-rose-500/30">
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <ShieldAlert className="size-6 text-rose-500" />
            <CardTitle className="text-lg">该时间段禁止普通网页登录</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              你目前处于一场客户端强制比赛的管控时段，普通浏览器访问已被暂时关闭。
              请通过指定的 Qt 客户端进入比赛。
            </p>

            {title && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">触发的比赛</div>
                <div className="mt-1 font-medium">{title}</div>
                {blockEnd && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    预计解除时间：<DateTime value={blockEnd} />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-200">
              <AlertOctagon className="size-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">如何进入</p>
                <ol className="ml-4 list-decimal text-xs leading-relaxed">
                  <li>打开监考用的 Qt 客户端</li>
                  <li>输入学号 / 姓名，等待审批</li>
                  <li>审批通过后客户端会自动打开比赛工作台</li>
                </ol>
              </div>
            </div>

            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href="/logout">
                  <LogOut className="mr-1.5 size-4" />
                  退出登录
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href="/userbind">
                  <ExternalLink className="mr-1.5 size-4" />
                  绑定 / 认领账号
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
