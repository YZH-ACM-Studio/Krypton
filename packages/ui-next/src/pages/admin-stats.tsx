import { useState } from 'react';
import { Download, LineChart as LineChartIcon, Search } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
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
  range: 30 | 90;
  tag: string;
  maxTimeMs: number;
}

type CsvCell = string | number | null | undefined;

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

function CsvButton({ filename, headers, rows, disabled = false }: {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={() => downloadCsv(filename, headers, rows)}>
      <Download className="mr-1.5 size-4" />导出 CSV
    </Button>
  );
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
  const csvRows: CsvCell[][] = stats
    ? stats.byProblem.map((row) => {
        const problem = problemById.get(row.pid);
        return [problem?.pid || `#${row.pid}`, problem?.title, row.total, row.accepted, row.total ? `${((row.accepted / row.total) * 100).toFixed(1)}%` : '—'];
      })
    : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1"><Selector view="contest" docs={data.contests} selectedId={data.selectedContest?.docId} /></div>
        <CsvButton filename="比赛统计.csv" headers={['题号', '题目', '提交', 'AC', '通过率']} rows={csvRows} disabled={!stats} />
      </div>
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
  const csvRows: CsvCell[][] = stats
    ? stats.members.map((member) => [member.uid, member.uname, member.realName, member.studentId, member.done, member.total, `${member.progress}%`])
    : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1"><Selector view="training" docs={data.trainings} selectedId={data.selectedTraining?.docId} /></div>
        <CsvButton filename="训练成员进度.csv" headers={['UID', '用户名', '姓名', '学号', '完成', '总题数', '完成率']} rows={csvRows} disabled={!stats} />
      </div>
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

function UserView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as UserStats | null;
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="flex min-w-0 flex-1 gap-2">
          <input type="hidden" name="view" value="user" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="stats-user-query">搜索用户名或显示名</label>
            <input
              id="stats-user-query"
              name="q"
              defaultValue={data.q}
              placeholder="输入前缀搜索"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button type="submit" className="self-end"><Search className="mr-1.5 size-4" />搜索</Button>
        </form>
        <CsvButton
          filename="用户近30天统计.csv"
          headers={['日期', '提交', 'AC']}
          rows={stats?.byDay.map((row) => [row.day, row.total, row.accepted]) || []}
          disabled={!stats}
        />
      </div>

      {data.q && !data.selectedUser ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">搜索结果</CardTitle></CardHeader>
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
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{stats.student?.realName || data.selectedUser.uname}</p>
                <p className="text-xs text-muted-foreground">
                  {data.selectedUser.uname} · UID {data.selectedUser.uid}{stats.student?.studentId ? ` · ${stats.student.studentId}` : ''}
                </p>
              </div>
              <a href={`/user/${data.selectedUser.uid}`} className="text-sm text-primary hover:underline">查看用户主页</a>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="总提交" value={stats.total} />
            <MetricCard label="AC 提交" value={stats.accepted} />
            <MetricCard label="通过率" value={stats.total ? `${((stats.accepted / stats.total) * 100).toFixed(1)}%` : '—'} />
            <MetricCard label="活跃天数" value={stats.activeDays} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-sm">近 30 天提交曲线</CardTitle></CardHeader>
            <CardContent><LineChart title="用户近30天提交曲线" rows={stats.byDay.map((row) => ({ label: row.day, value: row.total }))} /></CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">参加的比赛</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {stats.contests.map((item) => <a key={item.docId} className="block text-sm text-primary hover:underline" href={`/contest/${item.docId}`}>{item.title}</a>)}
                {!stats.contests.length ? <p className="text-sm text-muted-foreground">暂无</p> : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">参加的训练</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {stats.trainings.map((item) => <a key={item.docId} className="block text-sm text-primary hover:underline" href={`/training/${item.docId}`}>{item.title}</a>)}
                {!stats.trainings.length ? <p className="text-sm text-muted-foreground">暂无</p> : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {!data.q && !data.selectedUser ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">搜索并选择用户后查看统计</CardContent></Card>
      ) : null}
    </div>
  );
}

function GroupView({ data }: { data: AdminStatsData }) {
  const [selected, setSelected] = useState<string[]>(data.groupIds || []);
  const stats = data.stats as GroupStatsRow[] | null;
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
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
                    onClick={() => setSelected((current) => active ? current.filter((id) => id !== group._id) : [...current, group._id])}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {group.name}{group.archivedAt ? '（已归档）' : ''}
                  </button>
                );
              })}
              {!data.groups.length ? <p className="text-sm text-muted-foreground">暂无班级组</p> : null}
            </div>
          </div>
          <Button type="submit" disabled={!selected.length}>比较所选班级</Button>
        </form>
        <CsvButton
          filename="班级组对比.csv"
          headers={['班级组', '绑定成员', '活跃成员', '人均提交', '人均AC']}
          rows={stats?.map((row) => [row.name, row.memberCount, row.activeMembers, row.averageSubmissions.toFixed(1), row.averageAccepted.toFixed(1)]) || []}
          disabled={!stats?.length}
        />
      </div>
      {stats ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-5">班级组</TableHead><TableHead className="text-right">绑定成员</TableHead><TableHead className="text-right">活跃成员</TableHead><TableHead className="text-right">人均提交</TableHead><TableHead className="pr-5 text-right">人均 AC</TableHead></TableRow></TableHeader>
              <TableBody>
                {stats.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-5 font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.memberCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.activeMembers}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.averageSubmissions.toFixed(1)}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{row.averageAccepted.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">选择班级组后生成对比</CardContent></Card>}
    </div>
  );
}

function DashboardView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as DashboardStats;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MiniTabs
          value={String(data.range)}
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
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="全站总提交" value={stats.total} />
        <MetricCard label="全站 AC 提交" value={stats.accepted} detail={stats.total ? `通过率 ${((stats.accepted / stats.total) * 100).toFixed(1)}%` : '通过率 —'} />
        <MetricCard label="有提交用户" value={stats.participants} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">日提交曲线</CardTitle></CardHeader>
          <CardContent><LineChart title={`近${data.range}天日提交曲线`} rows={stats.byDay.map((row) => ({ label: row.day, value: row.total }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">日活跃用户</CardTitle></CardHeader>
          <CardContent><LineChart title={`近${data.range}天日活跃用户`} rows={stats.byDay.map((row) => ({ label: row.day, value: row.activeUsers }))} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProblemView({ data }: { data: AdminStatsData }) {
  const stats = data.stats as ProblemStats;
  const errorRows = [
    { label: 'WA', value: stats.errors.wrongAnswer },
    { label: 'TLE', value: stats.errors.timeLimit },
    { label: 'CE', value: stats.errors.compileError },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <form method="get" action="/admin/stats" className="flex min-w-0 flex-1 gap-2">
          <input type="hidden" name="view" value="problem" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="stats-problem-tag">标签（留空为全站）</label>
            <input
              id="stats-problem-tag"
              name="tag"
              defaultValue={data.tag}
              placeholder="例如：动态规划"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button type="submit" className="self-end">筛选</Button>
        </form>
        <CsvButton
          filename="题目难度统计.csv"
          headers={['题号', '题目', '提交', 'AC', '通过率', 'WA', 'TLE', 'CE']}
          rows={stats.difficulty.map((row) => [row.displayId, row.title, row.total, row.accepted, row.passRate === null ? '—' : `${(row.passRate * 100).toFixed(1)}%`, row.wrongAnswer, row.timeLimit, row.compileError])}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader><CardTitle className="text-sm">难度排行（通过率升序）</CardTitle></CardHeader>
          <CardContent className="max-h-[640px] overflow-auto p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-5">题目</TableHead><TableHead className="text-right">提交</TableHead><TableHead className="text-right">AC</TableHead><TableHead className="pr-5 text-right">通过率</TableHead></TableRow></TableHeader>
              <TableBody>
                {stats.difficulty.map((row) => (
                  <TableRow key={row.pid}>
                    <TableCell className="pl-5"><a href={`/p/${row.displayId.startsWith('#') ? row.pid : row.displayId}`} className="font-medium text-primary hover:underline">{row.displayId} {row.title}</a></TableCell>
                    <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.accepted}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{row.passRate === null ? '—' : `${(row.passRate * 100).toFixed(1)}%`}</TableCell>
                  </TableRow>
                ))}
                {!stats.difficulty.length ? <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">没有匹配题目</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">错误类型占比</CardTitle></CardHeader>
          <CardContent><BarRows rows={errorRows} /></CardContent>
        </Card>
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
      title="统计中心"
      description={`实时聚合，单次查询最长 ${data.maxTimeMs / 1000} 秒。`}
      actions={(
        <MiniTabs
          value={data.view}
          items={[
            { value: 'contest', label: '按比赛', href: '/admin/stats?view=contest' },
            { value: 'training', label: '按训练', href: '/admin/stats?view=training' },
            { value: 'user', label: '按人', href: '/admin/stats?view=user' },
            { value: 'group', label: '班级组', href: '/admin/stats?view=group' },
            { value: 'dashboard', label: '大盘', href: '/admin/stats?view=dashboard' },
            { value: 'problem', label: '按题目', href: '/admin/stats?view=problem' },
          ]}
        />
      )}
    >
      <StatsViewContent data={data} />
    </AdminPage>
  );
}
