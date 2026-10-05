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
import { ExternalLink, LogOut, MonitorSmartphone } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { EmptyState } from '@/components/ui/empty-state';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

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
    <Page width="prose">
      <EmptyState
        icon={<MonitorSmartphone />}
        title="该时间段禁止普通网页登录"
        description="你目前处于一场客户端强制比赛的管控时段，普通浏览器访问已被暂时关闭。请通过指定的 Qt 客户端进入比赛。"
      />

      {title ? (
        <Panel>
          <div className="text-xs text-fg-subtle">触发的比赛</div>
          <div className="mt-1 break-words font-medium text-fg">{title}</div>
          {blockEnd ? (
            <div className="mt-1 text-xs text-fg-subtle">
              预计解除时间：
              <DateTime value={blockEnd} />
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Alert tone="warning" title="如何进入">
        <ol className="ml-4 list-decimal text-xs leading-relaxed">
          <li>打开监考用的 Qt 客户端</li>
          <li>输入学号 / 姓名，等待审批</li>
          <li>审批通过后客户端会自动打开比赛工作台</li>
        </ol>
      </Alert>

      <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
        <Button asChild variant="secondary" className="w-full sm:w-auto">
          <a href="/logout">
            <LogOut />
            退出登录
          </a>
        </Button>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <a href="/userbind">
            <ExternalLink />
            绑定 / 认领账号
          </a>
        </Button>
      </div>
    </Page>
  );
}
