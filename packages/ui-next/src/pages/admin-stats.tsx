import { BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';

registerAdminNavSection({
  key: 'statistics',
  label: '数据统计',
  order: 15,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    {
      key: 'admin_stats',
      label: '统计中心',
      href: '/admin/stats',
      icon: BarChart3,
      templateNames: ['admin_stats.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
  ],
});

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
  byProblem: Array<{ pid: number; total: number; accepted: number }>;
  byHour: Array<{ hour: string; count: number }>;
  byLanguage: Array<{ language: string; count: number }>;
}

interface TrainingStats {
  enrollmentCount: number;
  problemCount: number;
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

interface AdminStatsData {
  view: 'contest' | 'training';
  contests: SelectorDoc[];
  trainings: SelectorDoc[];
  selectedContest: (SelectorDoc & { pids: number[] }) | null;
  selectedTraining: (SelectorDoc & { dag: unknown[] }) | null;
  stats: ContestStats | TrainingStats | null;
  problems: ProblemSummary[];
  maxTimeMs: number;
}

function MetricCard({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {detail ? <p className="text-[11px] text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function LineChart({ rows, title }: { rows: Array<{ label: string; value: number }>; title: string }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">暂无曲线数据</p>;
  const width = 720;
  const height = 220;
  const padding = 28;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : padding + (index / (rows.length - 1)) * (width - padding * 2);
    const y = height - padding - (row.value / max) * (height - padding * 2);
    return { ...row, x, y };
  });
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="min-w-[600px]">
        <title>{title}</title>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="stroke-border" />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" className="fill-primary" />
            <title>{`${point.label}: ${point.value}`}</title>
          </g>
        ))}
        <text x={padding} y={height - 8} className="fill-muted-foreground text-[11px]">
          {rows[0].label}
        </text>
        <text x={width - padding} y={height - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {rows.at(-1)?.label}
        </text>
      </svg>
    </div>
  );
}

function BarRows({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex justify-between gap-3 text-xs">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{row.detail || row.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Selector({ view, docs, selectedId }: { view: 'contest' | 'training'; docs: SelectorDoc[]; selectedId?: string }) {
  const name = view === 'contest' ? 'contestId' : 'trainingId';
  return (
    <form method="get" action="/admin/stats" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="view" value={view} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor={`stats-${name}`}>
          {view === 'contest' ? '选择比赛' : '选择训练'}
        </label>
        <SimpleSelect
          name={name}
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
  return (
    <div className="space-y-5">
      <Selector view="contest" docs={data.contests} selectedId={data.selectedContest?.docId} />
      {!stats || !data.selectedContest ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">暂无比赛可统计</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="总提交" value={stats.total} />
            <MetricCard label="AC 提交" value={stats.accepted} detail={stats.total ? `通过率 ${((stats.accepted / stats.total) * 100).toFixed(1)}%` : '通过率 —'} />
            <MetricCard label="参赛人数" value={stats.participants} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">每题通过分布</CardTitle></CardHeader>
              <CardContent>
                <BarRows rows={stats.byProblem.map((row) => {
                  const problem = problemById.get(row.pid);
                  return {
                    label: `${problem?.pid || `#${row.pid}`} ${problem?.title || ''}`.trim(),
                    value: row.accepted,
                    detail: `${row.accepted}/${row.total}`,
                  };
                })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">语言分布</CardTitle></CardHeader>
              <CardContent><BarRows rows={stats.byLanguage.map((row) => ({ label: row.language, value: row.count }))} /></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><LineChartIcon className="size-4" />按小时提交曲线</CardTitle></CardHeader>
            <CardContent><LineChart title="比赛按小时提交曲线" rows={stats.byHour.map((row) => ({ label: row.hour.replace('T', ' '), value: row.count }))} /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function TrainingView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as TrainingStats | null;
  const problemById = new Map(data.problems.map((problem) => [problem.docId, problem]));
  return (
    <div className="space-y-5">
      <Selector view="training" docs={data.trainings} selectedId={data.selectedTraining?.docId} />
      {!stats || !data.selectedTraining ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">暂无训练可统计</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="报名人数" value={stats.enrollmentCount} />
            <MetricCard label="题目数" value={stats.problemCount} />
            <MetricCard
              label="全部完成"
              value={stats.members.filter((member) => member.progress === 100).length}
              detail={stats.enrollmentCount ? `${((stats.members.filter((member) => member.progress === 100).length / stats.enrollmentCount) * 100).toFixed(1)}%` : '—'}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">每题完成人数</CardTitle></CardHeader>
              <CardContent>
                <BarRows rows={stats.byProblem.map((row) => {
                  const problem = problemById.get(row.pid);
                  return {
                    label: `${problem?.pid || `#${row.pid}`} ${problem?.title || ''}`.trim(),
                    value: row.completed,
                    detail: `${row.completed}/${stats.enrollmentCount}`,
                  };
                })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">完成率分布</CardTitle></CardHeader>
              <CardContent><BarRows rows={stats.progressDistribution.map((row) => ({ label: row.label, value: row.count }))} /></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-sm">成员进度榜</CardTitle></CardHeader>
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
                        <p className="text-[11px] text-muted-foreground">{member.uname} · UID {member.uid}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{member.studentId || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{member.done}/{member.total}</TableCell>
                      <TableCell className="pr-5 text-right font-mono text-sm">{member.progress}%</TableCell>
                    </TableRow>
                  ))}
                  {!stats.members.length ? (
                    <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">暂无报名成员</TableCell></TableRow>
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

export function AdminStatsPage() {
  const data = useBootstrap().page.data as AdminStatsData;
  return (
    <AdminPage
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      title="统计中心"
      description={`实时聚合，单次查询最长 ${data.maxTimeMs / 1000} 秒。`}
      actions={(
        <MiniTabs
          value={data.view}
          items={[
            { value: 'contest', label: '按比赛', href: '/admin/stats?view=contest' },
            { value: 'training', label: '按训练', href: '/admin/stats?view=training' },
          ]}
        />
      )}
    >
      {data.view === 'training' ? <TrainingView data={data} /> : <ContestView data={data} />}
    </AdminPage>
  );
}
