import { useMemo, useState } from 'react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';

interface RedemptionHint {
  codeId: string;
  hint: string;
  status?: string;
  usedCount?: number;
  maxUses?: number;
  expiresAt?: string | null;
  kind?: string;
}

interface RedemptionBatch {
  _id: string;
  note?: string;
  targetKind?: string;
  targetId?: string;
  stageId?: number;
  firstRedeemedAt?: string | null;
  createdAt?: string;
  stats?: { total?: number; active?: number; disabled?: number; used?: number; remaining?: number };
  hints?: RedemptionHint[];
}

interface PlainCode {
  codeId: string;
  code: string;
  hint: string;
  weak: boolean;
}

interface ActiveEntitlement {
  entitlementId: string;
  sourceId: string;
  target: string;
}

interface RedemptionManageData {
  batches?: RedemptionBatch[];
  canManageAll?: boolean;
  once?: boolean;
  warning?: string | null;
  plaintext?: PlainCode[];
  csv?: string;
  batch?: RedemptionBatch;
  lookupUid?: number;
  entitlements?: ActiveEntitlement[];
  revokeResult?: { revokedCount?: number; remainingSources?: Array<{ kind?: string; entitlementId?: string; groupId?: string; courseId?: string }> };
}

function parseActiveEntitlements(value: unknown): ActiveEntitlement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('权益列表格式不正确');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('权益格式不正确');
    const rec = item as Record<string, unknown>;
    if (typeof rec.entitlementId !== 'string' || !rec.entitlementId) throw new Error('权益 ID 格式不正确');
    if (typeof rec.sourceId !== 'string' || !rec.sourceId) throw new Error('来源 ID 格式不正确');
    if (typeof rec.target !== 'string' || !rec.target) throw new Error('权益目标格式不正确');
    return { entitlementId: rec.entitlementId, sourceId: rec.sourceId, target: rec.target };
  });
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
  const lookupUid = typeof data.lookupUid === 'number' && Number.isSafeInteger(data.lookupUid) && data.lookupUid > 0 ? data.lookupUid : 0;
  const entitlements = parseActiveEntitlements(data.entitlements);
  const [revokeUid, setRevokeUid] = useState(lookupUid ? String(lookupUid) : '');
  const [revokeEntitlementId, setRevokeEntitlementId] = useState('');
  if (!bs.user.canManageRedemptionCodes) return <ForbiddenPanel message="你没有管理兑换码的权限。" />;

  const batches = Array.isArray(data.batches) ? data.batches : [];
  const plaintext = Array.isArray(data.plaintext) ? data.plaintext : [];

  return (
    <AdminPage
      contentClassName="flex min-w-0 flex-col gap-6 short:gap-4"
      title="兑换码"
      bypassPrivGate
    >
      {data.revokeResult ? (
        <Panel title="撤销结果">
          <div className="space-y-1 text-sm">
            <p className="tabular">已撤销 {data.revokeResult.revokedCount || 0} 项同一兑换来源权益。</p>
            <p className="text-fg-muted">
              仍有效来源：
              {(data.revokeResult.remainingSources || []).length
                ? (data.revokeResult.remainingSources || [])
                    .map((source) => source.kind || 'unknown')
                    .join('、')
                : '无'}
            </p>
          </div>
        </Panel>
      ) : null}

      {plaintext.length ? (
        <Panel title="仅此一次" className="border-warning-line">
          <div className="space-y-3 text-sm">
            <p>明文码只在这一次响应里出现，离开或刷新后无法恢复。请立即下载或复制。</p>
            {data.warning ? <p className="text-warning-fg">{data.warning}</p> : null}
            <pre className="overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-xs">{plaintext.map((item) => item.code).join('\n')}</pre>
            {data.csv ? (
              <Button type="button" variant="secondary" onClick={() => downloadCsv(`redemption-${data.batch?._id || 'codes'}.csv`, data.csv || '')}>
                下载 CSV
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="创建批次">
        <form method="post" className="grid gap-5 md:grid-cols-2">
          <input type="hidden" name="operation" value="create" />
          <FormField label="备注" htmlFor="redemption-note" className="md:col-span-2">
            <Input id="redemption-note" name="note" />
          </FormField>
          <FormField label="目标类型" htmlFor="redemption-target-kind">
            <SimpleSelect
              id="redemption-target-kind"
              name="targetKind"
              value={targetKind}
              onValueChange={setTargetKind}
              options={[
                { value: 'problem_set', label: '整集' },
                { value: 'problem_set_stage', label: '题集阶段' },
                { value: 'course', label: '课程' },
              ]}
            />
          </FormField>
          <FormField label="目标 ID" htmlFor="redemption-target-id" required>
            <Input id="redemption-target-id" name="targetId" required />
          </FormField>
          {targetKind === 'problem_set_stage' ? (
            <FormField label="阶段 ID" htmlFor="redemption-stage-id">
              <Input id="redemption-stage-id" name="stageId" defaultValue="1" />
            </FormField>
          ) : null}
          <FormField label="允许用户组" htmlFor="redemption-allowed-groups">
            <Input id="redemption-allowed-groups" name="allowedGroupIds" placeholder="逗号分隔，空表示不限" />
          </FormField>
          <FormField label="类型" htmlFor="redemption-kind">
            <SimpleSelect
              id="redemption-kind"
              name="kind"
              defaultValue="single"
              options={[
                { value: 'single', label: '单次码' },
                { value: 'limited', label: '限量通用码' },
              ]}
            />
          </FormField>
          <FormField label="每码次数上限" htmlFor="redemption-max-uses">
            <Input id="redemption-max-uses" name="maxUses" defaultValue="1" />
          </FormField>
          <FormField label="有效期" htmlFor="redemption-expires">
            <Input id="redemption-expires" name="expiresAt" placeholder="ISO 时间，可空" />
          </FormField>
          <FormField label="自动生成数量" htmlFor="redemption-count">
            <Input id="redemption-count" name="count" defaultValue="1" />
          </FormField>
          <FormField label="手工码（每行一个，可空）" htmlFor="redemption-manual" className="md:col-span-2">
            <Textarea id="redemption-manual" name="manualCodes" rows={4} />
          </FormField>
          <div>
            <Button type="submit" variant="primary">创建并显示明文</Button>
          </div>
        </form>
      </Panel>

      <Panel title={data.canManageAll ? '全部批次' : '我创建的批次'}>
        {batches.length === 0 ? (
          <p className="text-sm text-fg-muted">还没有兑换批次。</p>
        ) : (
          <div className="divide-y divide-line-subtle">
            {batches.map((batch) => (
              <BatchRow key={String(batch._id)} batch={batch} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="停用码 / 撤销单人兑换来源">
        <div className="space-y-4">
          <form method="get" action="/manage/redemption-codes" className="flex flex-wrap items-end gap-2">
            <FormField label="查找用户权益" htmlFor="redemption-lookup-uid" className="min-w-40 flex-1">
              <Input id="redemption-lookup-uid" name="uid" defaultValue={lookupUid ? String(lookupUid) : ''} required />
            </FormField>
            <Button type="submit" variant="secondary">
              查找
            </Button>
          </form>
          {lookupUid ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>权益 ID</TableHead>
                  <TableHead>来源 ID</TableHead>
                  <TableHead>目标</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entitlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-fg-muted">
                      该用户没有有效兑换权益。
                    </TableCell>
                  </TableRow>
                ) : (
                  entitlements.map((row) => {
                    const choose = () => {
                      setRevokeUid(String(lookupUid));
                      setRevokeEntitlementId(row.entitlementId);
                    };
                    return (
                      <TableRow
                        key={row.entitlementId}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={choose}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          choose();
                        }}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.entitlementId}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.sourceId}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{row.target}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          ) : null}
          <div className="grid gap-5 md:grid-cols-2">
            <form
              method="post"
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                const codeId = String(new FormData(event.currentTarget).get('codeId') ?? '').trim();
                void confirmFormSubmit(event, '停用只阻止未来兑换，不追回已发权益。', {
                  title: codeId ? `停用「${codeId}」？` : '停用这个兑换码？',
                  confirmLabel: '停用',
                  destructive: true,
                });
              }}
            >
              <input type="hidden" name="operation" value="disable" />
              <FormField label="码 ID" htmlFor="redemption-disable-code" required hint="停用只阻止未来兑换，不追回已发权益。">
                <Input id="redemption-disable-code" name="codeId" required />
              </FormField>
              <div>
                <Button type="submit" variant="danger-soft">
                  停用
                </Button>
              </div>
            </form>
            <form
              method="post"
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                const entitlementId = String(new FormData(event.currentTarget).get('entitlementId') ?? '').trim();
                void confirmFormSubmit(event, '公开、用户组、课程和其他兑换仍然有效。', {
                  title: entitlementId ? `撤销「${entitlementId}」这一项兑换来源？` : '撤销这一项兑换来源？',
                  confirmLabel: '撤销该来源',
                  destructive: true,
                });
              }}
            >
              <input type="hidden" name="operation" value="revoke" />
              <FormField label="用户 UID" htmlFor="redemption-revoke-uid" required>
                <Input id="redemption-revoke-uid" name="uid" required value={revokeUid} onChange={(event) => setRevokeUid(event.target.value)} />
              </FormField>
              <FormField label="权益 ID" htmlFor="redemption-revoke-entitlement" required hint="只撤销这一项兑换来源，公开/用户组/课程和其他兑换仍然有效。">
                <Input
                  id="redemption-revoke-entitlement"
                  name="entitlementId"
                  required
                  value={revokeEntitlementId}
                  onChange={(event) => setRevokeEntitlementId(event.target.value)}
                />
              </FormField>
              <div>
                <Button type="submit" variant="danger-soft">
                  撤销该来源
                </Button>
              </div>
            </form>
          </div>
        </div>
      </Panel>
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
  const stats = batch.stats;
  const hints = Array.isArray(batch.hints) ? batch.hints : [];
  const batchId = String(batch._id);
  return (
    <div className="min-w-0 py-4 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs">{batchId}</p>
          <p className="min-w-0 break-words text-fg-muted">{batch.note || '无备注'}</p>
          <p className="break-words text-xs text-fg-subtle">{summary}</p>
          {stats ? (
            <p className="text-xs text-fg-subtle tabular">
              用量 {stats.used || 0} / 剩余 {stats.remaining || 0} · 有效 {stats.active || 0} · 停用 {stats.disabled || 0}
            </p>
          ) : null}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
          {open ? '收起编辑' : '编辑允许字段'}
        </Button>
      </div>
      {open ? (
        <form method="post" className="mt-3 grid gap-5 md:grid-cols-2">
          <input type="hidden" name="operation" value="edit" />
          <input type="hidden" name="batchId" value={batchId} />
          <FormField label="备注" htmlFor={`redemption-batch-note-${batchId}`} className="md:col-span-2">
            <Input id={`redemption-batch-note-${batchId}`} name="note" defaultValue={batch.note || ''} />
          </FormField>
          {frozen ? null : (
            <>
              <FormField label="目标类型" htmlFor={`redemption-batch-kind-${batchId}`}>
                <Input id={`redemption-batch-kind-${batchId}`} name="targetKind" defaultValue={batch.targetKind || 'problem_set'} />
              </FormField>
              <FormField label="目标 ID" htmlFor={`redemption-batch-target-${batchId}`}>
                <Input id={`redemption-batch-target-${batchId}`} name="targetId" defaultValue={String(batch.targetId || '')} />
              </FormField>
              <FormField label="允许用户组" htmlFor={`redemption-batch-groups-${batchId}`} className="md:col-span-2">
                <Input id={`redemption-batch-groups-${batchId}`} name="allowedGroupIds" />
              </FormField>
            </>
          )}
          <FormField label="新上限" htmlFor={`redemption-batch-max-${batchId}`}>
            <Input id={`redemption-batch-max-${batchId}`} name="maxUses" />
          </FormField>
          <FormField label="延长有效期" htmlFor={`redemption-batch-expires-${batchId}`}>
            <Input id={`redemption-batch-expires-${batchId}`} name="expiresAt" />
          </FormField>
          <div>
            <Button type="submit" size="sm" variant="secondary">
              保存
            </Button>
          </div>
        </form>
      ) : null}
      {hints.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {hints.map((hint) => (
            <li key={String(hint.codeId)} className="flex min-w-0 flex-wrap items-center justify-between gap-2 font-mono">
              <span className="min-w-0 break-all">
                {hint.hint} · {hint.status || 'active'} · {hint.usedCount || 0}/{hint.maxUses || 0}
              </span>
              <form
                method="post"
                onSubmit={(event) => {
                  const codeLabel = hint.hint || String(hint.codeId);
                  void confirmFormSubmit(event, '停用只阻止未来兑换，不追回已发权益。', {
                    title: `停用「${codeLabel}」？`,
                    confirmLabel: '停用',
                    destructive: true,
                  });
                }}
              >
                <input type="hidden" name="operation" value="disable" />
                <input type="hidden" name="codeId" value={String(hint.codeId)} />
                <Button type="submit" size="sm" variant="danger-soft" disabled={hint.status === 'disabled'}>
                  停用
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
