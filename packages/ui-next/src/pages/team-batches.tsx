import { useState } from 'react';
import { ArrowRight, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import {
  TEAM_DIALOG_BUTTON_CLASS,
  TEAM_DIALOG_CONTROL_CLASS,
  TEAM_DIALOG_TEXTAREA_CLASS,
  TeamDialogBody,
  TeamDialogContent,
  TeamDialogField,
  TeamDialogFooter,
} from '@/components/team-dialog';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';

interface TeamBatchSummary {
  batchId: string;
  name?: string;
  description?: string;
  status?: string;
  teamCount?: string | number;
  memberCount?: string | number;
  updatedAt?: unknown;
  ownTeam?: { name?: string };
  pendingInviteCount?: string | number;
}

interface TeamBatchesPageData {
  batches?: TeamBatchSummary[];
  capabilities?: { canManage?: boolean };
  page?: string | number;
  pageCount?: string | number;
}

export function TeamBatchesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as TeamBatchesPageData;
  const batches = data.batches || [];
  const canManage = !!data.capabilities?.canManage;
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Page width="wide">
      <PageHeader
        title="队伍中心"
        description="在比赛创建前完成组队。批次关闭后，管理员可在创建团队 ACM 比赛时把当时阵容生成独立快照。"
        meta={(
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" />
            赛前协作
          </span>
        )}
        actions={canManage ? (
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus /> 新建组队批次
          </Button>
        ) : undefined}
      />

      {batches.length ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {batches.map((batch) => {
            const open = batch.status === 'open';
            const href = `/teams/${encodeURIComponent(String(batch.batchId))}`;
            return (
              <Panel
                key={String(batch.batchId)}
                className="h-full"
                title={<span className="block min-w-0 truncate">{batch.name}</span>}
                actions={(
                  <Badge tone={open ? 'success' : 'neutral'} variant={open ? 'soft' : 'outline'} dot={open}>
                    {open ? '组队中' : '已关闭 · 可绑定'}
                  </Badge>
                )}
              >
                <div className="flex flex-col gap-3">
                  <p className="line-clamp-2 min-h-10 min-w-0 text-sm text-fg-muted">{batch.description || '暂无批次说明'}</p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
                    <span className="tabular">{Number(batch.teamCount || 0)} 支队伍</span>
                    <span className="tabular">{Number(batch.memberCount || 0)} 名成员</span>
                    <span>更新于 {formatDateTime(batch.updatedAt, bs.locale)}</span>
                  </p>
                  {batch.ownTeam ? (
                    <div className="rounded-md bg-surface-sunken px-3 py-2 text-sm">
                      <p className="text-xs text-fg-subtle">我的队伍</p>
                      <p className="mt-0.5 min-w-0 truncate font-medium text-fg">{batch.ownTeam.name}</p>
                    </div>
                  ) : Number(batch.pendingInviteCount || 0) > 0 ? (
                    <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-warning-fg">
                      有 {Number(batch.pendingInviteCount)} 条待处理邀请
                    </p>
                  ) : (
                    <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-fg-muted">
                      {open ? '尚未加入队伍' : '本批次已结束组队'}
                    </p>
                  )}
                  <Button asChild variant="secondary" className="w-full">
                    <a href={href}>
                      {open ? '进入组队工作台' : '查看批次阵容'}
                      <ArrowRight />
                    </a>
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Users />}
          title="还没有组队批次"
          description="管理员创建批次后，参赛者就可以在比赛建立前组队。"
        />
      )}

      <Pagination current={Number(data.page || 1)} total={Number(data.pageCount || 1)} baseUrl="/teams" />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <TeamDialogContent
          titleId="create-team-batch-dialog-title"
          descriptionId="create-team-batch-dialog-description"
          title="新建组队批次"
          description="先开放独立组队空间，关闭后再把确定阵容绑定到团队 ACM 比赛。"
          icon={<Users className="size-5" />}
          onClose={() => setCreateOpen(false)}
        >
          <form method="post" className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="operation" value="create" />
            <TeamDialogBody>
              <TeamDialogField htmlFor="create-team-batch-name" label="批次名称" hint="1–64 个字符">
                <Input
                  id="create-team-batch-name"
                  name="name"
                  required
                  maxLength={64}
                  autoFocus
                  placeholder="例如：2026 暑期留校赛组队"
                  className={TEAM_DIALOG_CONTROL_CLASS}
                />
              </TeamDialogField>
              <TeamDialogField htmlFor="create-team-batch-description" label="批次说明" hint="可选 · 最多 500 个字符">
                <Textarea
                  id="create-team-batch-description"
                  name="description"
                  maxLength={500}
                  placeholder="组队用途、截止安排等"
                  className={TEAM_DIALOG_TEXTAREA_CLASS}
                />
              </TeamDialogField>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                取消
              </Button>
              <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
                创建批次
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>
    </Page>
  );
}
