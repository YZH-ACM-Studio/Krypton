/**
 * krypton-rankboard public pages.
 *
 *   rankboard_main.html    → RankBoardMainPage
 *   rankboard_detail.html  → RankBoardDetailPage
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Calendar, ChevronRight, Crown, Medal, Trophy, Users, ZoomIn } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { makeInitials } from '@/lib/format';
import {
  LADDER_DETAIL_COLUMNS,
  MEDAL_TEXT_CLASS,
  awardFilterChipLabel,
  buildAwardFilterGroups,
  emptyAwardTally,
  isRankboardStatsMode,
  ladderColumnCount,
  mergeAwardTally,
  rankMedal,
  rankboardCollege,
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
  person: { _id: string; studentDocId: string; awards: Award[]; employmentStatus?: string; college?: string };
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

interface BoardTableRow {
  key: string;
  rank: number;
  kind: 'person' | 'total';
  name: string;
  studentId: string;
  college: string;
  employment: string;
  counts: AwardTally;
  ladderCounts: Record<string, number>;
  nAccept: number | null;
  totalScore: number;
  personCount: number;
  source: LeaderboardRow | null;
}

function rankboardPersonHref(row: BoardTableRow): string {
  if (row.source === null) {
    throw new TypeError('荣誉榜合计行没有学生详情');
  }
  return `/rankboard/${row.source.student._id}`;
}

function rankboardRowHref(row: BoardTableRow): string {
  if (row.kind !== 'person') {
    // DataTable 只要设置 rowHref 就会给每一行盖锚点。合计行没有详情页，
    // 省略 href 后它不是超链接，点击不会改地址、滚动或写入历史。
    return undefined as unknown as string;
  }
  return rankboardPersonHref(row);
}

const PODIUM_MARK: Record<MedalMetal, { icon: typeof Crown; label: string }> = {
  gold: { icon: Crown, label: '冠军' },
  silver: { icon: Trophy, label: '亚军' },
  bronze: { icon: Medal, label: '季军' },
};

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
  if (pair.extra === 0) return <span className="tabular">{pair.regular}</span>;
  return (
    <span className="tabular">
      {pair.regular}
      <span className={MEDAL_TEXT_CLASS[metal]}>（+{pair.extra}）</span>
    </span>
  );
}

function CountValue({ value }: { value: number }) {
  return value > 0 ? <span className="tabular">{value}</span> : null;
}

function leaderboardColumns(showLadderDetails: boolean): Column<BoardTableRow>[] {
  const countColumn = (key: string, header: string, read: (row: BoardTableRow) => ReactNode, width = '4.5rem'): Column<BoardTableRow> => ({
    key,
    header,
    align: 'center',
    width,
    cell: read,
  });
  const ladder = showLadderDetails
    ? LADDER_DETAIL_COLUMNS.map((column) => countColumn(
        column.key,
        column.label,
        (row) => <CountValue value={row.ladderCounts[column.key] ?? 0} />,
        '3.5rem',
      ))
    : [countColumn('ladder', '天梯赛', (row) => <CountValue value={row.counts.ladder} />)];
  return [
    {
      key: 'rank',
      header: '排名',
      width: '4.5rem',
      cell: (row) => (row.kind === 'total'
        ? <span className="font-semibold">合计</span>
        : <span className="tabular font-semibold">#{row.rank}</span>),
    },
    {
      key: 'name',
      header: '姓名',
      cell: (row) => (row.kind === 'total' ? (
        <span className="text-xs text-fg-muted">{row.personCount} 人</span>
      ) : (
        <a
          href={rankboardPersonHref(row)}
          className="block min-w-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="truncate font-mono text-2xs text-fg-subtle">{row.studentId}</p>
        </a>
      )),
    },
    {
      key: 'college',
      header: '学院',
      width: '8rem',
      cell: (row) => (row.kind === 'total' ? null : (
        <span className="block truncate text-xs text-fg-muted">{row.college || '—'}</span>
      )),
    },
    {
      key: 'employment',
      header: '就业去向',
      width: '8rem',
      cell: (row) => (row.kind === 'total' ? null : (
        <span className="block truncate text-xs text-fg-muted">{row.employment || '—'}</span>
      )),
    },
    countColumn('icpc-gold', 'ICPC 金', (row) => <IcpcMedalCell pair={row.counts.icpc.gold} metal="gold" />),
    countColumn('icpc-silver', 'ICPC 银', (row) => <IcpcMedalCell pair={row.counts.icpc.silver} metal="silver" />),
    countColumn('icpc-bronze', 'ICPC 铜', (row) => <IcpcMedalCell pair={row.counts.icpc.bronze} metal="bronze" />),
    countColumn('ccpc-gold', 'CCPC 金', (row) => <CountValue value={row.counts.ccpc.gold} />, '3.5rem'),
    countColumn('ccpc-silver', 'CCPC 银', (row) => <CountValue value={row.counts.ccpc.silver} />, '3.5rem'),
    countColumn('ccpc-bronze', 'CCPC 铜', (row) => <CountValue value={row.counts.ccpc.bronze} />, '3.5rem'),
    countColumn('pat', 'PAT', (row) => <CountValue value={row.counts.pat} />, '3.5rem'),
    ...ladder,
    countColumn('other', '其它', (row) => <CountValue value={row.counts.other} />, '3.5rem'),
    {
      key: 'ac',
      header: 'OJ AC',
      align: 'right',
      width: '5rem',
      cell: (row) => <span className="tabular">{row.nAccept === null ? '—' : row.nAccept}</span>,
    },
    {
      key: 'score',
      header: '总分',
      align: 'right',
      width: '5.5rem',
      cell: (row) => <span className="tabular font-semibold">{row.totalScore.toFixed(1)}</span>,
    },
  ];
}

function FilterChip({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? 'soft' : 'secondary'}
      size="sm"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

function PodiumCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const metal = rankMedal(rank);
  if (metal === null) throw new RangeError(`名次 ${rank} 不是金银铜`);
  const mark = PODIUM_MARK[metal];
  const Icon = mark.icon;
  const college = rankboardCollege(row.person, row.student);
  return (
    <a href={`/rankboard/${row.student._id}`} className="block min-w-0">
      <Panel className="h-full">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <Icon className={cn('size-4', MEDAL_TEXT_CLASS[metal])} />
            {mark.label}
          </span>
          <span className={cn('tabular font-semibold', MEDAL_TEXT_CLASS[metal])}>#{rank}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Avatar className="size-10 shrink-0">
            {row.user?.avatarUrl ? <AvatarImage src={row.user.avatarUrl} alt={row.student.realName} /> : null}
            <AvatarFallback className="text-xs">{makeInitials(row.user?.uname || row.student.realName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{row.student.realName}</p>
            <p className="truncate font-mono text-xs text-fg-muted">{row.student.studentId}</p>
            {college ? <p className="truncate text-xs text-fg-muted">{college}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular tracking-tight">{row.totalScore.toFixed(1)}</span>
          <span className="text-xs text-fg-muted">分 · {row.awardCount} 奖</span>
        </div>
      </Panel>
    </a>
  );
}

function AwardCard({
  award,
  typeName,
  score,
  onLightbox,
  plainMeta = false,
}: {
  award: Award;
  typeName: string;
  score: number;
  onLightbox?: (url: string) => void;
  plainMeta?: boolean;
}) {
  const fields = awardFields(award.type);
  const cover = award.imageUrls?.[award.coverIndex ?? 0];
  const thumbs = onLightbox ? (award.imageUrls || []).filter((_, index) => index !== (award.coverIndex ?? 0)) : [];
  return (
    <Panel flush className="h-full">
      {cover ? (
        onLightbox ? (
          <Button type="button" variant="ghost" onClick={() => onLightbox(cover)} className="block h-auto! w-full rounded-none p-0">
            <span className="relative block aspect-video w-full overflow-hidden bg-surface-sunken">
              <img src={cover} alt={award.contest || ''} className="size-full object-cover" />
              <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-scrim text-bg">
                <ZoomIn className="size-3.5" />
              </span>
            </span>
          </Button>
        ) : (
          <div className="aspect-video w-full overflow-hidden bg-surface-sunken">
            <img src={cover} alt={award.contest || ''} className="size-full object-cover" />
          </div>
        )
      ) : null}
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{typeName}</p>
            {award.contest ? <p className="text-xs text-fg-muted">{award.contest}</p> : null}
          </div>
          <Badge variant="outline" tone="neutral" size="sm">+{score.toFixed(1)}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {award.date ? (
            plainMeta ? <span>📅 {award.date}</span> : (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                {award.date}
              </span>
            )
          ) : null}
          {award.team ? (
            plainMeta ? <span>🤝 {award.team}</span> : (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" />
                {award.team}
              </span>
            )
          ) : null}
          {award.liveRank != null && fields.hasDualRank ? <span className="tabular font-semibold">现场 #{award.liveRank}</span> : null}
          {award.schoolRank != null && fields.hasDualRank ? <span className="tabular font-semibold">校内 #{award.schoolRank}</span> : null}
          {award.liveRank != null && fields.hasSingleRank ? <span className="tabular font-semibold">排名 #{award.liveRank}</span> : null}
          {award.score != null && fields.hasExamScore ? <span className="tabular font-semibold text-fg">考试 {award.score} 分</span> : null}
          {award.score != null && fields.hasLadderScore ? <span className="tabular font-semibold text-fg">天梯赛 {award.score} 分</span> : null}
        </div>
        {award.teammates && award.teammates.length > 0 ? (
          <p className="text-xs text-fg-muted">队友：{award.teammates.join(' · ')}</p>
        ) : null}
        {thumbs.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {thumbs.map((url, index) => (
              <Button
                key={`${url}-${index}`}
                type="button"
                variant="ghost"
                onClick={() => onLightbox?.(url)}
                className="size-12 h-12! w-12! overflow-hidden rounded-md p-0"
              >
                <img src={url} alt="" className="size-full object-cover" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function RankBoardMainPage() {
  const data = useBootstrap().page.data as {
    rows: LeaderboardRow[];
    awardTypes: AwardType[];
    config: { baseScore: number; decayFactor: number };
  };
  const typeMap = useMemo(() => new Map(data.awardTypes.map((type) => [type.key, type])), [data.awardTypes]);

  const [search, setSearch] = useState('');
  const [collegeFilter, setCollegeFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [ladderGroupSelected, setLadderGroupSelected] = useState(false);
  const [showAllLadderDetails, setShowAllLadderDetails] = useState(false);
  const filterGroups = useMemo(() => buildAwardFilterGroups(data.awardTypes), [data.awardTypes]);
  const showLadderDetails = shouldShowLadderDetails(typeFilter, showAllLadderDetails, data.awardTypes);

  const colleges = useMemo(() => {
    const set = new Set<string>();
    for (const r of data.rows) {
      const college = rankboardCollege(r.person, r.student);
      if (college) set.add(college);
    }
    return [...set].sort();
  }, [data.rows]);

  const enrollmentYears = useMemo(() => {
    const set = new Set<string | number>();
    for (const r of data.rows) {
      const year = r.student.enrollmentYear;
      if (year) set.add(year);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [data.rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (collegeFilter !== 'all' && rankboardCollege(r.person, r.student) !== collegeFilter) return false;
      if (yearFilter !== 'all') {
        const year = r.student.enrollmentYear;
        if (String(year ?? '') !== yearFilter) return false;
      }
      if (!rowMatchesAwardFilter(r.person.awards, typeFilter, ladderGroupSelected, typeMap)) return false;
      if (query) {
        const hay = `${r.student.studentId} ${r.student.realName} ${rankboardCollege(r.person, r.student)} ${r.user?.uname || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [data.rows, collegeFilter, yearFilter, typeFilter, ladderGroupSelected, search, typeMap]);

  const top3 = data.rows.slice(0, 3);
  const statsMode = isRankboardStatsMode({
    typeFilterSize: typeFilter.size,
    ladderGroupSelected,
    schoolFilter: collegeFilter,
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

  const boardRows = useMemo(() => {
    const people: BoardTableRow[] = tableRows.map((row) => ({
      key: row.person._id,
      rank: row.rank,
      kind: 'person',
      name: row.student.realName,
      studentId: row.student.studentId,
      college: rankboardCollege(row.person, row.student),
      employment: row.person.employmentStatus || '',
      counts: tallyAwards(row.person.awards, typeMap),
      ladderCounts: Object.fromEntries(LADDER_DETAIL_COLUMNS.map((column) => [column.key, ladderColumnCount(row.person.awards, typeMap, column.key)])),
      nAccept: row.user ? row.user.nAccept : null,
      totalScore: row.totalScore,
      personCount: 0,
      source: row,
    }));
    if (!tableTotals) return people;
    people.push({
      key: 'total',
      rank: 0,
      kind: 'total',
      name: '',
      studentId: '',
      college: '',
      employment: '',
      counts: tableTotals.tally,
      ladderCounts: tableTotals.ladderColumns,
      nAccept: tableTotals.nAccept,
      totalScore: tableTotals.totalScore,
      personCount: tableRows.length,
      source: null,
    });
    return people;
  }, [tableRows, tableTotals, typeMap]);

  const columns = leaderboardColumns(showLadderDetails);
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
    <Page width="full">
      <PageHeader
        title="中国民航大学荣誉榜"
        description={`共 ${data.rows.length} 人 · 基础分 ${data.config.baseScore} · 衰减 ${data.config.decayFactor}`}
        actions={(
          <Button asChild variant="secondary" size="sm">
            <a href="/rankboard/gallery">荣誉照片墙</a>
          </Button>
        )}
      />

      {top3.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {top3.map((row, index) => (
            <PodiumCard key={row.person._id} row={row} rank={index + 1} />
          ))}
          {Array.from({ length: 3 - top3.length }).map((_, index) => (
            <div key={`empty-${index}`} className="flex items-center justify-center rounded-lg border border-dashed border-line bg-surface-sunken p-5 text-center text-xs text-fg-subtle">
              暂无第 {top3.length + index + 1} 名
            </div>
          ))}
        </div>
      ) : null}

      <Toolbar>
        <SearchInput
          className="min-w-0 flex-1"
          placeholder="搜索学号 / 姓名"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SimpleSelect
          value={collegeFilter}
          onValueChange={setCollegeFilter}
          className="w-40"
          options={[{ value: 'all', label: '全部学院' }, ...colleges.map((college) => ({ value: college, label: college }))]}
        />
        <SimpleSelect
          value={yearFilter}
          onValueChange={setYearFilter}
          className="w-32"
          options={[{ value: 'all', label: '全部年级' }, ...enrollmentYears.map((year) => ({ value: String(year), label: `${year} 级` }))]}
        />
      </Toolbar>

      <Panel
        title="奖项类型"
        actions={filterActive ? (
          <div className="flex items-center gap-2">
            <Badge tone="neutral" size="sm">{typeFilter.size + (ladderGroupSelected ? 1 : 0)}</Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTypeFilter(new Set());
                setLadderGroupSelected(false);
                setShowAllLadderDetails(false);
              }}
            >
              清除筛选
            </Button>
          </div>
        ) : undefined}
      >
        <div className="flex flex-wrap gap-3">
          {filterGroups.map((group) => {
            const keys = group.items.map((item) => item.key);
            const selectedCount = group.id === 'ladder'
              ? (ladderGroupSelected ? keys.length : keys.filter((key) => typeFilter.has(key)).length)
              : keys.filter((key) => typeFilter.has(key)).length;
            const parentOn = group.id === 'ladder' ? ladderGroupSelected : keys.length > 0 && keys.every((key) => typeFilter.has(key));
            return (
              <section key={group.id} className="min-w-48 flex-1 rounded-md bg-surface-sunken p-3">
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
      </Panel>

      <Panel flush>
        <DataTable
          mobile="scroll"
          columns={columns}
          rows={boardRows}
          rowKey={(row) => row.key}
          rowHref={rankboardRowHref}
          empty={(
            <EmptyState
              compact
              title={data.rows.length === 0 ? '荣誉榜暂无成员，等待管理员添加。' : '当前筛选下没有匹配的成员。'}
            />
          )}
        />
      </Panel>
    </Page>
  );
}

export function RankBoardDetailPage() {
  const data = useBootstrap().page.data as {
    row: LeaderboardRow;
    awardTypes: AwardType[];
  };
  const typeMap = new Map(data.awardTypes.map((type) => [type.key, type]));
  const college = rankboardCollege(data.row.person, data.row.student);
  return (
    <Page width="wide">
      <PageHeader
        title={data.row.student.realName}
        description={(
          <>
            第 <span className="tabular font-semibold">{data.row.rank}</span> 名 · <span className="tabular">{data.row.totalScore.toFixed(1)}</span> 分
          </>
        )}
        actions={(
          <Button variant="ghost" size="sm" asChild>
            <a href="/rankboard">
              <ChevronRight className="size-3.5 rotate-180" />
              返回荣誉榜
            </a>
          </Button>
        )}
      />
      <Panel>
        <div className="space-y-2">
          <p className="font-mono text-sm text-fg-muted">{data.row.student.studentId}</p>
          {college ? <p className="text-xs text-fg-muted">学院：{college}</p> : null}
          {data.row.user && data.row.student.boundUserId ? (
            <p className="text-xs text-fg-muted">
              OJ：
              <a href={`/user/${data.row.student.boundUserId}`} className="text-brand-fg hover:underline">
                {data.row.user.uname}
              </a>{' '}
              · 通过 {data.row.user.nAccept} 题
            </p>
          ) : null}
          {data.row.person.employmentStatus ? <p className="text-xs text-fg-muted">就业去向：{data.row.person.employmentStatus}</p> : null}
        </div>
      </Panel>
      <h2 className="text-lg font-semibold">奖项（{data.row.awardCount}）</h2>
      <div className="grid w-full min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.row.person.awards.map((award, index) => {
          const type = typeMap.get(award.type);
          return (
            <AwardCard
              key={`${award.type}-${index}`}
              award={award}
              typeName={type?.name || award.type}
              score={data.row.awardScores[index] || 0}
              plainMeta
            />
          );
        })}
      </div>
    </Page>
  );
}
