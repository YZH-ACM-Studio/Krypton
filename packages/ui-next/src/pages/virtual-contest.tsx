import { Clock, Flag, List, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { contestProblemLetter } from '@/lib/competitive-companion';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';
import { scoreboardExportPlainText } from '@/lib/scoreboard-image-export';

interface VirtualAttemptView {
  _id: string;
  uid?: number;
  uname?: string;
  status: 'active' | 'ended' | 'cancelled' | 'voided';
  startAt?: string;
  endAt?: string;
  firstRecordAt?: string | null;
  remainingMs?: number;
  snapshot?: { pids?: number[]; rule?: string; durationMs?: number };
  accept?: number;
  time?: number;
  score?: number;
  detail?: Record<string, { status?: number; score?: number }>;
  voidConfirmation?: string;
  rev?: number;
}

interface VirtualPageData {
  tdoc?: { docId?: string; title?: string; rule?: string };
  eligibility?: { allowed?: boolean; reason?: string };
  attempt?: VirtualAttemptView | null;
  pdict?: Record<string, { title?: string }>;
  canManage?: boolean;
  isolation?: boolean;
  adminAttempts?: VirtualAttemptView[];
  rejudgePreview?: { attemptId?: string; count?: number; recordIds?: string[]; snapshotRule?: string; pid?: number | null };
}

function remainingLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

interface VirtualScoreboardCell {
  type?: string;
  value?: unknown;
}

function isProblemScoreboardColumn(type: string | undefined): boolean {
  return type === 'problem' || type === 'record' || type === 'records';
}

function scoreboardCellText(cell: VirtualScoreboardCell): string {
  return scoreboardExportPlainText(cell.value);
}

function scoreboardCellClass(type: string | undefined, kind: 'head' | 'body'): string {
  if (isProblemScoreboardColumn(type)) {
    return kind === 'head' ? 'min-w-20 whitespace-nowrap text-center' : 'min-w-20 whitespace-pre-line text-center';
  }
  if (kind === 'body' && (type === 'time' || type === 'total_score' || type === 'solved')) {
    return 'min-w-24 whitespace-pre-line';
  }
  return 'min-w-24 whitespace-nowrap';
}

const REASON: Record<string, string> = {
  not_ended: '比赛尚未全局结束。',
  rule_unsupported: '该赛制不支持虚拟参赛。',
  team_contest: '团队赛不支持虚拟参赛。',
  virtual_disabled: '管理员已关闭本场虚拟参赛。',
  has_subjective: '含主观题的比赛不能虚拟参赛。',
  has_manual_grade: '含人工评分题的比赛不能虚拟参赛。',
  invalid_schedule: '比赛时间无效。',
  no_problems: '比赛没有题目，不能虚拟参赛。',
  invite_required: '邀请码比赛需要先正式参赛才能虚拟参赛。',
  missing_problems: '比赛题目已缺失，不能虚拟参赛。',
};

export function VirtualContestPage() {
  const bs = useBootstrap();
  const data = bs.page.data as VirtualPageData;
  const tid = String(data.tdoc?.docId || '');
  const attempt = data.attempt || null;
  const pids = attempt?.snapshot?.pids || [];
  const detailUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: tid });
  const locale = bs.locale || 'zh';

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <a href={detailUrl} className="hover:text-primary">
            {data.tdoc?.title || '比赛'}
          </a>
        </p>
        <h1 className="text-2xl font-semibold">虚拟参赛</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          这是普通浏览器里的自律计时训练，不启动考试客户端、不加网络锁，也不能当作防作弊。源比赛题目顺序和赛制会被快照，之后改题面不会改这次计时。
        </p>
      </div>

      {data.rejudgePreview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">确认重测范围</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              即将重测 {data.rejudgePreview.count || 0} 条记录，规则快照 {data.rejudgePreview.snapshotRule}。Record ID：
              {(data.rejudgePreview.recordIds || []).map((id) => String(id)).join(', ') || '无'}
            </p>
            <form method="post" action={`/contest/${tid}/virtual/rejudge`} className="space-y-2">
              <input type="hidden" name="attemptId" value={String(data.rejudgePreview.attemptId || '')} />
              {data.rejudgePreview.pid ? <input type="hidden" name="pid" value={String(data.rejudgePreview.pid)} /> : null}
              <label className="block space-y-1">
                确认口令
                <Input name="confirmation" required placeholder={`REJUDGE-VP:${data.rejudgePreview.attemptId}:${data.rejudgePreview.count}`} />
              </label>
              <Button type="submit">确认重测</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">入口</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {data.eligibility?.allowed && !attempt ? (
            <form method="post" className="flex">
              <input type="hidden" name="operation" value="start" />
              <Button type="submit" className="h-auto whitespace-normal">
                开始虚拟参赛
              </Button>
            </form>
          ) : null}
          {attempt?.status === 'active' ? (
            <>
              <form method="post" className="flex">
                <input type="hidden" name="operation" value="end" />
                <input type="hidden" name="attemptId" value={String(attempt._id)} />
                <Button type="submit" variant="outline" className="h-auto whitespace-normal">
                  提前结束
                </Button>
              </form>
              {!attempt.firstRecordAt ? (
                <form method="post" className="flex">
                  <input type="hidden" name="operation" value="cancel" />
                  <input type="hidden" name="attemptId" value={String(attempt._id)} />
                  <Button type="submit" variant="ghost" className="h-auto whitespace-normal">
                    取消误开
                  </Button>
                </form>
              ) : null}
            </>
          ) : null}
          {attempt?.status === 'ended' ? (
            <Button asChild variant="outline" className="h-auto whitespace-normal">
              <a href={`/contest/${tid}/virtual/scoreboard`}>
                <Trophy className="size-4" />
                虚拟榜单
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="h-auto whitespace-normal">
            <a href={`${detailUrl}/problems`}>继续赛后练习</a>
          </Button>
        </CardContent>
      </Card>

      {!data.eligibility?.allowed && !attempt ? (
        <p className="text-sm text-muted-foreground">{REASON[data.eligibility?.reason || ''] || '当前不能开始虚拟参赛。'}</p>
      ) : null}

      {attempt ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="inline-flex items-center gap-2">
                <Clock className="size-4 shrink-0" />
                {attempt.status === 'active' ? '进行中' : attempt.status}
              </span>
              {attempt.status === 'active' ? (
                <Badge variant="secondary" className="max-w-full whitespace-nowrap">
                  {remainingLabel(attempt.remainingMs || 0)} 剩余
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              {formatDateTime(attempt.startAt, locale)} → {formatDateTime(attempt.endAt, locale)}
            </p>
            <p>
              通过 {attempt.accept || 0} · 罚时/用时 {attempt.time || 0} · 得分 {attempt.score || 0}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {pids.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <List className="size-4" />
              题目
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pids.map((pid, index) => {
              const title = data.pdict?.[String(pid)]?.title || `P${pid}`;
              const cell = attempt?.detail?.[String(pid)];
              const href =
                attempt?.status === 'active'
                  ? `/p/${pid}?tid=${encodeURIComponent(tid)}&virtual=1`
                  : `/p/${pid}?tid=${encodeURIComponent(tid)}`;
              return (
                <a
                  key={pid}
                  href={href}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <span className="min-w-0 truncate">
                    {contestProblemLetter(index)}. {title}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {cell?.status === 1 ? 'AC' : cell ? '已交' : '未交'}
                  </Badge>
                </a>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {data.canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">管理</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data.adminAttempts || []).map((row) => (
              <div key={String(row._id)} className="space-y-2 rounded-md border p-3 text-sm">
                <p>
                  {row.uname || row.uid} · {row.status} · 通过 {row.accept || 0}
                </p>
                {row.status === 'active' ? (
                  <form method="post">
                    <input type="hidden" name="operation" value="end" />
                    <input type="hidden" name="attemptId" value={String(row._id)} />
                    <Button type="submit" size="sm" variant="outline">
                      提前结束
                    </Button>
                  </form>
                ) : null}
                {row.status === 'active' || row.status === 'ended' ? (
                  <form method="post" className="space-y-2">
                    <input type="hidden" name="operation" value="void" />
                    <input type="hidden" name="attemptId" value={String(row._id)} />
                    <Input name="confirmation" required placeholder={row.voidConfirmation} />
                    <Button type="submit" size="sm" variant="destructive">
                      确认作废
                    </Button>
                  </form>
                ) : null}
                <Button asChild size="sm" variant="outline">
                  <a href={`/contest/${tid}/virtual/rejudge?attemptId=${encodeURIComponent(String(row._id))}`}>
                    <Flag className="size-4" />
                    预览并重测
                  </a>
                </Button>
              </div>
            ))}
            {!(data.adminAttempts || []).length ? <p className="text-sm text-muted-foreground">还没有虚拟参赛记录。</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function VirtualContestScoreboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { tdoc?: { docId?: string; title?: string }; rows?: VirtualScoreboardCell[][] };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const header = rows[0] || [];
  const body = rows.slice(1);
  return (
    <div className="min-w-0 space-y-4">
      <h1 className="text-2xl font-semibold">虚拟参赛榜单</h1>
      <p className="max-w-prose text-sm text-muted-foreground">按各自相对时间计分，与正式榜单完全分开。</p>
      <Card className="min-w-0">
        <CardContent className="p-0">
          {header.length > 0 ? (
            <ScrollArea className="w-full" orientation="both">
              <table className="krypton-table min-w-max w-full caption-bottom text-sm [&_tr>*:first-child]:pl-5 [&_tr>*:last-child]:pr-5">
                <TableHeader>
                  <TableRow>
                    {header.map((cell, index) => (
                      <TableHead key={`${cell.type || 'col'}-${index}`} className={scoreboardCellClass(cell.type, 'head')}>
                        {scoreboardCellText(cell)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {body.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <TableCell key={`${rowIndex}-${cellIndex}`} className={scoreboardCellClass(cell.type, 'body')}>
                          {scoreboardCellText(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </ScrollArea>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">暂无排行数据</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
