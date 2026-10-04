import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Download } from 'lucide-react';
import { StatsGroupFilterForm, type StatsGroupChoice } from '@/components/stats-group-filter';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, Stat } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
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

function readGroups(value: unknown): StatsGroupChoice[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('groups must be an array');
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item._id !== 'string' || typeof item.name !== 'string') {
      throw new TypeError(`groups[${index}] is invalid`);
    }
    return {
      _id: item._id,
      name: item.name,
      archivedAt: typeof item.archivedAt === 'string' && item.archivedAt ? item.archivedAt : null,
    };
  });
}

function readGroupIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError('groupIds must be a string array');
  return value;
}

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

function videoTone(status: string): BadgeTone {
  if (status === '已看完') return 'success';
  if (status === '进行中') return 'warning';
  return 'neutral';
}

function memberTone(status: WatchMemberStatus): BadgeTone {
  if (status === 'done') return 'success';
  if (status === 'in_progress') return 'warning';
  return 'neutral';
}

function WatchProgress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Progress value={percent} className="min-w-24 flex-1" />
      <span className="w-16 shrink-0 text-right text-xs tabular text-fg-subtle">
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
  const groups = readGroups(data.groups);
  const groupIds = readGroupIds(data.groupIds);
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
    <Page width="wide">
      <PageHeader
        title={title}
        description="观看统计"
        actions={(
          <>
            <Button asChild variant="ghost" size="sm" iconOnly>
              <a href={`/course/${tid}`} aria-label="返回课程">
                <ArrowLeft strokeWidth={1.75} />
              </a>
            </Button>
            {rosterBlocked ? null : (
              <Button asChild variant="secondary" size="sm">
                <a href={`/course/${tid}/videos.csv${groupIds.length ? `?groupIds=${encodeURIComponent(groupIds.join(','))}` : ''}`}>
                  <Download strokeWidth={1.75} />
                  导出 CSV
                </a>
              </Button>
            )}
          </>
        )}
      />
      {rosterWarning && !rosterBlocked ? <Alert tone="warning">{rosterWarning}</Alert> : null}
      {rosterBlocked ? (
        <EmptyState
          title={invalidGroups ? '课程绑定的班级引用已失效，无法出观看名单' : '没有绑定班级，无法出观看名单'}
          description={invalidGroups
            ? '请先在编辑页重新选择可见班级。'
            : '全站可见的课不会把所有用户列进统计。请先在编辑页选择可见班级。'}
          action={(
            <Button asChild variant="primary">
              <a href={`/course/${tid}/edit`}>去设置班级</a>
            </Button>
          )}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <StatsGroupFilterForm
            action={`/course/${tid}/videos`}
            groups={groups}
            selectedIds={groupIds}
            hint="不选则统计本课全部班级。选择后只看这些用户组里已绑定的学生。"
          />
          {groupIds.length ? (
            <p className="text-sm text-fg-muted">已按所选用户组过滤，共 {members.length} 名已绑定学生。</p>
          ) : null}
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="学生" value={members.length} />
              <Stat label="已完成" value={doneCount} />
              <Stat label="进行中" value={inProgressCount} />
              <Stat label="未开始" value={notStartedCount} />
            </div>
          </Panel>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-full min-w-0 overflow-x-auto">
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
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索学号或姓名"
              aria-label="搜索学生"
              className="w-full sm:max-w-xs"
            />
          </div>

          <p className="text-sm text-fg-muted">
            {videos.length ? `共 ${videos.length} 个已确认视频。点开学生查看每条进度。` : '还没有已确认视频。'}
          </p>

          {!visible.length ? (
            <EmptyState compact title={members.length ? '没有符合筛选的学生。' : '名单为空。'} />
          ) : (
            <Panel flush>
              <ul className="divide-y divide-line-subtle">
                {visible.map((member) => {
                  const status = watchMemberStatus(member);
                  const open = openUid === member.uid;
                  const name = member.realName || member.uname;
                  return (
                    <li key={member.uid}>
                      {/* ds-allow DS005: 学生行同时放姓名、状态、进度和展开，固定高度的 Button 会裁掉这几列 */}
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-hover outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-expanded={open}
                        onClick={() => setOpenUid(open ? null : member.uid)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 truncate text-sm font-medium text-fg">{name}</p>
                            <Badge tone={memberTone(status)} className="shrink-0">{statusLabel(status)}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs tabular text-fg-subtle">{member.studentId || `UID ${member.uid}`}</p>
                        </div>
                        <div className="hidden w-56 shrink-0 sm:block">
                          <WatchProgress done={member.done} total={member.total} />
                        </div>
                        <span className="shrink-0 text-xs tabular text-fg-subtle sm:hidden">
                          {member.done}/{member.total}
                        </span>
                        <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-(--dur-2)', open && 'rotate-180')} />
                      </button>
                      {open ? (
                        <div className="border-t border-line-subtle bg-surface-sunken px-4 py-3">
                          <div className="mb-3 sm:hidden">
                            <WatchProgress done={member.done} total={member.total} />
                          </div>
                          {!member.videos.length ? (
                            <p className="text-sm text-fg-muted">没有可统计的视频。</p>
                          ) : (
                            <ul className="space-y-2">
                              {member.videos.map((video) => (
                                <li key={video.videoId} className="rounded-lg border border-line bg-surface px-3 py-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{video.title}</p>
                                    <Badge tone={videoTone(video.status)} size="sm" className="shrink-0">{video.status}</Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-fg-subtle">
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
            </Panel>
          )}
        </div>
      )}
    </Page>
  );
}
