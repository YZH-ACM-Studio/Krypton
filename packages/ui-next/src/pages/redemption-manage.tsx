import { useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';

interface RedemptionBatch {
  _id: string;
  note?: string;
  targetKind?: string;
  targetId?: string;
  stageId?: number;
  firstRedeemedAt?: string | null;
  createdAt?: string;
}

interface PlainCode {
  codeId: string;
  code: string;
  hint: string;
  weak: boolean;
}

interface RedemptionManageData {
  batches?: RedemptionBatch[];
  canManageAll?: boolean;
  once?: boolean;
  warning?: string | null;
  plaintext?: PlainCode[];
  csv?: string;
  batch?: RedemptionBatch;
}

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  link.click();
  URL.revokeObjectURL(link.href);
}

export function RedemptionCodeManagePage() {
  const bs = useBootstrap();
  const data = bs.page.data as RedemptionManageData;
  const [targetKind, setTargetKind] = useState('problem_set');
  if (!bs.user.canManageRedemptionCodes) return <ForbiddenPanel message="你没有管理兑换码的权限。" />;

  const batches = Array.isArray(data.batches) ? data.batches : [];
  const plaintext = Array.isArray(data.plaintext) ? data.plaintext : [];

  return (
    <AdminPage
      title={
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">兑换码</h1>
        </div>
      }
      bypassPrivGate
    >
      {plaintext.length ? (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="text-base">仅此一次</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>明文码只在这一次响应里出现，离开或刷新后无法恢复。请立即下载或复制。</p>
            {data.warning ? <p className="text-amber-700 dark:text-amber-300">{data.warning}</p> : null}
            <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{plaintext.map((item) => item.code).join('\n')}</pre>
            {data.csv ? (
              <Button type="button" onClick={() => downloadCsv(`redemption-${data.batch?._id || 'codes'}.csv`, data.csv || '')}>
                下载 CSV
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">创建批次</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="operation" value="create" />
            <label className="space-y-1 text-sm md:col-span-2">
              备注
              <Input name="note" />
            </label>
            <label className="space-y-1 text-sm">
              目标类型
              <SimpleSelect
                name="targetKind"
                value={targetKind}
                onValueChange={setTargetKind}
                options={[
                  { value: 'problem_set', label: '整集' },
                  { value: 'problem_set_stage', label: '题集阶段' },
                  { value: 'course', label: '课程' },
                ]}
              />
            </label>
            <label className="space-y-1 text-sm">
              目标 ID
              <Input name="targetId" required />
            </label>
            {targetKind === 'problem_set_stage' ? (
              <label className="space-y-1 text-sm">
                阶段 ID
                <Input name="stageId" defaultValue="1" />
              </label>
            ) : null}
            <label className="space-y-1 text-sm">
              允许用户组
              <Input name="allowedGroupIds" placeholder="逗号分隔，空表示不限" />
            </label>
            <label className="space-y-1 text-sm">
              类型
              <SimpleSelect
                name="kind"
                defaultValue="single"
                options={[
                  { value: 'single', label: '单次码' },
                  { value: 'limited', label: '限量通用码' },
                ]}
              />
            </label>
            <label className="space-y-1 text-sm">
              每码次数上限
              <Input name="maxUses" defaultValue="1" />
            </label>
            <label className="space-y-1 text-sm">
              有效期
              <Input name="expiresAt" placeholder="ISO 时间，可空" />
            </label>
            <label className="space-y-1 text-sm">
              自动生成数量
              <Input name="count" defaultValue="1" />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              手工码（每行一个，可空）
              <Textarea name="manualCodes" rows={4} />
            </label>
            <div>
              <Button type="submit">创建并显示明文</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{data.canManageAll ? '全部批次' : '我创建的批次'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {batches.length === 0 ? <p className="text-sm text-muted-foreground">还没有兑换批次。</p> : null}
          {batches.map((batch) => (
            <BatchRow key={String(batch._id)} batch={batch} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">停用码 / 撤销单人兑换来源</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <form method="post" className="space-y-2">
            <input type="hidden" name="operation" value="disable" />
            <label className="space-y-1 text-sm">
              码 ID
              <Input name="codeId" required />
            </label>
            <p className="text-xs text-muted-foreground">停用只阻止未来兑换，不追回已发权益。</p>
            <Button type="submit" variant="outline">
              停用
            </Button>
          </form>
          <form method="post" className="space-y-2">
            <input type="hidden" name="operation" value="revoke" />
            <label className="space-y-1 text-sm">
              用户 UID
              <Input name="uid" required />
            </label>
            <label className="space-y-1 text-sm">
              权益 ID
              <Input name="entitlementId" required />
            </label>
            <p className="text-xs text-muted-foreground">只撤销这一项兑换来源，公开/用户组/课程和其他兑换仍然有效。</p>
            <Button type="submit" variant="destructive">
              撤销该来源
            </Button>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

function BatchRow({ batch }: { batch: RedemptionBatch }) {
  const frozen = !!batch.firstRedeemedAt;
  const [open, setOpen] = useState(false);
  const summary = useMemo(
    () => `${batch.targetKind || ''} ${batch.targetId || ''} 阶段 ${batch.stageId ?? 0}${frozen ? ' · 已冻结目标' : ''}`,
    [batch, frozen],
  );
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs">{String(batch._id)}</p>
          <p className="text-muted-foreground">{batch.note || '无备注'}</p>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? '收起编辑' : '编辑允许字段'}
        </Button>
      </div>
      {open ? (
        <form method="post" className="mt-3 grid gap-2 md:grid-cols-2">
          <input type="hidden" name="operation" value="edit" />
          <input type="hidden" name="batchId" value={String(batch._id)} />
          <label className="space-y-1 text-sm md:col-span-2">
            备注
            <Input name="note" defaultValue={batch.note || ''} />
          </label>
          {frozen ? null : (
            <>
              <label className="space-y-1 text-sm">
                目标类型
                <Input name="targetKind" defaultValue={batch.targetKind || 'problem_set'} />
              </label>
              <label className="space-y-1 text-sm">
                目标 ID
                <Input name="targetId" defaultValue={String(batch.targetId || '')} />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                允许用户组
                <Input name="allowedGroupIds" />
              </label>
            </>
          )}
          <label className="space-y-1 text-sm">
            新上限
            <Input name="maxUses" />
          </label>
          <label className="space-y-1 text-sm">
            延长有效期
            <Input name="expiresAt" />
          </label>
          <div>
            <Button type="submit" size="sm">
              保存
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
