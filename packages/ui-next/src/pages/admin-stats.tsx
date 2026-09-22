import { type ReactNode, useState } from 'react';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import { Download, LineChart as LineChartIcon, Search } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { StatsGroupFields } from '@/components/stats-group-filter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EChart } from '@/components/ui/echart';
import type { KryptonEChartsOption } from '@/components/ui/echart';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { PRIV } from '@/lib/perms';

interface SelectorDoc {
  docId: string;
  title: string;
  rule?: string;
}

interface ProblemSummary {
  docId: number;
  pid?: string;
  title: string;
}

interface ContestStats {
  total: number;
  accepted: number;
  participants: number;
  passRate?: number | null;
  submitsPerParticipant?: number;
  byProblem: Array<{ pid: number; total: number; accepted: number }>;
  byHour: Array<{ hour: string; count: number; accepted?: number }>;
  byLanguage: Array<{ language: string; count: number }>;
}

interface TrainingStats {
  enrollmentCount: number;
  problemCount: number;
  averageProgress?: number;
  medianProgress?: number;
  byProblem: Array<{ pid: number; completed: number }>;
  progressDistribution: Array<{ label: string; count: number }>;
  members: Array<{
    uid: number;
    uname: string;
    studentId?: string;
    realName?: string;
    done: number;
    total: number;
    progress: number;
  }>;
}

type StatsView = 'contest' | 'training' | 'user' | 'group' | 'dashboard' | 'problem';

interface UserStats {
  total: number;
  accepted: number;
  activeDays: number;
  byDay: Array<{ day: string; total: number; accepted: number }>;
  student: { studentId?: string; realName?: string } | null;
  contests: SelectorDoc[];
  trainings: SelectorDoc[];
}

interface GroupStatsRow {
  id: string;
  name: string;
  memberCount: number;
  activeMembers: number;
  averageSubmissions: number;
  averageAccepted: number;
}

interface DashboardStats {
  total: number;
  accepted: number;
  participants: number;
  byDay: Array<{ day: string; total: number; accepted: number; activeUsers: number }>;
}

interface ProblemStats {
  selectedTag: string;
  difficulty: Array<{
    pid: number;
    displayId: string;
    title: string;
    total: number;
    accepted: number;
    wrongAnswer: number;
    timeLimit: number;
    compileError: number;
    passRate: number | null;
  }>;
  errors: { wrongAnswer: number; timeLimit: number; compileError: number };
}

interface AdminStatsData {
  view: StatsView;
  contests: SelectorDoc[];
  trainings: SelectorDoc[];
  selectedContest: (SelectorDoc & { pids: number[] }) | null;
  selectedTraining: (SelectorDoc & { dag: unknown[] }) | null;
  stats: ContestStats | TrainingStats | UserStats | GroupStatsRow[] | DashboardStats | ProblemStats | null;
  problems: ProblemSummary[];
  groups: Array<{ _id: string; name: string; archivedAt?: string }>;
  userSearchResults: Array<{ _id: number; uname: string }>;
  selectedUser: { uid: number; uname: string } | null;
  q: string;
  groupIds: string[];
  groupMemberCount: number | null;
  range: 30 | 90;
  tag: string;
  maxTimeMs: number;
}

type CsvCell = string | number | null | undefined;
type CartesianSeries = BarSeriesOption | LineSeriesOption;

const CHART_CLASS = 'h-[280px] w-full min-w-0';

function csvCell(value: CsvCell) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CsvButton({
  filename,
  headers,
  rows,
  disabled = false,
}: {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={() => downloadCsv(filename, headers, rows)}>
      <Download className="mr-1.5 size-4" />
      导出 CSV
    </Button>
  );
}

function formatRatio(numerator: number, denominator: number): string {
  if (!denominator) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatPercent(value: number | null | undefined, asRatio = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(asRatio ? value * 100 : value).toFixed(1)}%`;
}

function formatFixed(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function truncateLabel(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function cartesianOption({
  labels,
  series,
  dualY = false,
  boundaryGap,
}: {
  labels: string[];
  series: CartesianSeries[];
  dualY?: boolean;
  boundaryGap?: boolean;
}): KryptonEChartsOption {
  return {
    animationDuration: 280,
    tooltip: { trigger: 'axis', confine: true },
    legend: { top: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    grid: { left: 8, right: 8, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: boundaryGap ?? !dualY,
      axisLabel: { hideOverlap: true, formatter: truncateLabel },
    },
    yAxis: dualY
      ? [
          { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed', opacity: 0.45 } } },
          { type: 'value', minInterval: 1, splitLine: { show: false } },
        ]
      : { type: 'value', minInterval: 1, splitLine: { lineStyle: { type: 'dashed', opacity: 0.45 } } },
    series,
  };
}

function pieOption(rows: Array<{ name: string; value: number }>): KryptonEChartsOption {
  return {
    animationDuration: 280,
    tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    series: [
      {
        type: 'pie',
        radius: ['46%', '70%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        label: { formatter: '{b}\n{d}%' },
        data: rows,
      },
    ],
  };
}

function lineSeries(name: string, data: number[], extra?: Pick<LineSeriesOption, 'areaStyle' | 'yAxisIndex'>): LineSeriesOption {
  return {
    name,
    type: 'line',
    smooth: true,
    showSymbol: false,
    data,
    ...extra,
  };
}

function barSeries(name: string, data: number[]): BarSeriesOption {
  return { name, type: 'bar', barMaxWidth: 22, data };
}

function MetricCard({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: number | string;
  detail?: string;
  className?: string;
}) {
  return (
    <Card className={cn('h-full w-full min-w-0 shadow-none', className)}>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {detail ? <p className="text-[11px] text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid w-full min-w-0 grid-cols-12 gap-3">{children}</div>;
}

function kpiSpan(count: number): string {
  return count % 4 === 0 ? 'col-span-12 sm:col-span-3' : 'col-span-12 sm:col-span-4';
}

function ChartPanel({
  title,
  empty,
  emptyLabel,
  option,
  className,
}: {
  title: ReactNode;
  empty: boolean;
  emptyLabel: string;
  option: KryptonEChartsOption;
  className?: string;
}) {
  return (
    <Card className={cn('w-full min-w-0 shadow-none', className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <EChart option={option} className={CHART_CLASS} />
        )}
      </CardContent>
    </Card>
  );
}

function problemLabel(problemById: Map<number, ProblemSummary>, pid: number): string {
  const problem = problemById.get(pid);
  return `${problem?.pid || `#${pid}`} ${problem?.title || ''}`.trim();
}

function Selector({ docs, selectedId }: { docs: SelectorDoc[]; selectedId?: string }) {
  return (
    <form method="get" action="/admin/stats" className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="view" value="training" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="stats-trainingId">
          选择题集
        </label>
        <SimpleSelect
          name="trainingId"
          defaultValue={selectedId || ''}
          options={docs.map((doc) => ({ value: String(doc.docId), label: doc.title }))}
          placeholder={docs.length ? '请选择' : '暂无可统计项目'}
        />
      </div>
      <Button type="submit" disabled={!docs.length}>
        查看
      </Button>
    </form>
  );
}

function ContestView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as ContestStats | null;
  const problemById = new Map(data.problems.map((problem) => [problem.docId, problem]));
  const csvRows: CsvCell[][] = stats
    ? stats.byProblem.map((row) => {
        const problem = problemById.get(row.pid);
        return [problem?.pid || `#${row.pid}`, problem?.title, row.total, row.accepted, formatRatio(row.accepted, row.total)];
      })
    : [];
  const passRate = stats && stats.total ? (stats.passRate ?? stats.accepted / stats.total) : null;
  const submitsPerParticipant = stats && stats.participants ? (stats.submitsPerParticipant ?? stats.total / stats.participants) : null;
  const hourAccepted = Boolean(stats?.byHour.some((row) => typeof row.accepted === 'number'));
  const kpiClass = kpiSpan(5);

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="flex min-w-0 flex-1 flex-col gap-3">
          <input type="hidden" name="view" value="contest" />
          <div className="grid w-full min-w-0 gap-3 lg:grid-cols-2 lg:items-end">
            <div className="min-w-0 space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="stats-contestId">
                选择比赛
              </label>
              <SimpleSelect
                id="stats-contestId"
                name="contestId"
                defaultValue={data.selectedContest?.docId || ''}
                options={data.contests.map((doc) => ({ value: String(doc.docId), label: doc.title }))}
                placeholder={data.contests.length ? '请选择' : '暂无可统计项目'}
              />
            </div>
            <StatsGroupFields
              groups={data.groups || []}
              selectedIds={data.groupIds || []}
              hint="不选则统计全部提交。选择后只统计这些用户组里已绑定学生的提交。"
            />
          </div>
          <div>
            <Button type="submit" disabled={!data.contests.length}>
              查看
            </Button>
          </div>
        </form>
        <CsvButton filename="比赛统计.csv" headers={['题号', '题目', '提交', 'AC', '通过率']} rows={csvRows} disabled={!stats} />
      </div>
      {typeof data.groupMemberCount === 'number' ? (
        <p className="text-sm text-muted-foreground">已按所选用户组过滤，共 {data.groupMemberCount} 名已绑定学生。</p>
      ) : null}
      {!stats || !data.selectedContest ? (
        <Card className="w-full min-w-0 shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无比赛可统计</CardContent>
        </Card>
      ) : (
        <>
          <KpiGrid>
            <MetricCard className={kpiClass} label="总提交" value={stats.total} />
            <MetricCard className={kpiClass} label="AC 提交" value={stats.accepted} detail={stats.total ? `通过率 ${formatRatio(stats.accepted, stats.total)}` : '通过率 —'} />
            <MetricCard className={kpiClass} label="参赛人数" value={stats.participants} />
            <MetricCard className={kpiClass} label="通过率" value={formatPercent(passRate, true)} />
            <MetricCard className={kpiClass} label="人均提交" value={formatFixed(submitsPerParticipant)} />
          </KpiGrid>
          <div className="grid w-full min-w-0 grid-cols-12 gap-4">
            <ChartPanel
              className="col-span-12 lg:col-span-8"
              title="每题通过分布"
              empty={!stats.byProblem.length}
              emptyLabel="暂无"
              option={cartesianOption({
                labels: stats.byProblem.map((row) => problemLabel(problemById, row.pid)),
                series: [barSeries('提交', stats.byProblem.map((row) => row.total)), barSeries('AC', stats.byProblem.map((row) => row.accepted))],
              })}
            />
            <ChartPanel
              className="col-span-12 lg:col-span-4"
              title="语言分布"
              empty={!stats.byLanguage.some((row) => row.count > 0)}
              emptyLabel="暂无"
              option={pieOption(stats.byLanguage.map((row) => ({ name: row.language, value: row.count })))}
            />
            <ChartPanel
              className="col-span-12"
              title={
                <span className="inline-flex items-center gap-2">
                  <LineChartIcon className="size-4" />
                  按小时提交曲线
                </span>
              }
              empty={!stats.byHour.length}
              emptyLabel="暂无曲线数据"
              option={cartesianOption({
                labels: stats.byHour.map((row) => row.hour.replace('T', ' ')),
                dualY: false,
                boundaryGap: false,
                series: [
                  lineSeries('提交', stats.byHour.map((row) => row.count), { areaStyle: { opacity: 0.08 } }),
                  ...(hourAccepted
                    ? [lineSeries('AC 提交', stats.byHour.map((row) => row.accepted ?? 0))]
                    : []),
                ],
              })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TrainingView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as TrainingStats | null;
  const problemById = new Map(data.problems.map((problem) => [problem.docId, problem]));
  const csvRows: CsvCell[][] = stats
    ? stats.members.map((member) => [member.uid, member.uname, member.realName, member.studentId, member.done, member.total, `${member.progress}%`])
    : [];
  const progressValues = stats?.members.map((member) => member.progress) ?? [];
  const averageProgress = progressValues.length ? (stats?.averageProgress ?? mean(progressValues)) : null;
  const medianProgress = progressValues.length ? (stats?.medianProgress ?? median(progressValues)) : null;
  const completedAll = stats ? stats.members.filter((member) => member.progress === 100).length : 0;
  const kpiClass = kpiSpan(5);

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <Selector docs={data.trainings} selectedId={data.selectedTraining?.docId} />
        </div>
        <CsvButton filename="题集成员进度.csv" headers={['UID', '用户名', '姓名', '学号', '完成', '总题数', '完成率']} rows={csvRows} disabled={!stats} />
      </div>
      {!stats || !data.selectedTraining ? (
        <Card className="w-full min-w-0 shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无题集可统计</CardContent>
        </Card>
      ) : (
        <>
          <KpiGrid>
            <MetricCard className={kpiClass} label="报名人数" value={stats.enrollmentCount} />
            <MetricCard className={kpiClass} label="题目数" value={stats.problemCount} />
            <MetricCard
              className={kpiClass}
              label="全部完成"
              value={completedAll}
              detail={stats.enrollmentCount ? formatRatio(completedAll, stats.enrollmentCount) : '—'}
            />
            <MetricCard className={kpiClass} label="平均完成率" value={formatPercent(averageProgress)} />
            <MetricCard className={kpiClass} label="中位完成率" value={formatPercent(medianProgress)} />
          </KpiGrid>
          <div className="grid w-full min-w-0 grid-cols-12 gap-4">
            <ChartPanel
              className="col-span-12 lg:col-span-8"
              title="每题完成人数"
              empty={!stats.byProblem.length}
              emptyLabel="暂无"
              option={cartesianOption({
                labels: stats.byProblem.map((row) => problemLabel(problemById, row.pid)),
                series: [barSeries('完成人数', stats.byProblem.map((row) => row.completed))],
              })}
            />
            <ChartPanel
              className="col-span-12 lg:col-span-4"
              title="完成率分布"
              empty={!stats.progressDistribution.some((row) => row.count > 0)}
              emptyLabel="暂无"
              option={cartesianOption({
                labels: stats.progressDistribution.map((row) => row.label),
                series: [barSeries('人数', stats.progressDistribution.map((row) => row.count))],
              })}
            />
          </div>
          <Card className="w-full min-w-0 shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">成员进度榜</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">成员</TableHead>
                    <TableHead>学号</TableHead>
                    <TableHead className="text-right">完成题数</TableHead>
                    <TableHead className="pr-5 text-right">完成率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.members.map((member) => (
                    <TableRow key={member.uid}>
                      <TableCell className="pl-5">
                        <p className="text-sm font-medium">{member.realName || member.uname}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {member.uname} · UID {member.uid}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{member.studentId || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {member.done}/{member.total}
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-sm">{member.progress}%</TableCell>
                    </TableRow>
                  ))}
                  {!stats.members.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        暂无报名成员
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function UserView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as UserStats | null;
  const kpiClass = kpiSpan(6);

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="flex min-w-0 flex-1 gap-2">
          <input type="hidden" name="view" value="user" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="stats-user-query">
              搜索用户名或显示名
            </label>
            <Input id="stats-user-query" name="q" defaultValue={data.q} placeholder="输入前缀搜索" />
          </div>
          <Button type="submit" className="self-end">
            <Search className="mr-1.5 size-4" />
            搜索
          </Button>
        </form>
        <CsvButton
          filename="用户近30天统计.csv"
          headers={['日期', '提交', 'AC']}
          rows={stats?.byDay.map((row) => [row.day, row.total, row.accepted]) || []}
          disabled={!stats}
        />
      </div>

      {data.q && !data.selectedUser ? (
        <Card className="w-full min-w-0 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">搜索结果</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.userSearchResults.map((user) => (
              <a
                key={user._id}
                href={`/admin/stats?view=user&uid=${user._id}&q=${encodeURIComponent(data.q)}`}
                className="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted"
              >
                <p className="font-medium">{user.uname}</p>
                <p className="text-xs text-muted-foreground">UID {user._id}</p>
              </a>
            ))}
            {!data.userSearchResults.length ? <p className="text-sm text-muted-foreground">没有匹配用户</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {stats && data.selectedUser ? (
        <>
          <Card className="w-full min-w-0 shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{stats.student?.realName || data.selectedUser.uname}</p>
                <p className="text-xs text-muted-foreground">
                  {data.selectedUser.uname} · UID {data.selectedUser.uid}
                  {stats.student?.studentId ? ` · ${stats.student.studentId}` : ''}
                </p>
              </div>
              <a href={`/user/${data.selectedUser.uid}`} className="text-sm text-primary hover:underline">
                查看用户主页
              </a>
            </CardContent>
          </Card>
          <KpiGrid>
            <MetricCard className={kpiClass} label="总提交" value={stats.total} />
            <MetricCard className={kpiClass} label="AC 提交" value={stats.accepted} />
            <MetricCard className={kpiClass} label="通过率" value={formatRatio(stats.accepted, stats.total)} />
            <MetricCard className={kpiClass} label="活跃天数" value={stats.activeDays} />
            <MetricCard className={kpiClass} label="参加的比赛" value={stats.contests.length} />
            <MetricCard className={kpiClass} label="参加的题集" value={stats.trainings.length} />
          </KpiGrid>
          <ChartPanel
            title="近 30 天提交曲线"
            empty={!stats.byDay.length}
            emptyLabel="暂无曲线数据"
            option={cartesianOption({
              labels: stats.byDay.map((row) => row.day),
              boundaryGap: false,
              series: [
                lineSeries('提交', stats.byDay.map((row) => row.total), { areaStyle: { opacity: 0.08 } }),
                lineSeries('AC', stats.byDay.map((row) => row.accepted)),
              ],
            })}
          />
          <div className="grid w-full min-w-0 gap-4 lg:grid-cols-2">
            <Card className="w-full min-w-0 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">参加的比赛</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.contests.map((item) => (
                  <a key={item.docId} className="block text-sm text-primary hover:underline" href={`/contest/${item.docId}`}>
                    {item.title}
                  </a>
                ))}
                {!stats.contests.length ? <p className="text-sm text-muted-foreground">暂无</p> : null}
              </CardContent>
            </Card>
            <Card className="w-full min-w-0 shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">参加的题集</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.trainings.map((item) => (
                  <a key={item.docId} className="block text-sm text-primary hover:underline" href={`/problem-sets/${item.docId}`}>
                    {item.title}
                  </a>
                ))}
                {!stats.trainings.length ? <p className="text-sm text-muted-foreground">暂无</p> : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {!data.q && !data.selectedUser ? (
        <Card className="w-full min-w-0 shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">搜索并选择用户后查看统计</CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function GroupView({ data }: { data: AdminStatsData }) {
  const [selected, setSelected] = useState<string[]>(data.groupIds || []);
  const stats = data.stats as GroupStatsRow[] | null;

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="min-w-0 flex-1 space-y-3">
          <input type="hidden" name="view" value="group" />
          <input type="hidden" name="groupIds" value={selected.join(',')} />
          <div>
            <p className="text-xs text-muted-foreground">选择班级组（可多选）</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.groups.map((group) => {
                const active = selected.includes(group._id);
                return (
                  <button
                    key={group._id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected((current) => (active ? current.filter((id) => id !== group._id) : [...current, group._id]))}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {group.name}
                    {group.archivedAt ? '（已归档）' : ''}
                  </button>
                );
              })}
              {!data.groups.length ? <p className="text-sm text-muted-foreground">暂无班级组</p> : null}
            </div>
          </div>
          <Button type="submit" disabled={!selected.length}>
            比较所选班级
          </Button>
        </form>
        <CsvButton
          filename="班级组对比.csv"
          headers={['班级组', '绑定成员', '活跃成员', '人均提交', '人均AC']}
          rows={stats?.map((row) => [row.name, row.memberCount, row.activeMembers, row.averageSubmissions.toFixed(1), row.averageAccepted.toFixed(1)]) || []}
          disabled={!stats?.length}
        />
      </div>
      {stats ? (
        <div className="grid w-full min-w-0 grid-cols-12 gap-4">
          <Card className="col-span-12 min-w-0 shadow-none">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">班级组</TableHead>
                    <TableHead className="text-right">绑定成员</TableHead>
                    <TableHead className="text-right">活跃成员</TableHead>
                    <TableHead className="text-right">人均提交</TableHead>
                    <TableHead className="text-right">人均 AC</TableHead>
                    <TableHead className="pr-5 text-right">通过率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-5 font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.memberCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.activeMembers}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.averageSubmissions.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.averageAccepted.toFixed(1)}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{formatRatio(row.averageAccepted, row.averageSubmissions)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <ChartPanel
            className="col-span-12"
            title="班级组对比"
            empty={!stats.length}
            emptyLabel="暂无"
            option={cartesianOption({
              labels: stats.map((row) => row.name),
              series: [
                barSeries('人均提交', stats.map((row) => row.averageSubmissions)),
                barSeries('人均AC', stats.map((row) => row.averageAccepted)),
              ],
            })}
          />
        </div>
      ) : (
        <Card className="w-full min-w-0 shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">选择班级组后生成对比</CardContent>
        </Card>
      )}
    </div>
  );
}

function DashboardView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as DashboardStats;
  const kpiClass = kpiSpan(3);

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <MiniTabs
          value={String(data.range)}
          className="max-w-full overflow-x-auto"
          aria-label="统计时间范围"
          items={[
            { value: '30', label: '近 30 天', href: '/admin/stats?view=dashboard&range=30' },
            { value: '90', label: '近 90 天', href: '/admin/stats?view=dashboard&range=90' },
          ]}
        />
        <CsvButton
          filename={`全站近${data.range}天统计.csv`}
          headers={['日期', '提交', 'AC', '活跃用户']}
          rows={stats.byDay.map((row) => [row.day, row.total, row.accepted, row.activeUsers])}
        />
      </div>
      <KpiGrid>
        <MetricCard className={kpiClass} label="全站总提交" value={stats.total} />
        <MetricCard
          className={kpiClass}
          label="全站 AC 提交"
          value={stats.accepted}
          detail={stats.total ? `通过率 ${formatRatio(stats.accepted, stats.total)}` : '通过率 —'}
        />
        <MetricCard className={kpiClass} label="有提交用户" value={stats.participants} />
      </KpiGrid>
      <ChartPanel
        title="提交、AC 与日活跃用户"
        empty={!stats.byDay.length}
        emptyLabel="暂无曲线数据"
        option={cartesianOption({
          labels: stats.byDay.map((row) => row.day),
          dualY: true,
          boundaryGap: false,
          series: [
            lineSeries('提交', stats.byDay.map((row) => row.total), { areaStyle: { opacity: 0.08 } }),
            lineSeries('AC', stats.byDay.map((row) => row.accepted)),
            lineSeries('日活跃用户', stats.byDay.map((row) => row.activeUsers), { yAxisIndex: 1 }),
          ],
        })}
      />
    </div>
  );
}

function ProblemView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as ProblemStats;
  const errorRows = [
    { name: 'WA', value: stats.errors.wrongAnswer },
    { name: 'TLE', value: stats.errors.timeLimit },
    { name: 'CE', value: stats.errors.compileError },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="flex min-w-0 flex-1 gap-2">
          <input type="hidden" name="view" value="problem" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="stats-problem-tag">
              标签（留空为全站）
            </label>
            <Input id="stats-problem-tag" name="tag" defaultValue={data.tag} placeholder="例如：动态规划" />
          </div>
          <Button type="submit" className="self-end">
            筛选
          </Button>
        </form>
        <CsvButton
          filename="题目难度统计.csv"
          headers={['题号', '题目', '提交', 'AC', '通过率', 'WA', 'TLE', 'CE']}
          rows={stats.difficulty.map((row) => [
            row.displayId,
            row.title,
            row.total,
            row.accepted,
            row.passRate === null ? '—' : `${(row.passRate * 100).toFixed(1)}%`,
            row.wrongAnswer,
            row.timeLimit,
            row.compileError,
          ])}
        />
      </div>
      <div className="grid w-full min-w-0 gap-4 lg:grid-cols-12">
        <Card className="min-w-0 shadow-none lg:col-span-8">
          <CardHeader>
            <CardTitle className="text-sm">难度排行（通过率升序）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">题目</TableHead>
                  <TableHead className="text-right">提交</TableHead>
                  <TableHead className="text-right">AC</TableHead>
                  <TableHead className="text-right">通过率</TableHead>
                  <TableHead className="text-right">WA</TableHead>
                  <TableHead className="text-right">TLE</TableHead>
                  <TableHead className="pr-5 text-right">CE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.difficulty.map((row) => (
                  <TableRow key={row.pid}>
                    <TableCell className="pl-5">
                      <a href={`/p/${row.displayId.startsWith('#') ? row.pid : row.displayId}`} className="font-medium text-primary hover:underline">
                        {row.displayId} {row.title}
                      </a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.accepted}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.passRate === null ? '—' : `${(row.passRate * 100).toFixed(1)}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.wrongAnswer}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.timeLimit}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{row.compileError}</TableCell>
                  </TableRow>
                ))}
                {!stats.difficulty.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      没有匹配题目
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <ChartPanel
          className="min-w-0 lg:col-span-4"
          title="错误类型占比"
          empty={!errorRows.some((row) => row.value > 0)}
          emptyLabel="暂无"
          option={pieOption(errorRows)}
        />
      </div>
    </div>
  );
}

function StatsViewContent({ data }: { data: AdminStatsData }) {
  if (data.view === 'training') return <TrainingView data={data} />;
  if (data.view === 'user') return <UserView data={data} />;
  if (data.view === 'group') return <GroupView data={data} />;
  if (data.view === 'dashboard') return <DashboardView data={data} />;
  if (data.view === 'problem') return <ProblemView data={data} />;
  return <ContestView data={data} />;
}

export function AdminStatsPage() {
  const data = useBootstrap().page.data as AdminStatsData;
  return (
    <AdminPage
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      hideSidebar
      contentClassName="w-full min-w-0"
      title="统计中心"
      description={`实时聚合，单次查询最长 ${data.maxTimeMs / 1000} 秒。`}
    >
      <MiniTabs
        value={data.view}
        className="max-w-full overflow-x-auto"
        aria-label="统计维度"
        items={[
          { value: 'contest', label: '按比赛', href: '/admin/stats?view=contest' },
          { value: 'training', label: '按题集', href: '/admin/stats?view=training' },
          { value: 'user', label: '按人', href: '/admin/stats?view=user' },
          { value: 'group', label: '班级组', href: '/admin/stats?view=group' },
          { value: 'dashboard', label: '大盘', href: '/admin/stats?view=dashboard' },
          { value: 'problem', label: '按题目', href: '/admin/stats?view=problem' },
        ]}
      />
      <StatsViewContent data={data} />
    </AdminPage>
  );
}
