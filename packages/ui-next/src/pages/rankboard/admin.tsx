/**
 * krypton-rankboard admin pages.
 *
 *   admin_rankboard.html           → AdminRankBoardListPage
 *   admin_rankboard_awards.html    → AdminAwardTypesPage
 *   admin_rankboard_person.html    → AdminRankBoardPersonPage
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { ModuleWorkspace, type ModuleWorkspaceNavItem } from '@/components/management/module-workspace';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { alertDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Code } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormRow } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Input, SearchInput } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { calculateAnchoredPopoverBox, type AnchoredPopoverBox } from '@/components/ui/tooltip-position';
import { fetchHydroResponse } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { uploadUserFile } from '@/lib/upload';
import {
  awardHasEditableExamScore,
  isLadderIndividualKey,
  medalMetal,
  MEDAL_TONE,
  rankboardCollege,
} from './award-display';

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
 *   天梯赛-个人   — single 排名 + 天梯赛得分 (independent of ranking formula)
 *   PAT 系列     — single 排名 + 实际考试得分 (independent of ranking formula)
 *   其它         — single 排名 only
 */
function awardFields(typeKey: string) {
  const isICPC = /^icpc/i.test(typeKey);
  const isCCPC = /^ccpc/i.test(typeKey);
  const isLadderTeam = typeKey.startsWith('ladder_team');
  const hasTeam = isICPC || isCCPC || isLadderTeam;
  const hasTeammates = isICPC || isCCPC;
  const hasDualRank = isICPC || isCCPC;
  const hasSingleRank = !hasDualRank;
  const hasExamScore = awardHasEditableExamScore(typeKey);
  const examScoreIsLadder = isLadderIndividualKey(typeKey);
  return { hasTeam, hasTeammates, hasDualRank, hasSingleRank, hasExamScore, examScoreIsLadder };
}

/** Gold / silver / bronze follow award-display MEDAL_TONE. Other types stay plain. */
function AwardTypeName({ typeKey, name }: { typeKey: string; name: string }) {
  const metal = medalMetal({ key: typeKey, name });
  const label = metal === null ? (
    <span className="block min-w-0 truncate text-sm font-medium text-fg">{name}</span>
  ) : (
    <Badge tone={MEDAL_TONE[metal]} variant="soft" size="sm" className="flex w-full min-w-0 max-w-full overflow-hidden">
      <span className="min-w-0 truncate">{name}</span>
    </Badge>
  );
  return <div className="w-full min-w-0 overflow-hidden">{label}</div>;
}

/** Keep the same photo as the cover. Deleting the cover itself falls back to the first remaining photo. */
function nextCoverIndex(coverIndex: number | undefined, removed: number): number {
  const cover = coverIndex ?? 0;
  if (removed === cover) return 0;
  if (removed < cover) return cover - 1;
  return cover;
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

function readSearchResults(body: unknown): SearchResult[] | null {
  if (typeof body !== 'object' || body === null || !('results' in body)) return null;
  const results = (body as { results: unknown }).results;
  return Array.isArray(results) ? results as SearchResult[] : null;
}

/** Previous menu cap was 18rem. The portaled layer can use it; the panel no longer clips it. */
const TEAMMATE_MENU_MAX_PX = 288;

function teammateMenuStyle(box: AnchoredPopoverBox): CSSProperties {
  return {
    position: 'fixed',
    left: box.left,
    width: box.width,
    maxHeight: Math.min(box.maxHeight, TEAMMATE_MENU_MAX_PX),
    top: box.top,
    bottom: box.bottom,
  };
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
  const [menuBox, setMenuBox] = useState<AnchoredPopoverBox | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const queryText = query.trim();
    if (!queryText) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResults([]);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetchHydroResponse(`/admin/rankboard/user-search?q=${encodeURIComponent(queryText)}`, {
            headers: { Accept: 'application/json' },
          });
          const body: unknown = await r.json();
          if (cancelled) return;
          const next = r.ok ? readSearchResults(body) : null;
          setResults(next ?? []);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
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
  const menuOpen = open && (query.length > 0 || results.length > 0);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuBox(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      setMenuBox(calculateAnchoredPopoverBox(anchor.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [menuOpen]);

  const menu = menuOpen && menuBox && typeof document !== 'undefined'
    ? createPortal(
      <ScrollArea
        viewportLayout="block"
        className="z-50 rounded-lg border border-line bg-surface-raised shadow-pop"
        style={teammateMenuStyle(menuBox)}
        onMouseDown={(event) => {
          event.preventDefault();
          if (blurTimer.current) clearTimeout(blurTimer.current);
        }}
      >
        <div className="min-w-0 p-1">
          {loading && <p className="px-3 py-1.5 text-xs text-fg-subtle">搜索中…</p>}
          {results.map((r, i) => (
            <Button
              key={`${r.kind}-${i}`}
              type="button"
              variant="ghost"
              className="w-full min-w-0 justify-between overflow-hidden"
              onClick={() => add(r.label)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <Badge variant="outline" size="sm" className="shrink-0">
                  {r.kind === 'user' ? 'OJ' : '学生'}
                </Badge>
                <span className="min-w-0 truncate">{r.label}</span>
              </span>
              <span className="ml-2 shrink-0 text-2xs text-fg-subtle">
                {r.kind === 'user' && `UID ${r.uid}`}
                {r.kind === 'student' && (r.boundUserId ? `绑定 UID ${r.boundUserId}` : '未绑定')}
              </span>
            </Button>
          ))}
          {query.trim() && !exactMatch && (
            <Button
              type="button"
              variant="ghost"
              className="w-full min-w-0 justify-start overflow-hidden border-t border-line-subtle"
              onClick={() => add(query.trim())}
            >
              <Plus />
              <span className="min-w-0 truncate">添加 "{query.trim()}"</span>
              <span className="ml-auto shrink-0 text-2xs text-fg-subtle">自定义</span>
            </Button>
          )}
          {!loading && !query.trim() && results.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-fg-subtle">输入用户名 / 学号 / 姓名搜索</p>
          )}
        </div>
      </ScrollArea>,
      document.body,
    )
    : null;

  return (
    <div>
      <div ref={anchorRef} className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface p-1 shadow-xs focus-within:border-brand focus-within:ring-3 focus-within:ring-ring/40">
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm bg-surface-active pl-1.5 text-xs text-fg">
            <span className="min-w-0 truncate">{v}</span>
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label="移除" title="移除" onClick={() => remove(i)}>
              <X />
            </Button>
          </span>
        ))}
        <Input
          size="sm"
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
          className="w-auto min-w-32 flex-1 border-0 bg-transparent px-1.5 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          placeholder={value.length === 0 ? placeholder || '搜索 OJ 用户名 / 学号 / 姓名，或直接输入' : ''}
        />
      </div>
      {menu}
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
  college?: string;
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
          <Button type="button" variant="primary" onClick={() => setAddOpen(true)}>
            <Plus />
            添加人员
          </Button>
        ) : data.section === 'import' ? (
          <Button type="button" variant="primary" onClick={() => setBatchOpen(true)}>
            <Upload />
            导入奖项
          </Button>
        ) : undefined
      }
    >
      {data.section === 'people' ? (
        <>
          <Panel>
            <SearchInput className="max-w-xs" placeholder="搜索学号 / 姓名…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Panel>

          <Panel flush>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 pl-5">排名</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>学院 / 班级</TableHead>
                  <TableHead className="w-20 text-right">总分</TableHead>
                  <TableHead className="w-20 text-right">奖项数</TableHead>
                  <TableHead className="w-32 pr-5 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState compact title="暂无人员，使用页面主操作添加。" />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.person._id}>
                      <TableCell className="pl-5 font-mono text-sm tabular">#{r.rank}</TableCell>
                      <TableCell className="min-w-0 overflow-hidden">
                        <p className="truncate text-sm font-medium">{r.student.realName}</p>
                        <p className="truncate font-mono text-2xs text-fg-subtle">{r.student.studentId}</p>
                      </TableCell>
                      <TableCell className="min-w-0 overflow-hidden text-xs text-fg-subtle">
                        <span className="block truncate">
                          {rankboardCollege(r.person, r.student) || r.student.schoolName}
                          {r.student.groupNames[0] && ` · ${r.student.groupNames[0]}`}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular">{r.totalScore.toFixed(1)}</TableCell>
                      <TableCell className="text-right text-sm tabular">{r.awardCount}</TableCell>
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
          </Panel>
        </>
      ) : null}

      {data.section === 'import' ? (
        <>
          {data.report ? <ImportReport report={data.report} /> : null}
          <Panel title="导入说明">
            <p className="text-sm text-fg-muted">
              使用 TSV 批量录入奖项；可选自动建立未匹配学生档案。每次提交都会形成可追踪、可回滚的独立批次。
            </p>
          </Panel>
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
    <Alert tone="info" title="批量导入结果">
      <div className="space-y-1 text-xs">
        <p>
          成功 <span className="tabular">{report.ok}</span> 条{report.batchId ? `（批次 ${String(report.batchId).slice(-6)}，可在下方批次历史中回滚）` : ''}
        </p>
        {report.createdStudents > 0 && <p>自动建档 <span className="tabular">{report.createdStudents}</span> 名学生</p>}
        {report.notFound?.length > 0 && <p>学号未找到：{report.notFound.join(', ')}</p>}
        {report.unknownType?.length > 0 && <p>未知奖项类型：{Array.from(new Set(report.unknownType)).join(', ')}</p>}
        {report.errors?.length > 0 && (
          <div>
            <p><span className="tabular">{report.errors.length}</span> 行未导入：</p>
            {report.errors.slice(0, 5).map((error, index) => (
              <p key={index} className="pl-4 text-fg-subtle">
                行 <span className="tabular">{error.line}</span>: {error.reason}
              </p>
            ))}
          </div>
        )}
      </div>
    </Alert>
  );
}

/**
 * 导入批次审计列表（PLAN §6）：每次 TSV 导入一条记录，可一键回滚。
 * 批次历史和导入主任务同区呈现，危险操作贴近对应批次。
 */
function ImportBatchesSection({ batches }: { batches: ImportBatch[] }) {
  return (
    <Panel title="批次历史" flush={batches.length > 0}>
      {batches.length === 0 ? (
        <EmptyState compact title="还没有导入批次。" />
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
              <TableRow key={batch._id}>
                <TableCell className="pl-5 font-mono text-xs tabular">{String(batch.createdAt).replace('T', ' ').slice(0, 16)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular">
                  {batch.okCount}/{batch.rowCount}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular">{batch.createdStudents || 0}</TableCell>
                <TableCell className="text-center">
                  {batch.rolledBackAt ? (
                    <Badge variant="outline" size="sm">
                      已回滚
                    </Badge>
                  ) : (
                    <Badge tone="success" size="sm">
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
    </Panel>
  );
}

function readStudentSummaries(body: unknown): StudentSummary[] | null {
  if (typeof body !== 'object' || body === null || !('students' in body)) return null;
  const students = (body as { students: unknown }).students;
  return Array.isArray(students) ? students as StudentSummary[] : null;
}

function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const searchSeq = useRef(0);

  const doSearch = async (text: string) => {
    const seq = ++searchSeq.current;
    const queryText = text.trim();
    if (!queryText) {
      setResults([]);
      setLoading(false);
      return;
    }
    setResults([]);
    setLoading(true);
    try {
      const r = await fetchHydroResponse(`/admin/rankboard/search?q=${encodeURIComponent(queryText)}`, {
        headers: { Accept: 'application/json' },
      });
      const body: unknown = await r.json();
      if (seq !== searchSeq.current) return;
      const students = r.ok ? readStudentSummaries(body) : null;
      setResults(students ?? []);
    } catch {
      if (seq !== searchSeq.current) return;
      setResults([]);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>添加人员到荣誉榜</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <SearchInput
            placeholder="按学号或姓名搜索学生档案…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              doSearch(e.target.value);
            }}
            autoFocus
          />
          {loading && <p className="text-xs text-fg-subtle">搜索中…</p>}
          {results.length > 0 && (
            <ScrollArea viewportLayout="block" className="max-h-72 rounded-lg border border-line">
              {results.map((s) => (
                <form key={s._id} method="post" action="/admin/rankboard" className="block min-w-0">
                  <input type="hidden" name="operation" value="add" />
                  <input type="hidden" name="studentDocId" value={s._id} />
                  <Button type="submit" variant="ghost" className="w-full min-w-0 justify-between overflow-hidden">
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <span className="min-w-0 truncate text-left font-medium">{s.realName}</span>
                      <span className="shrink-0 font-mono text-xs text-fg-subtle">{s.studentId}</span>
                    </span>
                    <Badge variant="outline" size="sm" className="ml-2 shrink-0">
                      {s.boundUserId ? `UID ${s.boundUserId}` : '未绑定'}
                    </Badge>
                  </Button>
                </form>
              ))}
            </ScrollArea>
          )}
          {!loading && q && results.length === 0 && <p className="text-center text-sm text-fg-muted">没有匹配的学生</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function BatchImportDialog({ onClose, schools }: { onClose: () => void; schools: Array<{ _id: string; name: string }> }) {
  const [createMissing, setCreateMissing] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>批量导入奖项（TSV）</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/rankboard" className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-5">
            <input type="hidden" name="operation" value="batch" />
            <div className="rounded-md bg-surface-sunken p-3 text-xs leading-relaxed text-fg-muted">
              <p className="mb-1 font-medium text-fg">每行一条记录，TAB 分隔，字段顺序：</p>
              <Code className="block max-w-full break-all">学号 ⇥ 奖项key ⇥ 比赛名 ⇥ 日期 ⇥ liveRank ⇥ schoolRank ⇥ 队名 ⇥ 队友(逗号) ⇥ 姓名(可选)</Code>
              <p className="mt-2">空行和 # 开头的行会被跳过。每次导入记录为一个批次，可整批回滚；相同内容重复导入会被拒绝。</p>
            </div>
            <Textarea
              name="batchTsv"
              rows={12}
              spellCheck={false}
              required
              className="font-mono text-xs"
              placeholder={'# 示例\n2023001\ticpc_gold\tICPC 北京站\t2025-04\t12\t1\t红蓝队\t张三,李四\t王五'}
            />
            <div className="space-y-2 rounded-md bg-surface-sunken p-3">
              <Checkbox
                checked={createMissing}
                onCheckedChange={setCreateMissing}
                label="未匹配学号自动建档（需 TSV 带姓名列，毕业学长录奖用）"
              />
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
                  <p className="text-2xs text-fg-subtle">
                    带姓名且学号不存在的行会先在该学校建学生档案（入学年按学号前两位派生），再录入奖项。默认关闭，防手滑污染学生库。
                  </p>
                </>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary">
              <Upload />
              导入
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RankboardSettingsSection({ config }: { config: { baseScore: number; decayFactor: number } }) {
  return (
    <Panel title="计分参数">
      <form method="post" action="/admin/rankboard" className="max-w-xl space-y-5">
        <input type="hidden" name="operation" value="config" />
        <FormField label="基础分（baseScore）" htmlFor="cfg-base" hint="所有奖项得分的乘数。默认 100。">
          <Input id="cfg-base" name="baseScore" type="number" step="any" defaultValue={config.baseScore} />
        </FormField>
        <FormField
          label="排名衰减系数（decayFactor）"
          htmlFor="cfg-decay"
          hint="对启用了 useRankDecay 的奖项：weight × decayFactor^(liveRank-1)。默认 0.5。"
        >
          <Input id="cfg-decay" name="decayFactor" type="number" step="any" min="0" max="1" defaultValue={config.decayFactor} />
        </FormField>
        <div className="flex justify-end border-t border-line-subtle pt-4">
          <Button type="submit" variant="primary">保存</Button>
        </div>
      </form>
    </Panel>
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
        <Button type="button" variant="primary" onClick={() => setCreating(true)}>
          <Plus />
          新增奖项类型
        </Button>
      }
    >
      <Panel flush>
        <Table className="table-fixed">
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
              <TableRow key={t._id}>
                <TableCell className="min-w-0 overflow-hidden pl-5">
                  <AwardTypeName typeKey={t.key} name={t.name} />
                </TableCell>
                <TableCell className="font-mono text-xs text-fg-subtle">{t.key}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular">{t.weight.toFixed(2)}</TableCell>
                <TableCell className="text-center">
                  {t.useRankDecay ? (
                    <Badge tone="success" size="sm">
                      启用
                    </Badge>
                  ) : (
                    <span className="text-xs text-fg-subtle">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-fg-subtle tabular">{t.order}</TableCell>
                <TableCell className="text-center">
                  {t.hidden ? (
                    <Badge variant="outline" size="sm">
                      隐藏
                    </Badge>
                  ) : t.builtin ? (
                    <Badge tone="neutral" size="sm">
                      内建
                    </Badge>
                  ) : (
                    <Badge variant="outline" size="sm">
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
      </Panel>
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
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isNew ? '新增奖项类型' : '编辑奖项类型'}</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/rankboard/awards" className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-5">
            <input type="hidden" name="operation" value="upsert" />
            {!isNew && <input type="hidden" name="key" value={key} />}
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
            <label className="flex items-center gap-2 text-sm text-fg">
              <Switch name="useRankDecay" value="true" checked={useRankDecay} onChange={(e) => setUseRankDecay(e.target.checked)} />
              启用排名衰减（weight × decayFactor^(liveRank-1)）
            </label>
            <label className="flex items-center gap-2 text-sm text-fg">
              <Switch name="hidden" value="true" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              隐藏（已存在的奖项仍计分，但新建时不显示）
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AwardPhotoUpload({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={() => inputRef.current?.click()}
      >
        <Upload />
        上传
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}

/* ─────────────────────────── Person detail editor ─────────────────────────── */

export function AdminRankBoardPersonPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    person: PersonRecord;
    student: { _id: string; studentId: string; realName: string; schoolName?: string } | null;
    types: AwardType[];
    canImport: boolean;
    canManage: boolean;
  };

  const [awards, setAwards] = useState<Award[]>(data.person.awards || []);
  const [employmentStatus, setEmploymentStatus] = useState(data.person.employmentStatus || '');
  const [college, setCollege] = useState(data.person.college || '');
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
      await alertDialog(e instanceof Error && e.message ? e.message : '上传失败');
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

        <Panel title="基本">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="学院" htmlFor="college" hint="留空则展示花名册学校名。">
              <Input
                id="college"
                name="college"
                value={college}
                onChange={(e) => setCollege(e.target.value)}
                placeholder={data.student?.schoolName || '如 计算机学院'}
              />
            </FormField>
            <FormField label="就业去向（可选）" htmlFor="emp">
              <Input
                id="emp"
                name="employmentStatus"
                value={employmentStatus}
                onChange={(e) => setEmploymentStatus(e.target.value)}
                placeholder="如 某公司 / 保研某校 / 出国"
              />
            </FormField>
          </div>
        </Panel>

        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold text-fg">
            奖项（<span className="tabular">{awards.length}</span>）
          </h2>
          <Button type="button" variant="secondary" onClick={addAward} className="shrink-0">
            <Plus />
            新增奖项
          </Button>
        </div>

        <div className="space-y-3">
          {awards.length === 0 && (
            <Panel>
              <EmptyState compact title="暂无奖项，点击右上角新增。" />
            </Panel>
          )}
          {awards.map((award, idx) => {
            const fields = awardFields(award.type);
            return (
              <Panel key={idx}>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-2">
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
                        <FormField
                          label={fields.examScoreIsLadder ? '天梯赛得分' : '实际考试得分'}
                          hint="独立于 OJ ranking 得分，仅用于展示。"
                        >
                          <Input
                            type="number"
                            step="any"
                            value={award.score ?? ''}
                            onChange={(e) => updateAward(idx, { score: e.target.value ? Number(e.target.value) : undefined })}
                            placeholder={fields.examScoreIsLadder ? '如 220 分' : '如 PAT 98 分'}
                          />
                        </FormField>
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="sm" iconOnly className="shrink-0" aria-label="移除奖项" title="移除奖项" onClick={() => removeAward(idx)}>
                      <Trash2 className="text-danger-fg" />
                    </Button>
                  </div>

                  <div className="space-y-2 border-t border-line-subtle pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium text-fg">团队照片（首张作为封面）</p>
                      <AwardPhotoUpload onFile={(file) => { void uploadImage(file, idx); }} />
                    </div>
                    {award.imageUrls && award.imageUrls.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {award.imageUrls.map((u, j) => {
                          const isCover = j === (award.coverIndex ?? 0);
                          return (
                            <div key={j} className="w-24 space-y-1">
                              <div className="relative size-20 overflow-hidden rounded-md border border-line bg-surface-sunken">
                                <img src={u} alt="团队照片" className="size-full object-cover" />
                                {isCover ? (
                                  <Badge tone="brand" variant="soft" size="sm" className="absolute top-1 left-1">
                                    封面
                                  </Badge>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="w-full"
                                onClick={() => updateAward(idx, { coverIndex: j })}
                              >
                                {isCover ? '当前封面' : '设封面'}
                              </Button>
                              <Button
                                type="button"
                                variant="danger-soft"
                                size="sm"
                                className="w-full"
                                onClick={() =>
                                  updateAward(idx, {
                                    imageUrls: (award.imageUrls || []).filter((_, k) => k !== j),
                                    coverIndex: nextCoverIndex(award.coverIndex, j),
                                  })
                                }
                              >
                                删除
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-20 items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-xs text-fg-subtle">
                        <ImageIcon className="size-3.5 shrink-0" />
                        无照片
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" asChild>
            <a href="/admin/rankboard?section=people">返回列表</a>
          </Button>
          <Button type="submit" variant="primary">
            <Save />
            保存
          </Button>
        </div>
      </form>
    </ModuleWorkspace>
  );
}
