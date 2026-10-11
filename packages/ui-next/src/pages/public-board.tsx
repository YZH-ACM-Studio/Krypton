/**
 * Public showcase board for a finished individual IOI contest
 * (`/board/:series/:year`, e.g. /board/caucgplt/2026).
 *
 * The server ranks, awards and marks every row (hydrooj lib/public-contest-board.ts).
 * This page only presents: award lines inside the table, filters that carry the
 * counts, and the rules behind a dialog so the board stays the first thing on screen.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Crown, Info, Medal, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatDateTime, resolveUiLocale } from '@/lib/format';
import { MEDAL_TEXT_CLASS, MEDAL_TONE, rankMedal, type MedalMetal } from '@/pages/rankboard/award-display';

type AwardTier = 0 | 1 | 2 | 3;
type LuckyKind = 'big' | 'small';

interface BoardCell {
  score: number;
  seconds: number | null;
  full: boolean;
  firstBlood: boolean;
}

interface BoardRow {
  uid: number;
  rank: number | null;
  /** Overall place with stars counted; 幸运柒 draws on it. */
  place: number;
  score: number;
  passed: number;
  seconds: number;
  ak: boolean;
  award: AwardTier;
  lucky: LuckyKind | null;
  cells: Array<BoardCell | null>;
  uname: string;
  studentId: string | null;
  realName: string | null;
}

interface BoardColumn {
  pid: number;
  label: string;
  title: string;
  maxScore: number;
  nAccept: number;
  nSubmit: number;
}

interface BoardHeader {
  overline: string;
  title: string;
  beginAt: string;
  endAt: string;
  problemCount: number;
  published: boolean;
  maxScore?: number;
  entrants?: number;
}

interface PublishedBoard {
  board: BoardHeader & { maxScore: number; entrants: number };
  columns: BoardColumn[];
  rows: BoardRow[];
  awards: { denominator: number; percents: number[]; quotas: number[]; counts: number[]; minScores: Array<number | null> };
  lucky: { bigRanks: number[]; yuan: Record<LuckyKind, number> };
}

type PublicBoardPayload = { board: BoardHeader & { published: false } } | PublishedBoard;

type FilterKey = 'all' | 't1' | 't2' | 't3' | 'lucky' | 'ak' | 'star';
type ZoneKey = 't1' | 't2' | 't3' | 'rest' | 'none';

const AWARD_NAME = ['一等奖', '二等奖', '三等奖'] as const;
const AWARD_METAL: readonly MedalMetal[] = ['gold', 'silver', 'bronze'];
const AWARD_ICON = { gold: Crown, silver: Trophy, bronze: Medal } as const;
/** Same metals as the honour board: gold is warning, silver neutral, bronze orange. */
const METAL_DOT: Record<MedalMetal, string> = { gold: 'bg-warning', silver: 'bg-fg-subtle', bronze: 'bg-orange' };

const two = (value: number) => String(value).padStart(2, '0');
/** Hydro's scoreboard clock: HH:MM:SS, hours may exceed 24. */
export function formatBoardSeconds(seconds: number): string {
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
}

function awardMetal(award: AwardTier): MedalMetal | null {
  return award === 0 ? null : AWARD_METAL[award - 1];
}

function rowMatchesFilter(row: BoardRow, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 't1') return row.award === 1;
  if (filter === 't2') return row.award === 2;
  if (filter === 't3') return row.award === 3;
  if (filter === 'lucky') return row.lucky !== null;
  if (filter === 'ak') return row.ak;
  return row.rank === null;
}

function rowMatchesQuery(row: BoardRow, query: string): boolean {
  if (!query) return true;
  return [row.realName, row.studentId, row.uname].some((value) => value !== null && value.toLowerCase().includes(query));
}

function officialZone(row: BoardRow): ZoneKey {
  if (row.passed === 0) return 'none';
  return row.award === 0 ? 'rest' : (`t${row.award}` as ZoneKey);
}

/** A star joins the zone of the official row above it, or below it when it leads the board. */
export function boardZones(rows: readonly BoardRow[]): ZoneKey[] {
  const zones: Array<ZoneKey | null> = rows.map((row) => (row.rank === null && row.passed > 0 ? null : officialZone(row)));
  for (let index = 0; index < zones.length; index++) {
    if (zones[index] !== null) continue;
    const before = zones.slice(0, index).reverse().find((zone) => zone !== null);
    const after = zones.slice(index + 1).find((zone) => zone !== null);
    zones[index] = before ?? after ?? 'rest';
  }
  return zones as ZoneKey[];
}

function AkMark() {
  return (
    <span
      className="inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-sm bg-success px-1.5 text-2xs font-semibold tracking-wider text-on-success outline outline-success-line outline-offset-1"
      title="AK：比赛时间内全部题目满分"
    >
      <Crown className="size-3" aria-hidden="true" />
      AK
    </span>
  );
}

/** The place can differ from the rank column, because stars count here. So the badge carries it. */
function LuckyMark({ kind, yuan, place }: { kind: LuckyKind; yuan: number; place: number }) {
  const big = kind === 'big';
  return (
    <Badge tone="violet" size="sm" className="pl-0" title={`幸运柒 · 含打星总排第 ${place} 名 · ${big ? '大吉' : '小吉'} ${yuan} 元`}>
      <span className={cn('grid size-4.5 place-items-center rounded-sm', big ? 'bg-violet text-white' : 'ring-1 ring-violet-line ring-inset')}>柒</span>
      {big ? '大吉' : '小吉'}
      <span className="tabular">#{place}</span>
    </Badge>
  );
}

function AwardMark({ award }: { award: AwardTier }) {
  const metal = awardMetal(award);
  if (!metal) return null;
  const Icon = AWARD_ICON[metal];
  return (
    <Badge tone={MEDAL_TONE[metal]} size="sm">
      <Icon className="size-3" aria-hidden="true" />
      {AWARD_NAME[award - 1]}
    </Badge>
  );
}

function cellTone(cell: BoardCell): string {
  if (cell.firstBlood) return 'bg-success text-on-success';
  if (cell.full) return 'bg-success-soft text-success-fg';
  return cell.score > 0 ? 'bg-warning-soft text-warning-fg' : 'bg-danger-soft text-danger-fg';
}

function BoardMeta({ board, locale }: { board: BoardHeader; locale: string }) {
  const ended = Date.now() >= new Date(board.endAt).getTime();
  const endTime = new Intl.DateTimeFormat(resolveUiLocale(locale), { timeStyle: 'short' }).format(new Date(board.endAt));
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={ended ? 'neutral' : 'info'} />
        {ended ? '已结束' : '未结束'}
      </span>
      <span className="tabular">
        {formatDateTime(board.beginAt, locale)} – {endTime}
      </span>
      <span>
        IOI · {board.problemCount} 题{board.maxScore !== undefined ? <> · 满分 <span className="tabular">{board.maxScore}</span></> : null}
      </span>
      {board.entrants !== undefined ? (
        <span>
          <span className="tabular">{board.entrants}</span> 人参赛
        </span>
      ) : null}
    </>
  );
}

function RulesDialog({ data, open, onOpenChange }: { data: PublishedBoard; open: boolean; onOpenChange(open: boolean): void }) {
  const { awards, lucky, columns } = data;
  const rules: Array<[string, ReactNode]> = [
    ['排名', '总分 → 过题数 → 总时间，前两项多者在前，总时间少者在前。'],
    [
      '奖项',
      `以过题 ≥ 1 的 ${awards.denominator} 人为基数（含打星），一等 ${awards.percents[0]}%、二等 ${awards.percents[1]}%、三等 ${awards.percents[2]}%，向上取整，共 ${awards.quotas.join(' / ')} 人。分数线上并列同获较高奖。`,
    ],
    ['打星', '照常显示成绩，不占正式名次、不获奖，名额顺延给正式选手；参与幸运柒。'],
    ['AK', `比赛时间内 ${columns.length} 题全部满分。`],
    [
      '幸运柒',
      `按含打星的总排名：第 ${lucky.bigRanks.join('、')} 名为大吉，${lucky.yuan.big} 元；其余个位为 7 的名次为小吉，${lucky.yuan.small} 元。未过题的选手不参与。`,
    ],
  ];
  const swatches: Array<[string, string, string]> = [
    ['bg-success-soft text-success-fg', '5', '满分'],
    ['bg-warning-soft text-warning-fg', '12', '部分分'],
    ['bg-danger-soft text-danger-fg', '0', '0 分'],
    ['bg-success text-on-success', '25', '一血'],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>评奖规则</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2.5 text-sm">
            {rules.map(([term, detail]) => (
              <div key={term} className="grid grid-cols-[4rem_1fr] gap-3">
                <dt className="text-fg-subtle">{term}</dt>
                <dd className="text-fg text-pretty">{detail}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line-subtle pt-3.5 text-xs text-fg-muted">
            {swatches.map(([tone, sample, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className={cn('grid h-4.5 w-6 place-items-center rounded-sm text-2xs font-semibold tabular', tone)}>{sample}</span>
                {label}
              </span>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Board({ data }: { data: PublishedBoard }) {
  const { rows, columns, awards, lucky } = data;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [showTime, setShowTime] = useState(true);
  const normalizedQuery = query.trim().toLowerCase();
  const zones = useMemo(() => boardZones(rows), [rows]);

  const tabs = useMemo(() => {
    const count = (key: FilterKey) => rows.filter((row) => rowMatchesFilter(row, key)).length;
    const items: Array<MiniTabItem<FilterKey>> = [
      { value: 'all', label: '全部', count: rows.length },
      ...AWARD_METAL.map((metal, index) => ({
        value: `t${index + 1}` as FilterKey,
        label: AWARD_NAME[index],
        count: awards.counts[index],
        icon: <span className={cn('size-1.5 rounded-full', METAL_DOT[metal])} />,
      })),
      { value: 'lucky', label: '幸运柒', count: count('lucky') },
      { value: 'ak', label: 'AK', count: count('ak') },
      { value: 'star', label: '打星', count: count('star') },
    ];
    // AK and 打星 tabs only appear when somebody has them.
    return items.filter((item) => (item.value !== 'ak' && item.value !== 'star') || (item.count ?? 0) > 0);
  }, [rows, awards.counts]);

  const visible = rows
    .map((row, index) => ({ row, zone: zones[index] }))
    .filter(({ row }) => rowMatchesFilter(row, filter) && rowMatchesQuery(row, normalizedQuery));
  const zoned = filter === 'all' && !normalizedQuery;
  const columnCount = 6 + columns.length;

  const zoneLabel = (zone: ZoneKey): ReactNode => {
    if (zone === 'rest') return <span className="font-semibold text-fg">未获奖</span>;
    if (zone === 'none') return <span className="font-semibold text-fg">未过题</span>;
    const index = Number(zone[1]) - 1;
    return (
      <>
        <span className={cn('size-2 rounded-full', METAL_DOT[AWARD_METAL[index]])} />
        <span className="font-semibold text-fg">{AWARD_NAME[index]}</span>
        <span className="tabular">
          {awards.counts[index]} 人 · 最低 {awards.minScores[index] ?? '—'} 分
        </span>
      </>
    );
  };

  const body: ReactNode[] = [];
  let currentZone: ZoneKey | null = null;
  for (const { row, zone } of visible) {
    if (zoned && zone !== currentZone) {
      currentZone = zone;
      body.push(
        <TableRow key={`zone-${zone}`} data-zone={zone} className="hover:bg-transparent">
          <TableCell colSpan={columnCount} className="h-8 bg-surface-sunken p-0">
            <span className="sticky left-0 inline-flex items-center gap-2 px-4 text-xs text-fg-subtle">{zoneLabel(zone)}</span>
          </TableCell>
        </TableRow>,
      );
    }
    body.push(<BoardRowView key={row.uid} row={row} columns={columns} yuan={lucky.yuan} showTime={showTime} />);
  }

  return (
    <>
      <Toolbar
        end={(
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <Switch size="sm" checked={showTime} onCheckedChange={setShowTime} />
            每题用时
          </label>
        )}
      >
        <SearchInput
          size="sm"
          className="w-full sm:w-64"
          placeholder="搜索姓名、学号或用户名"
          aria-label="搜索选手"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <MiniTabs value={filter} onValueChange={setFilter} items={tabs} aria-label="筛选" />
      </Toolbar>

      <Panel flush>
        {visible.length === 0 ? (
          <EmptyState compact title="没有符合条件的选手。" />
        ) : (
          <Table orientation="both" density="flush" shellClassName="max-h-(--workspace-h)" className="min-w-max">
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 h-10 w-14 min-w-14 text-center">#</TableHead>
                <TableHead className="sticky left-14 z-20 h-10 w-40 min-w-40 max-w-40 border-r border-line sm:w-52 sm:min-w-52 sm:max-w-52">选手</TableHead>
                <TableHead className="h-10 min-w-40">奖项</TableHead>
                <TableHead className="h-10 min-w-16 text-right">总分</TableHead>
                <TableHead className="h-10 min-w-12 text-right">过题</TableHead>
                <TableHead className="h-10 min-w-20 text-right">总时间</TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.pid}
                    className="h-10 border-l border-line-subtle px-1 text-center"
                    title={`${column.label} ${column.title}\n满分 ${column.maxScore} 分 · ${column.nAccept} 人满分 · 共 ${column.nSubmit} 次提交`}
                  >
                    <span className="block font-semibold text-fg">{column.label}</span>
                    <span className="block text-2xs tabular">
                      {column.nAccept}/{column.nSubmit}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{body}</TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}

function BoardRowView({ row, columns, yuan, showTime }: { row: BoardRow; columns: BoardColumn[]; yuan: Record<LuckyKind, number>; showTime: boolean }) {
  const medal = row.rank === null ? null : rankMedal(row.rank);
  const pinned = 'bg-surface group-hover:bg-surface-hover';
  const height = showTime ? 'h-12' : 'h-10';
  const secondLine = [row.studentId, row.realName ? row.uname : null].filter((part): part is string => !!part);
  return (
    <TableRow className="group" data-uid={row.uid}>
      <TableCell className={cn('sticky left-0 z-10 w-14 min-w-14 text-center 3xl:text-md', height, pinned)}>
        {row.rank === null ? (
          <span className="font-mono text-sm text-fg-subtle" title="打星">
            *
          </span>
        ) : (
          <span className={cn('font-mono text-sm tabular', medal ? cn('font-bold', MEDAL_TEXT_CLASS[medal]) : 'text-fg-subtle')}>{row.rank}</span>
        )}
      </TableCell>
      <TableCell className={cn('sticky left-14 z-10 w-40 min-w-40 max-w-40 border-r border-line sm:w-52 sm:min-w-52 sm:max-w-52', height, pinned)}>
        <div className="flex min-w-0 flex-col leading-tight">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium 3xl:text-md">{row.realName ?? row.uname}</span>
            {row.ak ? <AkMark /> : null}
            {row.rank === null ? (
              <Badge variant="outline" tone="neutral" size="sm">
                打星
              </Badge>
            ) : null}
          </div>
          {secondLine.length ? <span className="mt-0.5 truncate font-mono text-2xs text-fg-subtle">{secondLine.join(' · ')}</span> : null}
        </div>
      </TableCell>
      <TableCell className={cn('min-w-40', height)}>
        <span className="inline-flex items-center gap-1.5">
          <AwardMark award={row.award} />
          {row.lucky ? <LuckyMark kind={row.lucky} yuan={yuan[row.lucky]} place={row.place} /> : null}
        </span>
      </TableCell>
      <TableCell className={cn('min-w-16 text-right text-md font-semibold tabular 3xl:text-lg', height)}>{row.score}</TableCell>
      <TableCell className={cn('min-w-12 text-right tabular 3xl:text-md', height)}>{row.passed}</TableCell>
      <TableCell className={cn('min-w-20 text-right tabular text-fg-muted 3xl:text-md', height)}>{row.passed ? formatBoardSeconds(row.seconds) : '—'}</TableCell>
      {row.cells.map((cell, index) => {
        const column = columns[index];
        if (!cell) return <TableCell key={column.pid} className={cn('w-16 min-w-16 border-l border-line-subtle px-1', height)} />;
        const time = cell.seconds === null ? null : formatBoardSeconds(cell.seconds);
        return (
          <TableCell
            key={column.pid}
            data-cell={cell.firstBlood ? 'first-blood' : cell.full ? 'full' : cell.score > 0 ? 'partial' : 'zero'}
            className={cn('w-16 min-w-16 border-l border-line-subtle px-1 text-center leading-tight tabular 3xl:text-md', height, cellTone(cell))}
            title={`${column.label} ${column.title} · ${cell.score}/${column.maxScore} 分${time ? ` · ${time}` : ''}${cell.firstBlood ? ' · 一血' : ''}`}
          >
            <span className="block font-semibold">{cell.score}</span>
            {showTime && time ? <span className="block text-2xs">{time}</span> : null}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

export function PublicBoardPage() {
  const bs = useBootstrap();
  const data = bs.page.data as PublicBoardPayload;
  const [rulesOpen, setRulesOpen] = useState(false);
  const header = (
    <PageHeader
      breadcrumb={<p className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{data.board.overline}</p>}
      title={data.board.title}
      meta={<BoardMeta board={data.board} locale={bs.locale} />}
      actions={data.board.published ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setRulesOpen(true)}>
          <Info aria-hidden="true" />
          评奖规则
        </Button>
      ) : null}
    />
  );

  if (!('rows' in data)) {
    return (
      <Page width="full">
        {header}
        <Panel>
          <EmptyState icon={<Trophy />} title="成绩尚未公布。" description="比赛结束并解除封榜后，这里会显示终榜和获奖名单。" />
        </Panel>
      </Page>
    );
  }

  return (
    <Page width="full">
      {header}
      <Board data={data} />
      <RulesDialog data={data} open={rulesOpen} onOpenChange={setRulesOpen} />
    </Page>
  );
}
