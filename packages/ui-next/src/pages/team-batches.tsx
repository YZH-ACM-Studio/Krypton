import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Clock3, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  TEAM_DIALOG_BUTTON_CLASS,
  TEAM_DIALOG_CONTROL_CLASS,
  TEAM_DIALOG_TEXTAREA_CLASS,
  TeamDialogBody,
  TeamDialogContent,
  TeamDialogField,
  TeamDialogFooter,
} from '@/components/team-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';

type R = Record<string, any>;

export function TeamBatchesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as R;
  const batches = (data.batches || []) as R[];
  const canManage = !!data.capabilities?.canManage;
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Users className="size-4" /> 赛前协作
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">队伍中心</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            在比赛创建前完成组队。批次关闭后，管理员可在创建团队 ACM 比赛时把当时阵容生成独立快照。
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 新建组队批次
          </Button>
        ) : null}
      </header>

      {batches.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {batches.map((batch) => {
            const open = batch.status === 'open';
            const href = `/teams/${encodeURIComponent(String(batch.batchId))}`;
            return (
              <Card key={String(batch.batchId)} className="group flex h-full flex-col transition-colors hover:border-primary/40">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-lg">{batch.name}</CardTitle>
                      <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{batch.description || '暂无批次说明'}</p>
                    </div>
                    <Badge variant={open ? 'secondary' : 'outline'} className="shrink-0 gap-1">
                      {open ? <Clock3 className="size-3" /> : <CheckCircle2 className="size-3" />}
                      {open ? '组队中' : '已关闭 · 可绑定'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-lg bg-muted px-2 py-1">{Number(batch.teamCount || 0)} 支队伍</span>
                    <span className="rounded-lg bg-muted px-2 py-1">{Number(batch.memberCount || 0)} 名成员</span>
                    <span className="rounded-lg bg-muted px-2 py-1">更新于 {formatDateTime(batch.updatedAt, bs.locale)}</span>
                  </div>
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  {batch.ownTeam ? (
                    <div className="rounded-xl border bg-primary/5 px-3 py-2 text-sm">
                      <p className="text-xs text-muted-foreground">我的队伍</p>
                      <p className="mt-0.5 font-medium">{batch.ownTeam.name}</p>
                    </div>
                  ) : Number(batch.pendingInviteCount || 0) > 0 ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                      有 {Number(batch.pendingInviteCount)} 条待处理邀请
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
                      {open ? '尚未加入队伍' : '本批次已结束组队'}
                    </div>
                  )}
                  <Button asChild variant="outline" className="w-full justify-between">
                    <a href={href}>
                      {open ? '进入组队工作台' : '查看批次阵容'}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
              <Users className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">还没有组队批次</p>
              <p className="mt-1 text-sm text-muted-foreground">管理员创建批次后，参赛者就可以在比赛建立前组队。</p>
            </div>
          </CardContent>
        </Card>
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
              <Button type="submit" className={TEAM_DIALOG_BUTTON_CLASS}>
                创建批次
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>
    </motion.div>
  );
}
