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
import { Award as AwardIcon, Calendar, ChevronRight, Crown, Medal, Search, Trophy, Users, X, ZoomIn } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { makeInitials } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import {
  LADDER_DETAIL_COLUMNS,
  MEDAL_TEXT_CLASS,
  awardFilterChipLabel,
  buildAwardFilterGroups,
  emptyAwardTally,
  isRankboardStatsMode,
  ladderColumnCount,
  mergeAwardTally,
  rankboardTableRows,
  rowMatchesAwardFilter,
  shouldShowLadderDetails,
  tallyAwards,
  withoutLadderKeys,
  type AwardFilterGroupId,
  type AwardTally,
  type MedalMetal,
  type MedalPair,
} from './award-display';

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
    _id: string;
    studentId: string;
    realName: string;
    schoolId: string;
    schoolName: string;
    groupNames: string[];
    boundUserId: number | null;
    enrollmentYear?: string | number;
  };
  user: { uname: string; nAccept: number; avatarUrl?: string } | null;
  totalScore: number;
  awardCount: number;
  rank: number;
  awardScores: number[];
}

/* ─── helpers ─── */

/**
 * Field visibility per award category — kept in sync with the admin form.
 *   ICPC / CCPC: dual rank (现场 + 学校), teammates
 *   天梯赛-团队: team + 排名
 *   天梯赛-个人: 排名
 *   PAT: 排名 + 实际考试得分
 *   others: 排名
 */
function awardFields(typeKey: string) {
  const isICPC = /^icpc/i.test(typeKey);
  const isCCPC = /^ccpc/i.test(typeKey);
  const isPAT = /^pat/i.test(typeKey);
  const isLadder = typeKey.startsWith('ladder_');
  const hasDualRank = isICPC || isCCPC;
  return {
    hasDualRank,
    hasSingleRank: !hasDualRank,
    hasExamScore: isPAT,
    // 天梯赛 numeric score — sourced from the tasks store (single source of
    // truth) via the backend overlay; display only. See docs/PLAN-2026-06-07.
    hasLadderScore: isLadder,
  };
}

function IcpcMedalCell({ pair, metal }: { pair: MedalPair; metal: MedalMetal }) {
  if (pair.regular === 0 && pair.extra === 0) return null;
  if (pair.extra === 0) return pair.regular;
  return (
    <>
      {pair.regular}
      <span className={MEDAL_TEXT_CLASS[metal]}>（+{pair.extra}）</span>
    </>
  );
}

function CountCell({ value }: { value: number }) {
  return value > 0 ? value : null;
}

function LeaderboardCountCells({
  awards,
  typeMap,
  showLadderDetails,
  counts,
  ladderCounts,
}: {
  awards: Award[];
  typeMap: Map<string, AwardType>;
  showLadderDetails: boolean;
  counts: AwardTally;
  ladderCounts?: Record<string, number>;
}) {
  return (
    <>
      <TableCell className="text-center text-xs">
        <IcpcMedalCell pair={counts.icpc.gold} metal="gold" />
      </TableCell>
      <TableCell className="text-center text-xs">
        <IcpcMedalCell pair={counts.icpc.silver} metal="silver" />
      </TableCell>
      <TableCell className="text-center text-xs">
        <IcpcMedalCell pair={counts.icpc.bronze} metal="bronze" />
      </TableCell>
      <TableCell className="text-center text-xs">
        <CountCell value={counts.ccpc.gold} />
      </TableCell>
      <TableCell className="text-center text-xs">
        <CountCell value={counts.ccpc.silver} />
      </TableCell>
      <TableCell className="text-center text-xs">
        <CountCell value={counts.ccpc.bronze} />
      </TableCell>
      <TableCell className="text-center text-xs">
        <CountCell value={counts.pat} />
      </TableCell>
      {showLadderDetails ? (
        LADDER_DETAIL_COLUMNS.map((column) => (
          <TableCell key={column.key} className="text-center text-xs">
            <CountCell value={ladderCounts?.[column.key] ?? ladderColumnCount(awards, typeMap, column.key)} />
          </TableCell>
        ))
      ) : (
        <TableCell className="text-center text-xs">
          <CountCell value={counts.ladder} />
        </TableCell>
      )}
      <TableCell className="text-center text-xs">
        <CountCell value={counts.other} />
      </TableCell>
    </>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/* ─── podium card ─── */

const PODIUM_STYLES: Array<{
  border: string;
  gradient: string;
  icon: React.ElementType;
  iconColor: string;
  label: string;
}> = [
  {
    border: 'border-amber-400/60',
    gradient: 'from-amber-200/40 via-card to-card dark:from-amber-900/30',
    icon: Crown,
    iconColor: 'text-amber-500',
    label: '冠军',
  },
  {
    border: 'border-slate-300/70',
    gradient: 'from-slate-200/50 via-card to-card dark:from-slate-700/30',
    icon: Trophy,
    iconColor: 'text-slate-400',
    label: '亚军',
  },
  {
    border: 'border-orange-400/50',
    gradient: 'from-orange-200/40 via-card to-card dark:from-orange-900/30',
    icon: Medal,
    iconColor: 'text-orange-500',
    label: '季军',
  },
];

function PodiumCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const style = PODIUM_STYLES[rank - 1];
  const Icon = style.icon;
  return (
    <a
      href={`/rankboard/${row.student._id}`}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-linear-to-br p-5 transition-transform hover:-translate-y-1',
        style.border,
        style.gradient,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('size-4', style.iconColor)} />
          {style.label}
        </span>
        <span className="rounded-full bg-background/80 px-2 py-0.5 font-mono text-xs">#{rank}</span>
      </div>
      <div className="flex items-center gap-3">
        <Avatar className="size-10 shrink-0">
          {row.user?.avatarUrl ? <AvatarImage src={row.user.avatarUrl} alt={row.student.realName} /> : null}
          <AvatarFallback className="text-xs">{makeInitials(row.user?.uname || row.student.realName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{row.student.realName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.student.studentId}</p>
        </div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums">{row.totalScore.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">分 · {row.awardCount} 奖</span>
      </div>
    </a>
  );
}

/* ─── awards drawer ─── */

function AwardsDrawer({ row, typeMap, onClose }: { row: LeaderboardRow; typeMap: Map<string, AwardType>; onClose: () => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col border-l bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <p className="text-sm text-muted-foreground">
              第 {row.rank} 名 · {row.totalScore.toFixed(1)} 分
            </p>
            <h2 className="text-xl font-semibold">{row.student.realName}</h2>
            <p className="font-mono text-xs text-muted-foreground">{row.student.studentId}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <ScrollArea className="flex-1" viewportClassName="space-y-3 p-5">
          {row.person.awards.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">尚无奖项</p>
          ) : (
            row.person.awards.map((award, idx) => {
              const type = typeMap.get(award.type);
              const score = row.awardScores[idx] || 0;
              const cover = award.imageUrls?.[award.coverIndex ?? 0];
              const thumbs = (award.imageUrls || []).filter((_, i) => i !== (award.coverIndex ?? 0));
              const fields = awardFields(award.type);
              return (
                <Card key={idx} className="overflow-hidden">
                  {cover && (
                    <button
                      type="button"
                      onClick={() => setLightbox(cover)}
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
                        {award.contest && <p className="text-xs text-muted-foreground">{award.contest}</p>}
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        +{score.toFixed(1)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {award.date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3" />
                          {award.date}
                        </span>
                      )}
                      {award.team && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" />
                          {award.team}
                        </span>
                      )}
                      {award.liveRank != null && fields.hasDualRank && <span>现场 #{award.liveRank}</span>}
                      {award.schoolRank != null && fields.hasDualRank && <span>校内 #{award.schoolRank}</span>}
                      {award.liveRank != null && fields.hasSingleRank && <span>排名 #{award.liveRank}</span>}
                      {award.score != null && fields.hasExamScore && <span className="font-semibold text-foreground">考试 {award.score} 分</span>}
                      {award.score != null && fields.hasLadderScore && <span className="font-semibold text-foreground">天梯赛 {award.score} 分</span>}
                    </div>
                    {award.teammates && award.teammates.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">队友：{award.teammates.join(' · ')}</p>
                    )}
                    {thumbs.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {thumbs.map((u, j) => (
                          <button
                            key={j}
                            type="button"
                            onClick={() => setLightbox(u)}
                            className="size-12 overflow-hidden rounded border bg-muted hover:opacity-80"
                          >
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
        </ScrollArea>
      </aside>
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
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
  const typeMap = useMemo(() => new Map(data.awardTypes.map((t) => [t.key, t])), [data.awardTypes]);

  const [search, setSearch] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [ladderGroupSelected, setLadderGroupSelected] = useState(false);
  const [showAllLadderDetails, setShowAllLadderDetails] = useState(false);
  const [openRow, setOpenRow] = useState<LeaderboardRow | null>(null);
  const filterGroups = useMemo(() => buildAwardFilterGroups(data.awardTypes), [data.awardTypes]);
  const showLadderDetails = shouldShowLadderDetails(typeFilter, showAllLadderDetails, data.awardTypes);

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

  // 年级（入学年）列表——来自 userbind 派生的 enrollmentYear（PLAN §5）。
  const enrollmentYears = useMemo(() => {
    const set = new Set<string | number>();
    for (const r of data.rows) {
      const y = r.student.enrollmentYear;
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [data.rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (schoolFilter !== 'all' && r.student.schoolName !== schoolFilter) return false;
      if (yearFilter !== 'all') {
        const y = r.student.enrollmentYear;
        if (String(y ?? '') !== yearFilter) return false;
      }
      if (!rowMatchesAwardFilter(r.person.awards, typeFilter, ladderGroupSelected, typeMap)) return false;
      if (q) {
        const hay = `${r.student.studentId} ${r.student.realName} ${r.user?.uname || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.rows, schoolFilter, yearFilter, typeFilter, ladderGroupSelected, search, typeMap]);

  const top3 = data.rows.slice(0, 3);
  const statsMode = isRankboardStatsMode({
    typeFilterSize: typeFilter.size,
    ladderGroupSelected,
    schoolFilter,
    yearFilter,
    search,
  });
  const tableRows = useMemo(() => rankboardTableRows(filtered, statsMode), [filtered, statsMode]);
  const tableTotals = useMemo(() => {
    if (!statsMode || tableRows.length === 0) return null;
    let tally = emptyAwardTally();
    const ladderColumns = Object.fromEntries(LADDER_DETAIL_COLUMNS.map((column) => [column.key, 0])) as Record<string, number>;
    let nAccept = 0;
    let totalScore = 0;
    for (const row of tableRows) {
      tally = mergeAwardTally(tally, tallyAwards(row.person.awards, typeMap));
      if (showLadderDetails) {
        for (const column of LADDER_DETAIL_COLUMNS) {
          ladderColumns[column.key] += ladderColumnCount(row.person.awards, typeMap, column.key);
        }
      }
      nAccept += row.user?.nAccept || 0;
      totalScore += row.totalScore;
    }
    return { tally, ladderColumns, nAccept, totalScore };
  }, [statsMode, tableRows, typeMap, showLadderDetails]);

  const ladderKeys = useMemo(() => filterGroups.find((group) => group.id === 'ladder')?.items.map((item) => item.key) || [], [filterGroups]);

  const toggleType = (key: string) => {
    const turningOn = !typeFilter.has(key);
    if (turningOn && ladderKeys.includes(key)) setLadderGroupSelected(false);
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (id: AwardFilterGroupId, keys: string[]) => {
    if (id === 'ladder') {
      setLadderGroupSelected((current) => {
        const next = !current;
        if (next) setTypeFilter((prev) => withoutLadderKeys(prev, keys));
        return next;
      });
      return;
    }
    setTypeFilter((prev) => {
      const allOn = keys.every((key) => prev.has(key));
      const next = new Set(prev);
      for (const key of keys) {
        if (allOn) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const filterActive = typeFilter.size > 0 || ladderGroupSelected;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <AwardIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">中国民航大学荣誉榜</h1>
        <span className="ml-3 text-xs text-muted-foreground">
          共 {data.rows.length} 人 · 基础分 {data.config.baseScore} · 衰减 {data.config.decayFactor}
        </span>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href="/rankboard/gallery">荣誉照片墙</a>
        </Button>
      </header>

      {/* Top 3 podium */}
      {top3.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {top3.map((r, i) => (
            <PodiumCard key={r.person._id} row={r} rank={i + 1} />
          ))}
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
            <Input className="pl-8" placeholder="搜索学号 / 姓名" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <SimpleSelect
            value={schoolFilter}
            onValueChange={setSchoolFilter}
            className="w-auto min-w-[10rem]"
            options={[{ value: 'all', label: '全部学校' }, ...schools.map((s) => ({ value: s, label: s }))]}
          />
          <SimpleSelect
            value={yearFilter}
            onValueChange={setYearFilter}
            className="w-auto min-w-[8rem]"
            options={[{ value: 'all', label: '全部年级' }, ...enrollmentYears.map((y) => ({ value: String(y), label: `${y} 级` }))]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">奖项类型</p>
            {filterActive ? (
              <Badge variant="secondary" className="text-[10px]">
                {typeFilter.size + (ladderGroupSelected ? 1 : 0)}
              </Badge>
            ) : null}
            {filterActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  setTypeFilter(new Set());
                  setLadderGroupSelected(false);
                  setShowAllLadderDetails(false);
                }}
              >
                清除筛选
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            {filterGroups.map((group) => {
              const keys = group.items.map((item) => item.key);
              const selectedCount = group.id === 'ladder' ? (ladderGroupSelected ? keys.length : keys.filter((key) => typeFilter.has(key)).length) : keys.filter((key) => typeFilter.has(key)).length;
              const parentOn = group.id === 'ladder' ? ladderGroupSelected : keys.length > 0 && keys.every((key) => typeFilter.has(key));
              return (
                <section key={group.id} className="min-w-[12rem] flex-1 rounded-xl border bg-muted/25 p-2.5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <FilterChip pressed={parentOn} onClick={() => toggleGroup(group.id, keys)}>
                      {group.label}
                      {selectedCount > 0 ? ` ${selectedCount}` : ''}
                    </FilterChip>
                    {group.id === 'ladder' ? (
                      <FilterChip pressed={showAllLadderDetails} onClick={() => setShowAllLadderDetails((current) => !current)}>
                        {showAllLadderDetails ? '收起明细列' : '展开明细列'}
                      </FilterChip>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((item) => (
                      <FilterChip key={item.key} pressed={typeFilter.has(item.key)} onClick={() => toggleType(item.key)} title={item.name}>
                        {awardFilterChipLabel(item)}
                      </FilterChip>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
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
                  <TableHead className="w-32">就业去向</TableHead>
                  <TableHead className="w-16 text-center">ICPC 金</TableHead>
                  <TableHead className="w-16 text-center">ICPC 银</TableHead>
                  <TableHead className="w-16 text-center">ICPC 铜</TableHead>
                  <TableHead className="w-12 text-center">CCPC 金</TableHead>
                  <TableHead className="w-12 text-center">CCPC 银</TableHead>
                  <TableHead className="w-12 text-center">CCPC 铜</TableHead>
                  <TableHead className="w-12 text-center">PAT</TableHead>
                  {showLadderDetails ? (
                    LADDER_DETAIL_COLUMNS.map((column) => (
                      <TableHead key={column.key} className="w-12 text-center">
                        {column.label}
                      </TableHead>
                    ))
                  ) : (
                    <TableHead className="w-14 text-center">天梯赛</TableHead>
                  )}
                  <TableHead className="w-12 text-center">其它</TableHead>
                  <TableHead className="w-16 text-right">OJ AC</TableHead>
                  <TableHead className="w-20 pr-5 text-right">总分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={showLadderDetails ? 20 : 14} className="py-10 text-center text-sm text-muted-foreground">
                      {data.rows.length === 0 ? '荣誉榜暂无成员，等待管理员添加。' : '当前筛选下没有匹配的成员。'}
                    </TableCell>
                  </TableRow>
                ) : (
                  tableRows.map((r) => {
                    const counts = tallyAwards(r.person.awards, typeMap);
                    return (
                      <TableRow key={r.person._id} className="cursor-pointer" onClick={() => setOpenRow(r)}>
                        <TableCell className="pl-5 font-mono text-sm font-semibold">#{r.rank}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{r.student.realName}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{r.student.studentId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground">
                          {r.person.employmentStatus || <span className="opacity-40">—</span>}
                        </TableCell>
                        <LeaderboardCountCells awards={r.person.awards} typeMap={typeMap} showLadderDetails={showLadderDetails} counts={counts} />
                        <TableCell className="text-right font-mono text-sm">{r.user ? r.user.nAccept : '—'}</TableCell>
                        <TableCell className="pr-5 text-right font-mono text-sm font-semibold">{r.totalScore.toFixed(1)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              {tableTotals ? (
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="pl-5 font-semibold">合计</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{tableRows.length} 人</TableCell>
                    <TableCell />
                    <LeaderboardCountCells
                      awards={[]}
                      typeMap={typeMap}
                      showLadderDetails={showLadderDetails}
                      counts={tableTotals.tally}
                      ladderCounts={tableTotals.ladderColumns}
                    />
                    <TableCell className="text-right font-mono text-sm">{tableTotals.nAccept}</TableCell>
                    <TableCell className="pr-5 text-right font-mono text-sm font-semibold">{tableTotals.totalScore.toFixed(1)}</TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
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
    <div className="space-y-5">
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
          <p className="font-mono text-sm text-muted-foreground">{data.row.student.studentId}</p>
          {data.row.user && data.row.student.boundUserId ? (
            <p className="text-xs text-muted-foreground">
              OJ：
              <a href={`/user/${data.row.student.boundUserId}`} className="text-primary hover:underline">
                {data.row.user.uname}
              </a>{' '}
              · 通过 {data.row.user.nAccept} 题
            </p>
          ) : null}
          {data.row.person.employmentStatus && <p className="text-xs text-muted-foreground">就业去向：{data.row.person.employmentStatus}</p>}
        </CardContent>
      </Card>
      <h2 className="text-base font-semibold">奖项（{data.row.awardCount}）</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.row.person.awards.map((award, idx) => {
          const type = typeMap.get(award.type);
          const score = data.row.awardScores[idx] || 0;
          const cover = award.imageUrls?.[award.coverIndex ?? 0];
          const fields = awardFields(award.type);
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
                  <Badge variant="outline" className="font-mono text-xs">
                    +{score.toFixed(1)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {award.date && <span>📅 {award.date}</span>}
                  {award.team && <span>🤝 {award.team}</span>}
                  {award.liveRank != null && fields.hasDualRank && <span>现场 #{award.liveRank}</span>}
                  {award.schoolRank != null && fields.hasDualRank && <span>校内 #{award.schoolRank}</span>}
                  {award.liveRank != null && fields.hasSingleRank && <span>排名 #{award.liveRank}</span>}
                  {award.score != null && fields.hasExamScore && <span className="font-semibold text-foreground">考试 {award.score} 分</span>}
                  {award.score != null && fields.hasLadderScore && <span className="font-semibold text-foreground">天梯赛 {award.score} 分</span>}
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
