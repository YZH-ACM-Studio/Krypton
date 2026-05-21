/**
 * krypton-rankboard admin pages.
 *
 *   admin_rankboard.html           → AdminRankBoardListPage
 *   admin_rankboard_awards.html    → AdminAwardTypesPage
 *   admin_rankboard_person.html    → AdminRankBoardPersonPage
 */
import { useMemo, useState } from 'react';
import {
  Award as AwardIcon, FileSpreadsheet, Image as ImageIcon, Pencil, Plus, Save,
  Search, Settings, Star, Trash2, Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { AdminPage } from '@/components/admin/admin-page';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { cn } from '@/lib/cn';

// Admin nav registration for rankboard section.
registerAdminNavSection({
  key: 'rankboard',
  label: '荣誉榜',
  order: 36,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    { key: 'people', label: '人员', href: '/admin/rankboard', icon: AwardIcon, templateNames: ['admin_rankboard.html', 'admin_rankboard_person.html'], requiredPriv: PRIV.PRIV_EDIT_SYSTEM },
    { key: 'awards', label: '奖项类型', href: '/admin/rankboard/awards', icon: Star, templateNames: ['admin_rankboard_awards.html'], requiredPriv: PRIV.PRIV_EDIT_SYSTEM },
  ],
});

interface AwardType {
  _id: string; key: string; name: string; weight: number;
  useRankDecay: boolean; hidden: boolean; order: number; builtin: boolean;
}

interface Award {
  type: string;
  contest?: string;
  date?: string;
  team?: string;
  liveRank?: number;
  schoolRank?: number;
  score?: number;
  teammates?: string[];
  imageUrls?: string[];
  coverIndex?: number;
}

interface PersonRecord {
  _id: string;
  studentDocId: string;
  awards: Award[];
  employmentStatus?: string;
}

interface AdminRow {
  person: PersonRecord;
  student: {
    _id: string; studentId: string; realName: string; schoolId: string;
    schoolName: string; groupNames: string[]; boundUserId: number | null;
  };
  user: { uname: string; nAccept: number } | null;
  totalScore: number;
  awardCount: number;
  rank: number;
  awardScores: number[];
}

/* ─────────────────────────── People list ─────────────────────────── */

export function AdminRankBoardListPage() {
  const data = useBootstrap().page.data as {
    rows: AdminRow[];
    config: { baseScore: number; decayFactor: number };
    report?: any;
  };
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const filtered = data.rows.filter((r) => {
    if (!search) return true;
    const q = search.trim().toLowerCase();
    return `${r.student.studentId} ${r.student.realName}`.toLowerCase().includes(q);
  });

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <AwardIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">荣誉榜人员</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setConfigOpen(true)} className="gap-1">
            <Settings className="size-3.5" />
            计分参数
          </Button>
          <Button variant="outline" onClick={() => setBatchOpen(true)} className="gap-1">
            <FileSpreadsheet className="size-3.5" />
            批量导入奖项
          </Button>
          <Button onClick={() => setAddOpen(true)} className="gap-1">
            <Plus className="size-3.5" />
            添加人员
          </Button>
        </div>
      )}
    >
      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8" placeholder="搜索学号 / 姓名…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {data.report && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">批量导入结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p>✅ 成功 {data.report.ok} 条</p>
            {data.report.notFound?.length > 0 && (
              <p>⚠️ 学号未找到：{data.report.notFound.join(', ')}</p>
            )}
            {data.report.unknownType?.length > 0 && (
              <p>⚠️ 未知奖项类型：{Array.from(new Set(data.report.unknownType)).join(', ')}</p>
            )}
            {data.report.errors?.length > 0 && (
              <p>❌ {data.report.errors.length} 行解析失败</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 pl-5">排名</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>学校 / 班级</TableHead>
                <TableHead className="w-20 text-right">总分</TableHead>
                <TableHead className="w-20 text-right">奖项数</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    暂无人员，点击右上角添加。
                  </TableCell>
                </TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.person._id}>
                  <TableCell className="pl-5 font-mono text-sm">#{r.rank}</TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{r.student.realName}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{r.student.studentId}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.student.schoolName}
                    {r.student.groupNames[0] && ` · ${r.student.groupNames[0]}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.totalScore.toFixed(1)}</TableCell>
                  <TableCell className="text-right text-sm">{r.awardCount}</TableCell>
                  <TableCell className="pr-5">
                    <TableActions>
                      <TableAction href={`/admin/rankboard/people/${r.person._id}`} icon={Pencil}>编辑</TableAction>
                      <TableAction
                        formAction="/admin/rankboard"
                        hidden={{ operation: 'delete', personId: r.person._id }}
                        icon={Trash2}
                        variant="destructive"
                        confirm="确定从荣誉榜移除该人员？"
                      >
                        移除
                      </TableAction>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {addOpen && <AddPersonDialog onClose={() => setAddOpen(false)} />}
      {batchOpen && <BatchImportDialog onClose={() => setBatchOpen(false)} />}
      {configOpen && <ConfigDialog config={data.config} onClose={() => setConfigOpen(false)} />}
    </AdminPage>
  );
}

function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{
    _id: string; studentId: string; realName: string; schoolId: string; boundUserId: number | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  const doSearch = async (text: string) => {
    if (!text.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/admin/rankboard/search?q=${encodeURIComponent(text)}`, {
        headers: { Accept: 'application/json' },
      });
      const body = await r.json();
      setResults(body.students || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[520px]" onClose={onClose}>
        <DialogHeader><DialogTitle>添加人员到荣誉榜</DialogTitle></DialogHeader>
        <div className="space-y-4 p-5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8" placeholder="按学号或姓名搜索学生档案…"
              value={q} onChange={(e) => { setQ(e.target.value); doSearch(e.target.value); }}
              autoFocus
            />
          </div>
          {loading && <p className="text-xs text-muted-foreground">搜索中…</p>}
          {results.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded border">
              {results.map((s) => (
                <form key={s._id} method="post" action="/admin/rankboard" className="block">
                  <input type="hidden" name="operation" value="add" />
                  <input type="hidden" name="studentDocId" value={s._id} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  >
                    <div>
                      <p className="text-sm font-medium">{s.realName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{s.studentId}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {s.boundUserId ? `UID ${s.boundUserId}` : '未绑定'}
                    </Badge>
                  </button>
                </form>
              ))}
            </div>
          )}
          {!loading && q && results.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">没有匹配的学生</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BatchImportDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[640px]" onClose={onClose}>
        <DialogHeader><DialogTitle>批量导入奖项（TSV）</DialogTitle></DialogHeader>
        <form method="post" action="/admin/rankboard" className="flex flex-col">
          <input type="hidden" name="operation" value="batch" />
          <div className="space-y-3 p-5">
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">每行一条记录，TAB 分隔，字段顺序：</p>
              <code className="font-mono">学号 ⇥ 奖项key ⇥ 比赛名 ⇥ 日期 ⇥ liveRank ⇥ schoolRank ⇥ 队名 ⇥ 队友(逗号)</code>
              <p className="mt-2">空行和 # 开头的行会被跳过。学号必须在用户绑定库中存在。</p>
            </div>
            <textarea
              name="batchTsv" rows={14} spellCheck={false} required
              className="w-full rounded-md border bg-background p-3 font-mono text-xs"
              placeholder={'# 示例\n2023001\ticpc_gold\tICPC 北京站\t2025-04\t12\t1\t红蓝队\t张三,李四'}
            />
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit" className="gap-1">
              <Upload className="size-3.5" />
              导入
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({
  config, onClose,
}: { config: { baseScore: number; decayFactor: number }; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[440px]" onClose={onClose}>
        <DialogHeader><DialogTitle>计分参数</DialogTitle></DialogHeader>
        <form method="post" action="/admin/rankboard" className="flex flex-col">
          <input type="hidden" name="operation" value="config" />
          <div className="space-y-4 p-5">
            <FormField label="基础分（baseScore）" htmlFor="cfg-base">
              <Input id="cfg-base" name="baseScore" type="number" step="any" defaultValue={config.baseScore} />
              <p className="mt-1 text-[11px] text-muted-foreground">所有奖项得分的乘数。默认 100。</p>
            </FormField>
            <FormField label="排名衰减系数（decayFactor）" htmlFor="cfg-decay">
              <Input id="cfg-decay" name="decayFactor" type="number" step="any" min="0" max="1" defaultValue={config.decayFactor} />
              <p className="mt-1 text-[11px] text-muted-foreground">对启用了 useRankDecay 的奖项：weight × decayFactor^(liveRank-1)。默认 0.5。</p>
            </FormField>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Award types ─────────────────────────── */

export function AdminAwardTypesPage() {
  const data = useBootstrap().page.data as { types: AwardType[] };
  const [editing, setEditing] = useState<AwardType | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <Star className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">奖项类型</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={(
        <Button onClick={() => setCreating(true)} className="gap-1">
          <Plus className="size-3.5" />
          新增奖项类型
        </Button>
      )}
    >
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">名称</TableHead>
                <TableHead className="w-32 font-mono text-xs">key</TableHead>
                <TableHead className="w-20 text-right">权重</TableHead>
                <TableHead className="w-24 text-center">排名衰减</TableHead>
                <TableHead className="w-20 text-right">顺序</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.types.map((t) => (
                <TableRow key={t._id} className={cn(t.hidden && 'opacity-60')}>
                  <TableCell className="pl-5 text-sm font-medium">{t.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.key}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{t.weight.toFixed(2)}</TableCell>
                  <TableCell className="text-center">
                    {t.useRankDecay
                      ? <Badge variant="secondary" className="text-[10px]">启用</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{t.order}</TableCell>
                  <TableCell className="text-center">
                    {t.hidden
                      ? <Badge variant="outline" className="text-[10px]">隐藏</Badge>
                      : t.builtin
                      ? <Badge variant="secondary" className="text-[10px]">内建</Badge>
                      : <Badge variant="outline" className="text-[10px]">自定义</Badge>}
                  </TableCell>
                  <TableCell className="pr-5">
                    <TableActions>
                      <TableAction onClick={() => setEditing(t)} icon={Pencil}>编辑</TableAction>
                      <TableAction
                        formAction="/admin/rankboard/awards"
                        hidden={{ operation: 'delete', key: t.key }}
                        icon={Trash2} variant="destructive"
                        confirm="确定删除？被引用的奖项类型会改为隐藏。"
                      >
                        删除
                      </TableAction>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {(creating || editing) && (
        <AwardTypeDialog
          type={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </AdminPage>
  );
}

function AwardTypeDialog({ type, onClose }: { type: AwardType | null; onClose: () => void }) {
  const isNew = !type;
  const [key, setKey] = useState(type?.key || '');
  const [name, setName] = useState(type?.name || '');
  const [weight, setWeight] = useState(type?.weight ?? 1.0);
  const [useRankDecay, setUseRankDecay] = useState(!!type?.useRankDecay);
  const [order, setOrder] = useState(type?.order || 100);
  const [hidden, setHidden] = useState(!!type?.hidden);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[520px]" onClose={onClose}>
        <DialogHeader><DialogTitle>{isNew ? '新增奖项类型' : '编辑奖项类型'}</DialogTitle></DialogHeader>
        <form method="post" action="/admin/rankboard/awards" className="flex flex-col">
          <input type="hidden" name="operation" value="upsert" />
          <div className="space-y-4 p-5">
            <FormRow columns={2}>
              <FormField label="Key" required htmlFor="aw-key">
                <Input id="aw-key" name="key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!isNew} required placeholder="如 icpc_gold" />
              </FormField>
              <FormField label="显示名称" required htmlFor="aw-name">
                <Input id="aw-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="如 ICPC-金奖" />
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label="权重" required htmlFor="aw-weight">
                <Input id="aw-weight" name="weight" type="number" step="any" value={weight} onChange={(e) => setWeight(Number(e.target.value))} required />
              </FormField>
              <FormField label="排序" htmlFor="aw-order">
                <Input id="aw-order" name="order" type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} />
              </FormField>
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="useRankDecay" value="true" checked={useRankDecay} onChange={(e) => setUseRankDecay(e.target.checked)} className="size-4 rounded border accent-primary" />
              启用排名衰减（weight × decayFactor^(liveRank-1)）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="hidden" value="true" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="size-4 rounded border accent-primary" />
              隐藏（已存在的奖项仍计分，但新建时不显示）
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Person detail editor ─────────────────────────── */

export function AdminRankBoardPersonPage() {
  const data = useBootstrap().page.data as {
    person: PersonRecord;
    student: { _id: string; studentId: string; realName: string } | null;
    types: AwardType[];
  };

  const [awards, setAwards] = useState<Award[]>(data.person.awards || []);
  const [employmentStatus, setEmploymentStatus] = useState(data.person.employmentStatus || '');
  const typeMap = useMemo(() => new Map(data.types.map((t) => [t.key, t])), [data.types]);

  const updateAward = (idx: number, patch: Partial<Award>) => {
    setAwards((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };
  const removeAward = (idx: number) => setAwards((prev) => prev.filter((_, i) => i !== idx));
  const addAward = () => setAwards((prev) => [...prev, { type: data.types[0]?.key || '', imageUrls: [] }]);

  const uploadImage = async (file: File, idx: number) => {
    const form = new FormData();
    form.append('file', file);
    // Use Hydro's home file storage for now — accessible to the current user.
    const res = await fetch('/file', { method: 'POST', body: form });
    if (!res.ok) { alert('上传失败'); return; }
    const body = await res.json().catch(() => ({}));
    const url = body.url || body.path || '';
    if (!url) { alert('未拿到 URL'); return; }
    setAwards((prev) => prev.map((a, i) => (i === idx
      ? { ...a, imageUrls: [...(a.imageUrls || []), url] }
      : a)));
  };

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <AwardIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">
            编辑：{data.student?.realName || '（未找到学生档案）'}
          </h1>
        </div>
      )}
      description={data.student ? `${data.student.studentId}` : ''}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
    >
      <form method="post" action={`/admin/rankboard/people/${data.person._id}`} className="space-y-4">
        <input type="hidden" name="operation" value="save" />
        <input type="hidden" name="awards" value={JSON.stringify(awards)} />

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">基本</CardTitle></CardHeader>
          <CardContent>
            <FormField label="就业去向（可选）" htmlFor="emp">
              <Input id="emp" name="employmentStatus" value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)} placeholder="如 某公司 / 保研某校 / 出国" />
            </FormField>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">奖项（{awards.length}）</h2>
          <Button type="button" variant="outline" onClick={addAward} className="gap-1">
            <Plus className="size-3.5" />
            新增奖项
          </Button>
        </div>

        <div className="space-y-3">
          {awards.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                暂无奖项，点击右上角新增。
              </CardContent>
            </Card>
          )}
          {awards.map((award, idx) => {
            const type = typeMap.get(award.type);
            const cover = award.imageUrls?.[award.coverIndex ?? 0];
            return (
              <Card key={idx}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <FormField label="奖项类型">
                        <select
                          value={award.type}
                          onChange={(e) => updateAward(idx, { type: e.target.value })}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {data.types.filter((t) => !t.hidden || t.key === award.type).map((t) => (
                            <option key={t.key} value={t.key}>{t.name}</option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="比赛 / 场次">
                        <Input value={award.contest || ''} onChange={(e) => updateAward(idx, { contest: e.target.value })} />
                      </FormField>
                      <FormField label="日期">
                        <Input value={award.date || ''} onChange={(e) => updateAward(idx, { date: e.target.value })} placeholder="2025-04" />
                      </FormField>
                      <FormField label="队名">
                        <Input value={award.team || ''} onChange={(e) => updateAward(idx, { team: e.target.value })} />
                      </FormField>
                      <FormField label="现场排名（liveRank）">
                        <Input type="number" value={award.liveRank ?? ''} onChange={(e) => updateAward(idx, { liveRank: e.target.value ? Number(e.target.value) : undefined })} />
                      </FormField>
                      <FormField label="校内排名（schoolRank）">
                        <Input type="number" value={award.schoolRank ?? ''} onChange={(e) => updateAward(idx, { schoolRank: e.target.value ? Number(e.target.value) : undefined })} />
                      </FormField>
                      <FormField label="队友（逗号分隔）">
                        <Input
                          value={(award.teammates || []).join(', ')}
                          onChange={(e) => updateAward(idx, {
                            teammates: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                          })}
                        />
                      </FormField>
                      <FormField label="自定义得分（覆盖公式，留空走公式）">
                        <Input type="number" step="any" value={award.score ?? ''} onChange={(e) => updateAward(idx, { score: e.target.value ? Number(e.target.value) : undefined })} />
                      </FormField>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeAward(idx)} title="移除奖项">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">团队照片（首张作为封面）</p>
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-muted">
                        <Upload className="size-3" />
                        上传
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const f = e.currentTarget.files?.[0];
                            if (f) uploadImage(f, idx);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                    {(award.imageUrls && award.imageUrls.length > 0) ? (
                      <div className="flex flex-wrap gap-2">
                        {award.imageUrls.map((u, j) => {
                          const isCover = j === (award.coverIndex ?? 0);
                          return (
                            <div key={j} className="group relative size-20 overflow-hidden rounded border bg-muted">
                              <img src={u} alt="" className="size-full object-cover" />
                              <div className="absolute inset-0 flex flex-col justify-end gap-1 bg-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                                <button type="button"
                                  onClick={() => updateAward(idx, { coverIndex: j })}
                                  className="rounded bg-white/90 px-1 text-[10px] text-black hover:bg-white"
                                >
                                  {isCover ? '✓封面' : '设封面'}
                                </button>
                                <button type="button"
                                  onClick={() => updateAward(idx, {
                                    imageUrls: (award.imageUrls || []).filter((_, k) => k !== j),
                                    coverIndex: 0,
                                  })}
                                  className="rounded bg-red-600/90 px-1 text-[10px] text-white hover:bg-red-600"
                                >
                                  删除
                                </button>
                              </div>
                              {isCover && (
                                <span className="absolute left-1 top-1 rounded bg-amber-400/90 px-1 text-[9px] text-amber-950">封面</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-20 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                        <ImageIcon className="mr-1 size-3.5" />
                        无照片
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" asChild>
            <a href="/admin/rankboard">返回列表</a>
          </Button>
          <Button type="submit" className="gap-1">
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </form>
    </AdminPage>
  );
}
