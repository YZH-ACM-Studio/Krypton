/**
 * krypton-rankboard admin pages.
 *
 *   admin_rankboard.html           → AdminRankBoardListPage
 *   admin_rankboard_awards.html    → AdminAwardTypesPage
 *   admin_rankboard_person.html    → AdminRankBoardPersonPage
 */
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Pencil, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { ModuleWorkspace, type ModuleWorkspaceNavItem } from '@/components/management/module-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchHydroResponse } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { uploadUserFile } from '@/lib/upload';

const RANKBOARD_WORKSPACE_NAV = [
  {
    key: 'people',
    label: '人员',
    href: '/admin/rankboard?section=people',
    templateNames: ['admin_rankboard.html', 'admin_rankboard_person.html'],
  },
  {
    key: 'import',
    label: '批量导入',
    href: '/admin/rankboard?section=import',
    templateNames: ['admin_rankboard.html'],
  },
  {
    key: 'awards',
    label: '奖项类型',
    href: '/admin/rankboard/awards',
    templateNames: ['admin_rankboard_awards.html'],
    manageOnly: true,
  },
  {
    key: 'settings',
    label: '计分设置',
    href: '/admin/rankboard?section=settings',
    templateNames: ['admin_rankboard.html'],
    manageOnly: true,
  },
] satisfies readonly (ModuleWorkspaceNavItem & { manageOnly?: boolean })[];

function rankboardWorkspaceNav(canManage: boolean): readonly ModuleWorkspaceNavItem[] {
  return canManage ? RANKBOARD_WORKSPACE_NAV : RANKBOARD_WORKSPACE_NAV.filter((item) => !item.manageOnly);
}

interface AwardType {
  _id: string;
  key: string;
  name: string;
  weight: number;
  useRankDecay: boolean;
  hidden: boolean;
  order: number;
  builtin: boolean;
}

/**
 * Field visibility per award category. Keyed off the award_type.key so the
 * preset names map predictably:
 *   ICPC / CCPC  — 3-person team contests: team name + teammates + 现场 + 学校排名
 *   天梯赛-团队   — team name + single 排名 (no teammates)
 *   天梯赛-个人   — single 排名 only
 *   PAT 系列     — single 排名 + 实际考试得分 (independent of ranking formula)
 *   其它         — single 排名 only
 */
function awardFields(typeKey: string) {
  const isICPC = /^icpc/i.test(typeKey);
  const isCCPC = /^ccpc/i.test(typeKey);
  const isLadderTeam = typeKey.startsWith('ladder_team');
  const isPAT = /^pat/i.test(typeKey);
  const hasTeam = isICPC || isCCPC || isLadderTeam;
  const hasTeammates = isICPC || isCCPC;
  const hasDualRank = isICPC || isCCPC;
  const hasSingleRank = !hasDualRank;
  const hasExamScore = isPAT;
  return { hasTeam, hasTeammates, hasDualRank, hasSingleRank, hasExamScore };
}

interface SearchResult {
  kind: 'user' | 'student';
  label: string;
  uid?: number;
  uname?: string;
  studentId?: string;
  realName?: string;
  boundUserId?: number | null;
}

/**
 * TeammatesPicker — multi-select with autocomplete over OJ users and
 * userbind students (by 学号 / 姓名), plus freetext for anyone outside
 * either system. Stored as `string[]` where each entry is the chosen
 * label (uname / "学号 姓名" / freetext).
 */
function TeammatesPicker({ value, onChange, placeholder }: { value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchHydroResponse(`/admin/rankboard/user-search?q=${encodeURIComponent(query.trim())}`, {
          headers: { Accept: 'application/json' },
        });
        const body = (await r.json()) as { results?: SearchResult[] };
        setResults(body.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setQuery('');
    setResults([]);
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const exactMatch = results.find((r) => r.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1.5 min-h-9">
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs">
            {v}
            <button type="button" onClick={() => remove(i)} className="rounded p-0.5 hover:bg-foreground/10" title="移除">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results[0]) add(results[0].label);
              else if (query.trim()) add(query.trim());
            } else if (e.key === 'Backspace' && !query && value.length > 0) {
              remove(value.length - 1);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none"
          placeholder={value.length === 0 ? placeholder || '搜索 OJ 用户名 / 学号 / 姓名，或直接输入' : ''}
        />
      </div>
      {open && (query || results.length > 0) && (
        <ScrollArea
          className="absolute left-0 right-0 z-10 mt-1 max-h-72 rounded-md border bg-popover shadow-lg"
          onMouseDown={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
        >
          {loading && <p className="px-3 py-1.5 text-xs text-muted-foreground">搜索中…</p>}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${i}`}
              type="button"
              onClick={() => add(r.label)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2 truncate">
                <Badge variant="outline" className="shrink-0 text-[9px]">
                  {r.kind === 'user' ? 'OJ' : '学生'}
                </Badge>
                <span className="truncate">{r.label}</span>
              </span>
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                {r.kind === 'user' && `UID ${r.uid}`}
                {r.kind === 'student' && (r.boundUserId ? `绑定 UID ${r.boundUserId}` : '未绑定')}
              </span>
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => add(query.trim())}
              className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Plus className="size-3" />
              <span>添加 "{query.trim()}"</span>
              <span className="ml-auto text-[10px] text-muted-foreground">自定义</span>
            </button>
          )}
          {!loading && !query.trim() && results.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">输入用户名 / 学号 / 姓名搜索</p>
          )}
        </ScrollArea>
      )}
    </div>
  );
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
    _id: string;
    studentId: string;
    realName: string;
    schoolId: string;
    schoolName: string;
    groupNames: string[];
    boundUserId: number | null;
  };
  user: { uname: string; nAccept: number } | null;
  totalScore: number;
  awardCount: number;
  rank: number;
  awardScores: number[];
}

/** TSV 批量导入结果摘要（krypton-rankboard `importAwardsBatch` 的返回）。 */
interface BatchImportReport {
  ok: number;
  notFound: string[];
  unknownType: string[];
  errors: { line: number; reason: string }[];
  createdStudents: number;
  batchId?: string;
}

/** 序列化后的导入批次行（`_id` / 时间戳在 bootstrap 数据中为字符串）。 */
interface ImportBatch {
  _id: string;
  createdAt: string;
  okCount: number;
  rowCount: number;
  createdStudents?: number;
  rolledBackAt?: string;
}

/** `/admin/rankboard/search` 返回的学生档案摘要。 */
interface StudentSummary {
  _id: string;
  studentId: string;
  realName: string;
  schoolId: string;
  boundUserId: number | null;
}

/* ─────────────────────────── People list ─────────────────────────── */

export function AdminRankBoardListPage() {
  const data = useBootstrap().page.data as {
    section: 'people' | 'import' | 'settings';
    rows?: AdminRow[];
    config?: { baseScore: number; decayFactor: number };
    report?: BatchImportReport;
    batches?: ImportBatch[];
    schools?: Array<{ _id: string; name: string }>;
    canImport: boolean;
    canManage: boolean;
  };
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  if (!data.canImport) throw new Error('Rankboard management capability is missing');
  if (data.section === 'people' && !Array.isArray(data.rows)) {
    throw new Error('Rankboard people data is missing');
  }
  if (data.section === 'import' && (!Array.isArray(data.batches) || !Array.isArray(data.schools))) {
    throw new Error('Rankboard import data is missing');
  }
  if (data.section === 'settings' && !data.config) {
    throw new Error('Rankboard settings data is missing');
  }
  const navItems = rankboardWorkspaceNav(data.canManage);

  const filtered = (data.rows || []).filter((r) => {
    if (!search) return true;
    const q = search.trim().toLowerCase();
    return `${r.student.studentId} ${r.student.realName}`.toLowerCase().includes(q);
  });

  const title = data.section === 'people' ? '人员管理' : data.section === 'import' ? '批量导入' : '计分设置';
  const description =
    data.section === 'people'
      ? '维护荣誉榜人员及其奖项记录。'
      : data.section === 'import'
        ? '批量录入奖项，并在同一处追踪或回滚导入批次。'
        : '调整荣誉榜的全局计分参数。';

  return (
    <ModuleWorkspace
      moduleTitle="荣誉管理"
      title={title}
      description={description}
      navItems={navItems}
      activeKey={data.section}
      bypassPrivGate
      actions={
        data.section === 'people' ? (
          <Button onClick={() => setAddOpen(true)} className="gap-1">
            <Plus className="size-3.5" />
            添加人员
          </Button>
        ) : data.section === 'import' ? (
          <Button onClick={() => setBatchOpen(true)} className="gap-1">
            <Upload className="size-3.5" />
            导入奖项
          </Button>
        ) : undefined
      }
    >
      {data.section === 'people' ? (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="搜索学号 / 姓名…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </CardContent>
          </Card>

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
                        暂无人员，使用页面主操作添加。
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => (
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
                            <TableAction href={`/admin/rankboard/people/${r.person._id}`} icon={Pencil}>
                              编辑
                            </TableAction>
                            {data.canManage ? (
                              <TableAction
                                formAction="/admin/rankboard"
                                hidden={{ operation: 'delete', personId: r.person._id }}
                                icon={Trash2}
                                variant="destructive"
                                confirm="确定从荣誉榜移除该人员？"
                              >
                                移除
                              </TableAction>
                            ) : null}
                          </TableActions>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {data.section === 'import' ? (
        <>
          {/* Defined below alongside the import-only supporting sections. */}
          {}
          {data.report ? <ImportReport report={data.report} /> : null}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">导入说明</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              使用 TSV 批量录入奖项；可选自动建立未匹配学生档案。每次提交都会形成可追踪、可回滚的独立批次。
            </CardContent>
          </Card>
          {}
          <ImportBatchesSection batches={data.batches || []} />
        </>
      ) : null}

      {data.section === 'settings' && data.config ? <RankboardSettingsSection config={data.config} /> : null}

      {addOpen && <AddPersonDialog onClose={() => setAddOpen(false)} />}
      {batchOpen && <BatchImportDialog onClose={() => setBatchOpen(false)} schools={data.schools || []} />}
    </ModuleWorkspace>
  );
}

function ImportReport({ report }: { report: BatchImportReport }) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">批量导入结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        <p>
          成功 {report.ok} 条{report.batchId ? `（批次 ${String(report.batchId).slice(-6)}，可在下方批次历史中回滚）` : ''}
        </p>
        {report.createdStudents > 0 && <p>自动建档 {report.createdStudents} 名学生</p>}
        {report.notFound?.length > 0 && <p>学号未找到：{report.notFound.join(', ')}</p>}
        {report.unknownType?.length > 0 && <p>未知奖项类型：{Array.from(new Set(report.unknownType)).join(', ')}</p>}
        {report.errors?.length > 0 && (
          <div>
            <p>{report.errors.length} 行未导入：</p>
            {report.errors.slice(0, 5).map((error, index) => (
              <p key={index} className="pl-4 text-muted-foreground">
                行 {error.line}: {error.reason}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 导入批次审计列表（PLAN §6）：每次 TSV 导入一条记录，可一键回滚。
 * 批次历史和导入主任务同区呈现，危险操作贴近对应批次。
 */
function ImportBatchesSection({ batches }: { batches: ImportBatch[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">批次历史</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {batches.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">还没有导入批次。</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">时间</TableHead>
                <TableHead className="w-24 text-right">成功/总行</TableHead>
                <TableHead className="w-20 text-right">建档</TableHead>
                <TableHead className="w-24 text-center">状态</TableHead>
                <TableHead className="w-24 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch._id} className={batch.rolledBackAt ? 'opacity-60' : undefined}>
                  <TableCell className="pl-5 font-mono text-xs">{String(batch.createdAt).replace('T', ' ').slice(0, 16)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {batch.okCount}/{batch.rowCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{batch.createdStudents || 0}</TableCell>
                  <TableCell className="text-center">
                    {batch.rolledBackAt ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        已回滚
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        生效中
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {!batch.rolledBackAt ? (
                      <TableAction
                        formAction="/admin/rankboard"
                        hidden={{ operation: 'rollbackBatch', batchId: batch._id }}
                        variant="destructive"
                        confirm={`回滚该批次？将从所有人员移除该批次导入的 ${batch.okCount} 条奖项（自动建档的学生档案保留）。`}
                      >
                        回滚
                      </TableAction>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const doSearch = async (text: string) => {
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchHydroResponse(`/admin/rankboard/search?q=${encodeURIComponent(text)}`, {
        headers: { Accept: 'application/json' },
      });
      const body = (await r.json()) as { students?: StudentSummary[] };
      setResults(body.students || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[520px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>添加人员到荣誉榜</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="按学号或姓名搜索学生档案…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                doSearch(e.target.value);
              }}
              autoFocus
            />
          </div>
          {loading && <p className="text-xs text-muted-foreground">搜索中…</p>}
          {results.length > 0 && (
            <ScrollArea className="max-h-72 rounded border">
              {results.map((s) => (
                <form key={s._id} method="post" action="/admin/rankboard" className="block">
                  <input type="hidden" name="operation" value="add" />
                  <input type="hidden" name="studentDocId" value={s._id} />
                  <button type="submit" className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-accent/40">
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
            </ScrollArea>
          )}
          {!loading && q && results.length === 0 && <p className="text-center text-sm text-muted-foreground">没有匹配的学生</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BatchImportDialog({ onClose, schools }: { onClose: () => void; schools: Array<{ _id: string; name: string }> }) {
  const [createMissing, setCreateMissing] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[640px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>批量导入奖项（TSV）</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/rankboard" className="flex flex-col">
          <input type="hidden" name="operation" value="batch" />
          <div className="space-y-3 p-5">
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">每行一条记录，TAB 分隔，字段顺序：</p>
              <code className="font-mono">学号 ⇥ 奖项key ⇥ 比赛名 ⇥ 日期 ⇥ liveRank ⇥ schoolRank ⇥ 队名 ⇥ 队友(逗号) ⇥ 姓名(可选)</code>
              <p className="mt-2">空行和 # 开头的行会被跳过。每次导入记录为一个批次，可整批回滚；相同内容重复导入会被拒绝。</p>
            </div>
            <textarea
              name="batchTsv"
              rows={12}
              spellCheck={false}
              required
              className="w-full rounded-md border bg-background p-3 font-mono text-xs"
              placeholder={'# 示例\n2023001\ticpc_gold\tICPC 北京站\t2025-04\t12\t1\t红蓝队\t张三,李四\t王五'}
            />
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                未匹配学号自动建档（需 TSV 带姓名列，毕业学长录奖用）
              </label>
              {createMissing ? (
                <>
                  <input type="hidden" name="createMissing" value="true" />
                  <SimpleSelect
                    name="schoolId"
                    required
                    defaultValue=""
                    placeholder="建档到哪个学校"
                    options={[{ value: '', label: '— 选择学校 —' }, ...schools.map((s) => ({ value: s._id, label: s.name }))]}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    带姓名且学号不存在的行会先在该学校建学生档案（入学年按学号前两位派生），再录入奖项。默认关闭，防手滑污染学生库。
                  </p>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
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

function RankboardSettingsSection({ config }: { config: { baseScore: number; decayFactor: number } }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">计分参数</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="post" action="/admin/rankboard" className="max-w-xl space-y-5">
          <input type="hidden" name="operation" value="config" />
          <div className="space-y-4">
            <FormField label="基础分（baseScore）" htmlFor="cfg-base">
              <Input id="cfg-base" name="baseScore" type="number" step="any" defaultValue={config.baseScore} />
              <p className="mt-1 text-[11px] text-muted-foreground">所有奖项得分的乘数。默认 100。</p>
            </FormField>
            <FormField label="排名衰减系数（decayFactor）" htmlFor="cfg-decay">
              <Input id="cfg-decay" name="decayFactor" type="number" step="any" min="0" max="1" defaultValue={config.decayFactor} />
              <p className="mt-1 text-[11px] text-muted-foreground">对启用了 useRankDecay 的奖项：weight × decayFactor^(liveRank-1)。默认 0.5。</p>
            </FormField>
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button type="submit">保存</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Award types ─────────────────────────── */

export function AdminAwardTypesPage() {
  const data = useBootstrap().page.data as {
    types: AwardType[];
    canImport: boolean;
    canManage: boolean;
  };
  const [editing, setEditing] = useState<AwardType | null>(null);
  const [creating, setCreating] = useState(false);
  if (!data.canManage) throw new Error('Rankboard structure capability is missing');
  return (
    <ModuleWorkspace
      moduleTitle="荣誉管理"
      title="奖项类型"
      description="维护奖项分类、权重和排名衰减规则。"
      navItems={rankboardWorkspaceNav(data.canManage)}
      activeKey="awards"
      bypassPrivGate
      actions={
        <Button onClick={() => setCreating(true)} className="gap-1">
          <Plus className="size-3.5" />
          新增奖项类型
        </Button>
      }
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
                    {t.useRankDecay ? (
                      <Badge variant="secondary" className="text-[10px]">
                        启用
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{t.order}</TableCell>
                  <TableCell className="text-center">
                    {t.hidden ? (
                      <Badge variant="outline" className="text-[10px]">
                        隐藏
                      </Badge>
                    ) : t.builtin ? (
                      <Badge variant="secondary" className="text-[10px]">
                        内建
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        自定义
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5">
                    <TableActions>
                      <TableAction onClick={() => setEditing(t)} icon={Pencil}>
                        编辑
                      </TableAction>
                      <TableAction
                        formAction="/admin/rankboard/awards"
                        hidden={{ operation: 'delete', key: t.key }}
                        icon={Trash2}
                        variant="destructive"
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
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </ModuleWorkspace>
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
        <DialogHeader>
          <DialogTitle>{isNew ? '新增奖项类型' : '编辑奖项类型'}</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/rankboard/awards" className="flex flex-col">
          <input type="hidden" name="operation" value="upsert" />
          {!isNew && <input type="hidden" name="key" value={key} />}
          <div className="space-y-4 p-5">
            <FormRow columns={2}>
              <FormField label="Key" required htmlFor="aw-key">
                <Input
                  id="aw-key"
                  name="key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={!isNew}
                  required
                  placeholder="如 icpc_gold"
                />
              </FormField>
              <FormField label="显示名称" required htmlFor="aw-name">
                <Input id="aw-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="如 ICPC-金奖" />
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label="权重" required htmlFor="aw-weight">
                <Input
                  id="aw-weight"
                  name="weight"
                  type="number"
                  step="any"
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  required
                />
              </FormField>
              <FormField label="排序" htmlFor="aw-order">
                <Input id="aw-order" name="order" type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} />
              </FormField>
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="useRankDecay" value="true" checked={useRankDecay} onChange={(e) => setUseRankDecay(e.target.checked)} />
              启用排名衰减（weight × decayFactor^(liveRank-1)）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="hidden" value="true" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              隐藏（已存在的奖项仍计分，但新建时不显示）
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Person detail editor ─────────────────────────── */

export function AdminRankBoardPersonPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    person: PersonRecord;
    student: { _id: string; studentId: string; realName: string } | null;
    types: AwardType[];
    canImport: boolean;
    canManage: boolean;
  };

  const [awards, setAwards] = useState<Award[]>(data.person.awards || []);
  const [employmentStatus, setEmploymentStatus] = useState(data.person.employmentStatus || '');
  if (!data.canImport) throw new Error('Rankboard management capability is missing');

  const updateAward = (idx: number, patch: Partial<Award>) => {
    setAwards((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };
  const removeAward = (idx: number) => setAwards((prev) => prev.filter((_, i) => i !== idx));
  const addAward = () => setAwards((prev) => [...prev, { type: data.types[0]?.key || '', imageUrls: [] }]);

  const uploadImage = async (file: File, idx: number) => {
    // FilesHandler 要求 operation=upload_file + filename，且不返回 JSON——
    // URL 由客户端按 /file/{uid}/{filename} 约定拼出（见 lib/upload.ts）。
    // 旧实现（裸 POST file 字段 + 解析 JSON）从未成功过。
    let url: string;
    try {
      url = await uploadUserFile(file, bs.user.id);
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : '上传失败');
      return;
    }
    setAwards((prev) => prev.map((a, i) => (i === idx ? { ...a, imageUrls: [...(a.imageUrls || []), url] } : a)));
  };

  return (
    <ModuleWorkspace
      moduleTitle="荣誉管理"
      title={`编辑：${data.student?.realName || '（未找到学生档案）'}`}
      description={data.student ? `${data.student.studentId}` : ''}
      navItems={rankboardWorkspaceNav(data.canManage)}
      activeKey="people"
      bypassPrivGate
    >
      <form method="post" action={`/admin/rankboard/people/${data.person._id}`} className="space-y-4">
        <input type="hidden" name="operation" value="save" />
        <input type="hidden" name="awards" value={JSON.stringify(awards)} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">基本</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField label="就业去向（可选）" htmlFor="emp">
              <Input
                id="emp"
                name="employmentStatus"
                value={employmentStatus}
                onChange={(e) => setEmploymentStatus(e.target.value)}
                placeholder="如 某公司 / 保研某校 / 出国"
              />
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
              <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无奖项，点击右上角新增。</CardContent>
            </Card>
          )}
          {awards.map((award, idx) => {
            const fields = awardFields(award.type);
            return (
              <Card key={idx}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <FormField label="奖项类型">
                        <SimpleSelect
                          value={award.type}
                          onValueChange={(v) => updateAward(idx, { type: v })}
                          options={data.types.filter((t) => !t.hidden || t.key === award.type).map((t) => ({ value: t.key, label: t.name }))}
                        />
                      </FormField>
                      <FormField label="比赛 / 场次">
                        <Input value={award.contest || ''} onChange={(e) => updateAward(idx, { contest: e.target.value })} />
                      </FormField>
                      <FormField label="日期">
                        <Input value={award.date || ''} onChange={(e) => updateAward(idx, { date: e.target.value })} placeholder="2025-04" />
                      </FormField>
                      {fields.hasTeam && (
                        <FormField label="队名">
                          <Input value={award.team || ''} onChange={(e) => updateAward(idx, { team: e.target.value })} />
                        </FormField>
                      )}
                      {fields.hasDualRank && (
                        <>
                          <FormField label="现场排名">
                            <Input
                              type="number"
                              value={award.liveRank ?? ''}
                              onChange={(e) => updateAward(idx, { liveRank: e.target.value ? Number(e.target.value) : undefined })}
                            />
                          </FormField>
                          <FormField label="学校排名">
                            <Input
                              type="number"
                              value={award.schoolRank ?? ''}
                              onChange={(e) => updateAward(idx, { schoolRank: e.target.value ? Number(e.target.value) : undefined })}
                            />
                          </FormField>
                        </>
                      )}
                      {fields.hasSingleRank && (
                        <FormField label="排名">
                          <Input
                            type="number"
                            value={award.liveRank ?? ''}
                            onChange={(e) => updateAward(idx, { liveRank: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </FormField>
                      )}
                      {fields.hasTeammates && (
                        <FormField label="队友" className="sm:col-span-2">
                          <TeammatesPicker value={award.teammates || []} onChange={(next) => updateAward(idx, { teammates: next })} />
                        </FormField>
                      )}
                      {fields.hasExamScore && (
                        <FormField label="实际考试得分">
                          <Input
                            type="number"
                            step="any"
                            value={award.score ?? ''}
                            onChange={(e) => updateAward(idx, { score: e.target.value ? Number(e.target.value) : undefined })}
                            placeholder="如 PAT 98 分"
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">独立于 OJ ranking 得分，仅用于展示。</p>
                        </FormField>
                      )}
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
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.currentTarget.files?.[0];
                            if (f) uploadImage(f, idx);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                    {award.imageUrls && award.imageUrls.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {award.imageUrls.map((u, j) => {
                          const isCover = j === (award.coverIndex ?? 0);
                          return (
                            <div key={j} className="group relative size-20 overflow-hidden rounded border bg-muted">
                              <img src={u} alt="" className="size-full object-cover" />
                              <div className="absolute inset-0 flex flex-col justify-end gap-1 bg-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => updateAward(idx, { coverIndex: j })}
                                  className="rounded bg-white/90 px-1 text-[10px] text-black hover:bg-white"
                                >
                                  {isCover ? '✓封面' : '设封面'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAward(idx, {
                                      imageUrls: (award.imageUrls || []).filter((_, k) => k !== j),
                                      coverIndex: 0,
                                    })
                                  }
                                  className="rounded bg-red-600/90 px-1 text-[10px] text-white hover:bg-red-600"
                                >
                                  删除
                                </button>
                              </div>
                              {isCover && <span className="absolute left-1 top-1 rounded bg-amber-400/90 px-1 text-[9px] text-amber-950">封面</span>}
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
            <a href="/admin/rankboard?section=people">返回列表</a>
          </Button>
          <Button type="submit" className="gap-1">
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </form>
    </ModuleWorkspace>
  );
}
