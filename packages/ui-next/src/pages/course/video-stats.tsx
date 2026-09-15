import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

interface StatsMember {
  uid: number;
  studentId: string;
  realName: string;
  uname: string;
  done: number;
  total: number;
  videos: StatsMemberVideo[];
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

export function CourseVideoStatsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  if (!isRecord(data) || !isRecord(data.tdoc)) throw new TypeError('course video stats payload is invalid');
  const tid = String(data.tdoc.docId || '');
  const title = typeof data.tdoc.title === 'string' ? data.tdoc.title : '课程';
  const videos = readVideos(data.videos);
  const members = readMembers(data.members);
  const noGroups = data.rosterUnavailable === 'no_groups';

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
        {noGroups ? null : (
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <a href={`/course/${tid}/videos.csv`}>
              <Download className="size-3.5" strokeWidth={1.75} />
              导出 CSV
            </a>
          </Button>
        )}
      </header>
      {noGroups ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm font-medium">没有绑定班级，无法出观看名单</p>
            <p className="text-sm text-muted-foreground">全站可见的课不会把所有用户列进统计。请先在编辑页选择可见班级。</p>
            <Button asChild size="sm">
              <a href={`/course/${tid}/edit`}>去设置班级</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-2 py-2">学号</th>
              <th className="px-2 py-2">姓名</th>
              <th className="px-2 py-2">完成</th>
              {videos.map((video) => (
                <th key={video.id} className="px-2 py-2">
                  {video.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.uid} className="border-b border-border/50">
                <td className="px-2 py-2 font-medium">{member.studentId || `UID ${member.uid}`}</td>
                <td className="px-2 py-2">{member.realName || member.uname}</td>
                <td className="px-2 py-2 tabular-nums">
                  {member.done}/{member.total}
                </td>
                {member.videos.map((video) => (
                  <td key={video.videoId} className="px-2 py-2 text-xs">
                    <div>{video.status}</div>
                    <div className="krypton-course-meta">
                      {coveragePercent(video.coverageRatio)}% · {video.maxRate}× · 拖{video.seekForwardAttempts}
                    </div>
                    {video.overdue ? <div className="text-amber-700 dark:text-amber-400">{video.overdue}</div> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!members.length ? <p className="mt-6 text-sm text-muted-foreground">名单为空。</p> : null}
        </>
      )}
    </main>
  );
}
