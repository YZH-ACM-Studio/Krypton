/**
 * krypton-rankboard public pages.
 *
 *   rankboard_main.html    → RankBoardMainPage
 *   rankboard_detail.html  → RankBoardDetailPage
 *
 * Layout:
 *   - Top 3 podium cards (gold / silver / bronze)
 *   - Filter bar: search + school + award-type multi-select
 *   - Dense table (rank + person + total + per-category counts + OJ AC count)
 *   - Row click opens a right drawer with the full awards list, images,
 *     and per-award scores.
 */
import { useMemo, useState } from 'react';
import {
  Award as AwardIcon, ChevronRight, Crown, Medal, Search, Trophy, X, ZoomIn,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

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

interface LeaderboardRow {
  person: { _id: string; studentDocId: string; awards: Award[]; employmentStatus?: string };
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

/* ─── helpers ─── */

const CATEGORY_GROUPS: Array<{ label: string; matchers: Array<string | RegExp> }> = [
  { label: 'ICPC 金', matchers: [/^ICPC[-_].*金奖$/, /^ICPC[-_].*gold/i, /^icpc_gold$/] },
  { label: 'ICPC 银', matchers: [/^ICPC[-_].*银奖$/, /^ICPC[-_].*silver/i, /^icpc_silver$/] },
  { label: 'ICPC 铜', matchers: [/^ICPC[-_].*铜奖$/, /^ICPC[-_].*bronze/i, /^icpc_bronze$/] },
  { label: 'CCPC 金', matchers: [/^CCPC[-_].*金奖$/, /^ccpc_gold$/] },
  { label: 'CCPC 银', matchers: [/^CCPC[-_].*银奖$/, /^ccpc_silver$/] },
  { label: 'CCPC 铜', matchers: [/^CCPC[-_].*铜奖$/, /^ccpc_bronze$/] },
  { label: 'PAT', matchers: [/^pat_/, /^PAT[-_]/] },
  { label: '天梯赛', matchers: [/^ladder_/, /天梯赛/] },
  { label: '其它', matchers: [] }, // catch-all
];

function categorise(typeName: string): string {
  for (const g of CATEGORY_GROUPS) {
    if (!g.matchers.length) continue;
    for (const m of g.matchers) {
      if (typeof m === 'string' ? m === typeName : m.test(typeName)) return g.label;
    }
  }
  return '其它';
}

function tallyCategories(awards: Award[], typeMap: Map<string, AwardType>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of awards) {
    const type = typeMap.get(a.type);
    const label = categorise(type?.name || type?.key || a.type);
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

/* ─── podium card ─── */

const PODIUM_STYLES: Array<{
  border: string; gradient: string; icon: React.ElementType; iconColor: string; label: string;
}> = [
  { border: 'border-amber-400/60', gradient: 'from-amber-200/40 via-card to-card dark:from-amber-900/30', icon: Crown, iconColor: 'text-amber-500', label: '冠军' },
  { border: 'border-slate-300/70', gradient: 'from-slate-200/50 via-card to-card dark:from-slate-700/30', icon: Trophy, iconColor: 'text-slate-400', label: '亚军' },
  { border: 'border-orange-400/50', gradient: 'from-orange-200/40 via-card to-card dark:from-orange-900/30', icon: Medal, iconColor: 'text-orange-500', label: '季军' },
];

function PodiumCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const style = PODIUM_STYLES[rank - 1];
  const Icon = style.icon;
  return (
    <a
      href={`/rankboard/${row.student._id}`}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-linear-to-br p-5 transition-transform hover:-translate-y-1',
        style.border, style.gradient,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('size-4', style.iconColor)} />
          {style.label}
        </span>
        <span className="rounded-full bg-background/80 px-2 py-0.5 font-mono text-xs">#{rank}</span>
      </div>
      <div>
        <p className="truncate text-lg font-semibold">{row.student.realName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.student.schoolName}
          {row.student.groupNames[0] ? ` · ${row.student.groupNames[0]}` : ''}
        </p>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {row.totalScore.toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">分 · {row.awardCount} 奖</span>
      </div>
    </a>
  );
}

/* ─── awards drawer ─── */

function AwardsDrawer({
  row, typeMap, onClose,
}: { row: LeaderboardRow; typeMap: Map<string, AwardType>; onClose: () => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col border-l bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <p className="text-sm text-muted-foreground">第 {row.rank} 名 · {row.totalScore.toFixed(1)} 分</p>
            <h2 className="text-xl font-semibold">{row.student.realName}</h2>
            <p className="text-xs text-muted-foreground">
              {row.student.studentId} · {row.student.schoolName}
              {row.student.groupNames[0] ? ` · ${row.student.groupNames[0]}` : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="krypton-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {row.person.awards.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">尚无奖项</p>
          ) : (
            row.person.awards.map((award, idx) => {
              const type = typeMap.get(award.type);
              const score = row.awardScores[idx] || 0;
              const cover = award.imageUrls?.[award.coverIndex ?? 0];
              const thumbs = (award.imageUrls || []).filter((_, i) => i !== (award.coverIndex ?? 0));
              return (
                <Card key={idx} className="overflow-hidden">
                  {cover && (
                    <button
                      type="button" onClick={() => setLightbox(cover)}
                      className="group relative block aspect-video w-full overflow-hidden bg-muted"
                    >
                      <img src={cover} alt={award.contest} className="size-full object-cover transition-transform group-hover:scale-105" />
                      <span className="absolute right-2 top-2 rounded-full bg-black/40 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <ZoomIn className="size-3.5" />
                      </span>
                    </button>
                  )}
                  <CardContent className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{type?.name || award.type}</p>
                        {award.contest && (
                          <p className="text-xs text-muted-foreground">{award.contest}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        +{score.toFixed(1)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {award.date && <span>📅 {award.date}</span>}
                      {award.team && <span>🤝 {award.team}</span>}
                      {award.liveRank != null && <span>现场 #{award.liveRank}</span>}
                      {award.schoolRank != null && <span>校内 #{award.schoolRank}</span>}
                    </div>
                    {award.teammates && award.teammates.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        队友：{award.teammates.join(' · ')}
                      </p>
                    )}
                    {thumbs.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {thumbs.map((u, j) => (
                          <button key={j} type="button" onClick={() => setLightbox(u)} className="size-12 overflow-hidden rounded border bg-muted hover:opacity-80">
                            <img src={u} alt="" className="size-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </aside>
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </>
  );
}

/* ─── main page ─── */

export function RankBoardMainPage() {
  const data = useBootstrap().page.data as {
    rows: LeaderboardRow[];
    awardTypes: AwardType[];
    config: { baseScore: number; decayFactor: number };
  };
  const typeMap = new Map(data.awardTypes.map((t) => [t.key, t]));

  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<LeaderboardRow | null>(null);

  // Build school list once.
  const schools = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of data.rows) {
      if (r.student.schoolName && r.student.schoolName !== '—') {
        set.set(r.student.schoolName, r.student.schoolName);
      }
    }
    return Array.from(set.keys()).sort();
  }, [data.rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (schoolFilter !== 'all' && r.student.schoolName !== schoolFilter) return false;
      if (typeFilter.size > 0) {
        const has = r.person.awards.some((a) => typeFilter.has(a.type));
        if (!has) return false;
      }
      if (q) {
        const hay = `${r.student.studentId} ${r.student.realName} ${r.user?.uname || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.rows, schoolFilter, typeFilter, search]);

  const top3 = data.rows.slice(0, 3);
  // Rest of the list (rank >= 4) AFTER filter so top 3 are always shown.
  const rest = filtered.filter((r) => r.rank > 3);

  const toggleType = (key: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <AwardIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">荣誉榜</h1>
        <span className="ml-3 text-xs text-muted-foreground">
          共 {data.rows.length} 人 · 基础分 {data.config.baseScore} · 衰减 {data.config.decayFactor}
        </span>
      </header>

      {/* Top 3 podium */}
      {top3.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {top3.map((r, i) => <PodiumCard key={r.person._id} row={r} rank={i + 1} />)}
          {Array.from({ length: 3 - top3.length }).map((_, i) => (
            <div key={`empty-${i}`} className="rounded-xl border border-dashed bg-muted/20 p-5 text-center text-xs text-muted-foreground">
              暂无第 {top3.length + i + 1} 名
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8" placeholder="搜索学号 / 姓名"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">全部学校</option>
            {schools.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <details className="flex-1">
            <summary className="cursor-pointer rounded-md border bg-background px-3 py-2 text-sm">
              奖项类型筛选 {typeFilter.size > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{typeFilter.size}</Badge>}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-md border bg-card p-2 sm:grid-cols-3 lg:grid-cols-4">
              {data.awardTypes.filter((t) => !t.hidden).map((t) => (
                <label key={t.key} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-accent/40">
                  <Checkbox checked={typeFilter.has(t.key)}
                    onChange={() => toggleType(t.key)}
                   />
                  {t.name}
                </label>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 pl-5">排名</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>学校 / 班级</TableHead>
                  <TableHead className="w-20 text-right">总分</TableHead>
                  <TableHead className="w-12 text-center">ICPC 金</TableHead>
                  <TableHead className="w-12 text-center">ICPC 银</TableHead>
                  <TableHead className="w-12 text-center">ICPC 铜</TableHead>
                  <TableHead className="w-12 text-center">CCPC 金</TableHead>
                  <TableHead className="w-12 text-center">CCPC 银</TableHead>
                  <TableHead className="w-12 text-center">CCPC 铜</TableHead>
                  <TableHead className="w-12 text-center">PAT</TableHead>
                  <TableHead className="w-14 text-center">天梯赛</TableHead>
                  <TableHead className="w-12 text-center">其它</TableHead>
                  <TableHead className="w-16 pr-5 text-right">OJ AC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rest.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">
                      {data.rows.length === 0
                        ? '荣誉榜暂无成员，等待管理员添加。'
                        : '当前筛选下没有匹配的成员。'}
                    </TableCell>
                  </TableRow>
                ) : (
                  rest.map((r) => {
                    const counts = tallyCategories(r.person.awards, typeMap);
                    return (
                      <TableRow
                        key={r.person._id}
                        className="cursor-pointer"
                        onClick={() => setOpenRow(r)}
                      >
                        <TableCell className="pl-5 font-mono text-sm font-semibold">#{r.rank}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{r.student.realName}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{r.student.studentId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.student.schoolName}
                          {r.student.groupNames[0] && <span className="ml-1 opacity-70">· {r.student.groupNames[0]}</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{r.totalScore.toFixed(1)}</TableCell>
                        <TableCell className="text-center text-xs">{counts['ICPC 金'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['ICPC 银'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['ICPC 铜'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['CCPC 金'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['CCPC 银'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['CCPC 铜'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['PAT'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['天梯赛'] || ''}</TableCell>
                        <TableCell className="text-center text-xs">{counts['其它'] || ''}</TableCell>
                        <TableCell className="pr-5 text-right font-mono text-sm">
                          {r.user ? r.user.nAccept : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {openRow && <AwardsDrawer row={openRow} typeMap={typeMap} onClose={() => setOpenRow(null)} />}
    </div>
  );
}

/* ─── detail page (linked from podium cards) ─── */

export function RankBoardDetailPage() {
  const data = useBootstrap().page.data as {
    row: LeaderboardRow;
    awardTypes: AwardType[];
  };
  const typeMap = new Map(data.awardTypes.map((t) => [t.key, t]));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" asChild>
        <a href="/rankboard" className="gap-1.5">
          <ChevronRight className="size-3.5 rotate-180" />
          返回荣誉榜
        </a>
      </Button>
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-xs text-muted-foreground">
            第 {data.row.rank} 名 · {data.row.totalScore.toFixed(1)} 分
          </p>
          <h1 className="text-3xl font-bold">{data.row.student.realName}</h1>
          <p className="text-sm text-muted-foreground">
            {data.row.student.studentId} · {data.row.student.schoolName}
            {data.row.student.groupNames[0] ? ` · ${data.row.student.groupNames[0]}` : ''}
          </p>
          {data.row.user && (
            <p className="text-xs text-muted-foreground">
              OJ：<a href={`/user/${data.row.user.uname}`} className="text-primary hover:underline">{data.row.user.uname}</a> · 通过 {data.row.user.nAccept} 题
            </p>
          )}
          {data.row.person.employmentStatus && (
            <p className="text-xs text-muted-foreground">就业去向：{data.row.person.employmentStatus}</p>
          )}
        </CardContent>
      </Card>
      <h2 className="text-base font-semibold">奖项（{data.row.awardCount}）</h2>
      <div className="space-y-3">
        {data.row.person.awards.map((award, idx) => {
          const type = typeMap.get(award.type);
          const score = data.row.awardScores[idx] || 0;
          const cover = award.imageUrls?.[award.coverIndex ?? 0];
          return (
            <Card key={idx}>
              {cover && (
                <div className="aspect-video w-full overflow-hidden bg-muted">
                  <img src={cover} alt={award.contest} className="size-full object-cover" />
                </div>
              )}
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{type?.name || award.type}</p>
                    {award.contest && <p className="text-xs text-muted-foreground">{award.contest}</p>}
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">+{score.toFixed(1)}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {award.date && <span>📅 {award.date}</span>}
                  {award.team && <span>🤝 {award.team}</span>}
                  {award.liveRank != null && <span>现场 #{award.liveRank}</span>}
                  {award.schoolRank != null && <span>校内 #{award.schoolRank}</span>}
                </div>
                {award.teammates && award.teammates.length > 0 && (
                  <p className="text-xs text-muted-foreground">队友：{award.teammates.join(' · ')}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
