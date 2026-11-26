import type { ActivityBoard, ActivityRankingPage, RankingBoard, RankingPeriod } from '@hydrooj/common/activity-ranking';
import { ChevronLeft, ChevronRight, Medal } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DateTime } from '@/components/ui/datetime';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { makeInitials, replaceRouteTokens } from '@/lib/format';
import { MEDAL_TEXT_CLASS, rankMedal } from './rankboard/award-display';

const boards = [
  { value: 'solves', label: '过题榜' },
  { value: 'newcomers', label: '新人榜' },
  { value: 'consistency', label: '坚持榜' },
  { value: 'rp', label: 'RP 总榜' },
] as const;

const descriptions: Record<ActivityBoard, string> = {
  solves: '每道程序设计、函数或程序填空题首次公开通过时计 1 题。',
  newcomers: '从首次公开过题当天起，在前 30 天内新过的题计入新人榜。',
  consistency: '每个有新过题的自然日计 1 天。天数相同的用户并列。',
};
const periodLabels: Record<RankingPeriod, string> = { day: '日榜', week: '周榜', month: '月榜' };
const currentLabels: Record<RankingPeriod, string> = { day: '今日', week: '本周', month: '本月' };
const periodOptions: RankingPeriod[] = ['day', 'week', 'month'];

function boardUrl(base: string, board: RankingBoard, period: RankingPeriod = 'week', date?: string) {
  const params = new URLSearchParams({ board });
  if (board !== 'rp') {
    params.set('period', board === 'consistency' && period === 'day' ? 'week' : period);
    if (date) params.set('date', date);
  }
  return `${base}?${params.toString()}`;
}

export function RankingTabs({ board, period, date }: { board: RankingBoard; period?: RankingPeriod; date?: string }) {
  const { urls } = useBootstrap();
  const items = boards.map((item) => ({ ...item, href: boardUrl(urls.ranking, item.value, period, date) }));
  return <PageTabs value={board} aria-label="榜单类型" items={items} />;
}

export function RankCell({ rank }: { rank: number | string }) {
  const medal = rankMedal(Number(rank));
  return (
    <span className={cn('inline-flex items-center justify-center gap-1 font-semibold tabular', medal ? MEDAL_TEXT_CLASS[medal] : 'text-fg-muted')}>
      {medal ? <Medal className="size-4" aria-hidden="true" /> : null}
      {rank || '—'}
    </span>
  );
}

function PeriodStep({ previous, href }: { previous?: boolean; href?: string }) {
  const label = previous ? '上一周期' : '下一周期';
  const icon = previous ? <ChevronLeft /> : <ChevronRight />;
  if (!href) return <Button type="button" size="sm" variant="ghost" iconOnly disabled aria-label={label}>{icon}</Button>;
  return <Button asChild size="sm" variant="ghost" iconOnly><a href={href} aria-label={label}>{icon}</a></Button>;
}

export function ActivityRanking({ activity }: { activity: ActivityRankingPage }) {
  const { urls, user } = useBootstrap();
  const { board, period, date, today, window: range, earliest, mine } = activity;
  const current = range.through >= today;
  const anchor = date === today ? undefined : date;
  const link = (day?: string) => boardUrl(urls.ranking, board, period, day);
  const periods = board === 'consistency' ? periodOptions.filter((p) => p !== 'day') : periodOptions;
  const dateRange = range.from === range.through ? range.from : `${range.from} 至 ${range.through}`;
  type Row = ActivityRankingPage['rows'][number];
  const solves: Column<Row> = { key: 'solves', header: '新过题数', align: 'right', width: '4.75rem',
    cell: (row) => <span className="tabular font-semibold">{row.solves}</span> };
  const days: Column<Row> = { key: 'days', header: '过题天数', align: 'right', width: '4.75rem',
    cell: (row) => <span className="tabular font-semibold">{row.activeDays}</span> };
  const columns: Column<Row>[] = [
    { key: 'rank', header: '名次', width: '3.5rem', align: 'center', cell: (row) => <RankCell rank={row.rank} /> },
    { key: 'user', header: '用户', cell: (row) => (
      <a className="flex min-w-0 items-center gap-2 text-fg hover:text-brand-fg" href={replaceRouteTokens(urls.userDetail, { UID: String(row.uid) })}>
        <Avatar className="hidden size-7 shrink-0 sm:flex">
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback>{makeInitials(row.uname)}</AvatarFallback>
        </Avatar>
        <span className="max-w-32 truncate font-medium sm:max-w-80" title={row.uname}>{row.uname}</span>
        {row.uid === user.id ? <Badge size="sm" tone="neutral">我</Badge> : null}
      </a>
    ) },
    ...(board === 'consistency' ? [days, solves] : [solves]),
  ];

  return (
    <Page width="wide">
      <PageHeader title="排名" description={descriptions[board]} tabs={<RankingTabs board={board} period={period} date={anchor} />} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <MiniTabs
          size="md"
          aria-label="统计周期"
          value={period}
          items={periods.map((value) => ({
            value, label: anchor ? periodLabels[value] : currentLabels[value], href: boardUrl(urls.ranking, board, value, anchor),
          }))}
        />
        <form method="get" action={urls.ranking} aria-label="查看历史榜单" className="flex max-w-full flex-wrap items-center gap-2">
          <input type="hidden" name="board" value={board} />
          <input type="hidden" name="period" value={period} />
          <Input type="date" name="date" aria-label="榜单日期" key={date} defaultValue={date} min={earliest ?? undefined} max={today} required className="w-36" />
          <Button type="submit" variant="secondary" size="sm">查看</Button>
          {!current && <Button asChild variant="link" size="sm"><a href={link()}>回到{currentLabels[period]}</a></Button>}
        </form>
      </div>
      <Panel flush className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <PeriodStep previous href={earliest && range.previous >= earliest ? link(range.previous) : undefined} />
              <h2 className="text-sm font-semibold tabular sm:text-md">{dateRange}</h2>
              <PeriodStep href={range.next <= today ? link(range.next) : undefined} />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">{activity.count} 人上榜 · 北京时间 <DateTime value={activity.updatedAt} /> 更新</p>
          </div>
          {user.signedIn && (
            <div className="text-sm text-fg-muted">
              我的名次 <strong className="ml-1 text-fg tabular">{mine ? `第 ${mine.rank} 名` : '未上榜'}</strong>
              {mine && <span className="ml-2 text-xs">{board === 'consistency' ? `${mine.activeDays} 天` : `${mine.solves} 题`}</span>}
            </div>
          )}
        </div>
        <DataTable
          columns={columns}
          mobile="scroll"
          rows={activity.rows}
          rowKey={(row) => String(row.uid)}
          empty={<EmptyState compact title="这段时间暂无上榜用户" description="可以切换周期或查看其他日期。" />}
        />
      </Panel>
      <Pagination current={activity.page} total={activity.pages} baseUrl={link(anchor)} />
    </Page>
  );
}
