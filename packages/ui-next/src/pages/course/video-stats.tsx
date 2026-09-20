import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Download, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';
import { useBootstrap } from '@/lib/bootstrap';
import { coveragePercent } from '@/lib/course-video-watch';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface StatsVideo {
  id: string;
  title: string;
}

interface StatsMemberVideo {
  videoId: string;
  title: string;
  status: string;
  coverageRatio: number;
  maxRate: number;
  seekForwardAttempts: number;
  lastWatchedAt: string;
  overdue: string;
}

export interface StatsMember {
  uid: number;
  studentId: string;
  realName: string;
  uname: string;
  done: number;
  total: number;
  videos: StatsMemberVideo[];
}

export type WatchMemberFilter = 'all' | 'incomplete' | 'done';
export type WatchMemberStatus = 'done' | 'in_progress' | 'not_started';

function readVideos(value: unknown): StatsVideo[] {
  if (!Array.isArray(value)) throw new TypeError('videos must be an array');
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new TypeError(`videos[${index}] is invalid`);
    }
    return { id: item.id, title: item.title };
  });
}

function readMembers(value: unknown): StatsMember[] {
  if (!Array.isArray(value)) throw new TypeError('members must be an array');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`members[${index}] is invalid`);
    if (!Array.isArray(item.videos)) throw new TypeError(`members[${index}].videos must be an array`);
    return {
      uid: Number(item.uid),
      studentId: typeof item.studentId === 'string' ? item.studentId : '',
      realName: typeof item.realName === 'string' ? item.realName : '',
      uname: typeof item.uname === 'string' ? item.uname : '',
      done: Number(item.done) || 0,
      total: Number(item.total) || 0,
      videos: item.videos.map((video, videoIndex) => {
        if (!isRecord(video) || typeof video.videoId !== 'string') throw new TypeError(`members[${index}].videos[${videoIndex}] is invalid`);
        return {
          videoId: video.videoId,
          title: typeof video.title === 'string' ? video.title : '',
          status: typeof video.status === 'string' ? video.status : '',
          coverageRatio: typeof video.coverageRatio === 'number' ? video.coverageRatio : 0,
          maxRate: typeof video.maxRate === 'number' ? video.maxRate : 1,
          seekForwardAttempts: typeof video.seekForwardAttempts === 'number' ? video.seekForwardAttempts : 0,
          lastWatchedAt: typeof video.lastWatchedAt === 'string' ? video.lastWatchedAt : '',
          overdue: typeof video.overdue === 'string' ? video.overdue : '',
        };
      }),
    };
  });
}

export function watchMemberStatus(member: Pick<StatsMember, 'done' | 'total'>): WatchMemberStatus {
  if (member.total > 0 && member.done >= member.total) return 'done';
  if (member.done > 0) return 'in_progress';
  return 'not_started';
}

export function filterWatchMembers(
  members: StatsMember[],
  filter: WatchMemberFilter,
  query: string,
): StatsMember[] {
  const needle = query.trim().toLowerCase();
  return members.filter((member) => {
    const status = watchMemberStatus(member);
    if (filter === 'done' && status !== 'done') return false;
    if (filter === 'incomplete' && status === 'done') return false;
    if (!needle) return true;
    const haystack = `${member.studentId} ${member.realName} ${member.uname}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function statusLabel(status: WatchMemberStatus): string {
  if (status === 'done') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '未开始';
}

function videoTone(status: string): string {
  if (status === '已看完') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === '进行中') return 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

function WatchProgress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}

export function CourseVideoStatsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  if (!isRecord(data) || !isRecord(data.tdoc)) throw new TypeError('course video stats payload is invalid');
  const tid = String(data.tdoc.docId || '');
  const title = typeof data.tdoc.title === 'string' ? data.tdoc.title : '课程';
  const videos = readVideos(data.videos);
  const members = readMembers(data.members);
  const noGroups = data.rosterUnavailable === 'no_groups';
  const invalidGroups = data.rosterUnavailable === 'invalid_groups';
  const rosterBlocked = noGroups || invalidGroups;
  const rosterWarning = typeof data.rosterWarning === 'string' ? data.rosterWarning : null;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WatchMemberFilter>('all');
  const [openUid, setOpenUid] = useState<number | null>(null);

  const doneCount = members.filter((member) => watchMemberStatus(member) === 'done').length;
  const inProgressCount = members.filter((member) => watchMemberStatus(member) === 'in_progress').length;
  const notStartedCount = members.filter((member) => watchMemberStatus(member) === 'not_started').length;
  const visible = useMemo(() => filterWatchMembers(members, filter, query), [members, filter, query]);

  return (
    <main className="w-full min-w-0 pb-10">
      <header className="mb-6 flex flex-wrap items-center gap-3 border-b pb-5">
        <Button asChild variant="ghost" size="icon" className="-ml-2 size-10">
          <a href={`/course/${tid}`} aria-label="返回课程">
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">观看统计</p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        {rosterBlocked ? null : (
          <Button asChild variant="outline" size="sm" className="min-h-11 gap-1.5">
            <a href={`/course/${tid}/videos.csv`}>
              <Download className="size-3.5" strokeWidth={1.75} />
              导出 CSV
            </a>
          </Button>
        )}
      </header>
      {rosterWarning && !rosterBlocked ? (
        <p role="alert" className="mb-6 rounded-lg border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {rosterWarning}
        </p>
      ) : null}
      {rosterBlocked ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm font-medium">
              {invalidGroups ? '课程绑定的班级引用已失效，无法出观看名单' : '没有绑定班级，无法出观看名单'}
            </p>
            <p className="text-sm text-muted-foreground">
              {invalidGroups
                ? '请先在编辑页重新选择可见班级。'
                : '全站可见的课不会把所有用户列进统计。请先在编辑页选择可见班级。'}
            </p>
            <Button asChild className="min-h-11">
              <a href={`/course/${tid}/edit`}>去设置班级</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">学生</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{members.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">已完成</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{doneCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">进行中</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{inProgressCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">未开始</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{notStartedCount}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-full overflow-x-auto">
            <MiniTabs<WatchMemberFilter>
              value={filter}
              onValueChange={setFilter}
              size="md"
              aria-label="完成状态"
              items={[
                { value: 'all', label: '全部', count: members.length },
                { value: 'incomplete', label: '未完成', count: inProgressCount + notStartedCount },
                { value: 'done', label: '已完成', count: doneCount },
              ]}
            />
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索学号或姓名"
                className="min-h-11 pl-9"
                aria-label="搜索学生"
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {videos.length ? `共 ${videos.length} 个已确认视频。点开学生查看每条进度。` : '还没有已确认视频。'}
          </p>

          {!visible.length ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {members.length ? '没有符合筛选的学生。' : '名单为空。'}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden py-0">
              <ul>
                {visible.map((member) => {
                  const status = watchMemberStatus(member);
                  const open = openUid === member.uid;
                  const name = member.realName || member.uname;
                  return (
                    <li key={member.uid} className="border-b border-border/60 last:border-b-0">
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        onClick={() => setOpenUid(open ? null : member.uid)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'font-normal',
                                status === 'done' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                status === 'in_progress' && 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                              )}
                            >
                              {statusLabel(status)}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{member.studentId || `UID ${member.uid}`}</p>
                        </div>
                        <div className="hidden w-56 sm:block">
                          <WatchProgress done={member.done} total={member.total} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground sm:hidden">
                          {member.done}/{member.total}
                        </span>
                        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      </button>
                      {open ? (
                        <div className="border-t bg-muted/20 px-4 py-3">
                          <div className="mb-3 sm:hidden">
                            <WatchProgress done={member.done} total={member.total} />
                          </div>
                          {!member.videos.length ? (
                            <p className="text-sm text-muted-foreground">没有可统计的视频。</p>
                          ) : (
                            <ul className="space-y-2">
                              {member.videos.map((video) => (
                                <li key={video.videoId} className="rounded-lg border bg-card px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{video.title}</p>
                                    <span className={cn('rounded-md px-2 py-0.5 text-xs', videoTone(video.status))}>{video.status}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    覆盖 {coveragePercent(video.coverageRatio)}% · {video.maxRate}× · 拖{video.seekForwardAttempts}
                                    {video.overdue ? ` · ${video.overdue}` : ''}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
