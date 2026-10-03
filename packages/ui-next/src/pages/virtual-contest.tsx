import { Clock, Flag, List, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { scoreTone } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
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
  score?: number;
  scorePercentage?: number;
  style?: string;
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
    return 'min-w-24 whitespace-pre-line tabular';
  }
  return 'min-w-24 whitespace-nowrap tabular';
}

const SCOREBOARD_PROBLEM_CELL = 'h-12 text-center font-semibold tabular border-l border-line-subtle 3xl:text-md';

function scoreboardStickyClass(index: number, kind: 'head' | 'body'): string | undefined {
  if (index === 0) {
    return kind === 'head'
      ? 'sticky left-0 z-20 w-24 bg-surface'
      : 'sticky left-0 z-10 w-24 bg-surface group-hover:bg-surface-hover';
  }
  if (index === 1) {
    return kind === 'head'
      ? 'sticky left-24 z-20 bg-surface'
      : 'sticky left-24 z-10 bg-surface group-hover:bg-surface-hover';
  }
  return undefined;
}

function isFirstBlood(cell: VirtualScoreboardCell): boolean {
  return typeof cell.style === 'string' && /background-color/i.test(cell.style);
}

function numericScore(cell: VirtualScoreboardCell, text: string): number | undefined {
  if (typeof cell.scorePercentage === 'number' && Number.isFinite(cell.scorePercentage)) return cell.scorePercentage;
  if (typeof cell.score === 'number' && Number.isFinite(cell.score)) return cell.score;
  const parsed = Number(text);
  if (text.trim() !== '' && Number.isFinite(parsed)) return parsed;
  return undefined;
}

function scoreboardToneClass(cell: VirtualScoreboardCell): string {
  if (!isProblemScoreboardColumn(cell.type)) return '';
  if (isFirstBlood(cell)) return 'bg-success text-on-success';
  const raw = cell.value == null ? '' : String(cell.value);
  const text = scoreboardCellText(cell);
  if (text === '—' || text === '-' || text === '') return '';
  if (raw.includes('icon-check') || /^\+\d*\n/.test(text)) return 'bg-success-soft text-success-fg';
  if (/color:\s*orange/i.test(raw)) return 'bg-info-soft text-info-fg';
  if (/^-\d/.test(text)) return 'bg-danger-soft text-danger-fg';
  const score = numericScore(cell, text);
  if (score === undefined) return '';
  const tone = scoreTone(score);
  if (tone === 'success') return 'bg-success-soft text-success-fg';
  if (tone === 'danger') return 'bg-danger-soft text-danger-fg';
  return 'bg-warning-soft text-warning-fg';
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
    <Page width="wide">
      <PageHeader
        title="虚拟参赛"
        breadcrumb={(
          <Breadcrumb
            items={[
              { label: data.tdoc?.title || '比赛', href: detailUrl },
              { label: '虚拟参赛' },
            ]}
          />
        )}
        description="这是普通浏览器里的自律计时训练，不启动考试客户端、不加网络锁，也不能当作防作弊。源比赛题目顺序和赛制会被快照，之后改题面不会改这次计时。"
      />

      {data.rejudgePreview ? (
        <Panel title="确认重测范围">
          <div className="space-y-3 text-sm">
            <p>
              即将重测 {data.rejudgePreview.count || 0} 条记录，规则快照 {data.rejudgePreview.snapshotRule}。Record ID：
              {(data.rejudgePreview.recordIds || []).map((id) => String(id)).join(', ') || '无'}
            </p>
            <form method="post" action={`/contest/${tid}/virtual/rejudge`} className="space-y-2">
              <input type="hidden" name="attemptId" value={String(data.rejudgePreview.attemptId || '')} />
              {data.rejudgePreview.pid ? <input type="hidden" name="pid" value={String(data.rejudgePreview.pid)} /> : null}
              <label className="flex flex-col gap-1.5">
                确认口令
                <Input name="confirmation" required placeholder={`REJUDGE-VP:${data.rejudgePreview.attemptId}:${data.rejudgePreview.count}`} />
              </label>
              <Button type="submit" variant="primary">确认重测</Button>
            </form>
          </div>
        </Panel>
      ) : null}

      <Panel title="入口">
        <div className="flex flex-wrap items-center gap-2">
          {data.eligibility?.allowed && !attempt ? (
            <form method="post" className="flex">
              <input type="hidden" name="operation" value="start" />
              <Button type="submit" variant="primary" className="h-auto whitespace-normal">
                开始虚拟参赛
              </Button>
            </form>
          ) : null}
          {attempt?.status === 'active' ? (
            <>
              <form method="post" className="flex">
                <input type="hidden" name="operation" value="end" />
                <input type="hidden" name="attemptId" value={String(attempt._id)} />
                <Button type="submit" variant="secondary" className="h-auto whitespace-normal">
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
            <Button asChild variant="secondary" className="h-auto whitespace-normal">
              <a href={`/contest/${tid}/virtual/scoreboard`}>
                <Trophy />
                虚拟榜单
              </a>
            </Button>
          ) : null}
          <Button asChild variant="secondary" className="h-auto whitespace-normal">
            <a href={`${detailUrl}/problems`}>继续赛后练习</a>
          </Button>
        </div>
      </Panel>

      {!data.eligibility?.allowed && !attempt ? (
        <p className="text-sm text-fg-muted">{REASON[data.eligibility?.reason || ''] || '当前不能开始虚拟参赛。'}</p>
      ) : null}

      {attempt ? (
        <Panel
          title={(
            <span className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4 shrink-0 text-fg-subtle" />
                {attempt.status === 'active' ? (
                  <>
                    <StatusDot tone="success" pulse />
                    进行中
                  </>
                ) : (
                  attempt.status
                )}
              </span>
              {attempt.status === 'active' ? (
                <Badge variant="soft" className="max-w-full whitespace-nowrap tabular">
                  {remainingLabel(attempt.remainingMs || 0)} 剩余
                </Badge>
              ) : null}
            </span>
          )}
        >
          <div className="space-y-2 text-sm text-fg-muted">
            <p className="tabular">
              {formatDateTime(attempt.startAt, locale)} → {formatDateTime(attempt.endAt, locale)}
            </p>
            <p className="tabular">
              通过 {attempt.accept || 0} · 罚时/用时 {attempt.time || 0} · 得分 {attempt.score || 0}
            </p>
          </div>
        </Panel>
      ) : null}

      {pids.length ? (
        <Panel
          title={(
            <span className="inline-flex items-center gap-1.5">
              <List className="size-4 text-fg-subtle" />
              题目
            </span>
          )}
        >
          <div className="space-y-2">
            {pids.map((pid, index) => {
              const title = data.pdict?.[String(pid)]?.title || `P${pid}`;
              const cell = attempt?.detail?.[String(pid)];
              const href =
                attempt?.status === 'active'
                  ? `/p/${pid}?tid=${encodeURIComponent(tid)}&virtual=1`
                  : `/p/${pid}?tid=${encodeURIComponent(tid)}`;
              const submitted = Boolean(cell);
              const accepted = cell?.status === 1;
              return (
                <a
                  key={pid}
                  href={href}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-hover"
                >
                  <span className="min-w-0 truncate">
                    {contestProblemLetter(index)}. {title}
                  </span>
                  <Badge
                    variant="soft"
                    tone={accepted ? 'success' : submitted ? 'info' : 'neutral'}
                    className="shrink-0"
                  >
                    {accepted ? 'AC' : submitted ? '已交' : '未交'}
                  </Badge>
                </a>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {data.canManage ? (
        <Panel title="管理">
          {(data.adminAttempts || []).length ? (
            <div className="divide-y divide-line-subtle">
              {(data.adminAttempts || []).map((row) => (
                <div key={String(row._id)} className="space-y-2 py-3 text-sm first:pt-0 last:pb-0">
                  <p>
                    {row.uname || row.uid} · {row.status} · 通过 {row.accept || 0}
                  </p>
                  {row.status === 'active' ? (
                    <form method="post">
                      <input type="hidden" name="operation" value="end" />
                      <input type="hidden" name="attemptId" value={String(row._id)} />
                      <Button type="submit" size="sm" variant="secondary">
                        提前结束
                      </Button>
                    </form>
                  ) : null}
                  {row.status === 'active' || row.status === 'ended' ? (
                    <form method="post" className="space-y-2">
                      <input type="hidden" name="operation" value="void" />
                      <input type="hidden" name="attemptId" value={String(row._id)} />
                      <Input name="confirmation" required placeholder={row.voidConfirmation} />
                      <Button type="submit" size="sm" variant="danger">
                        确认作废
                      </Button>
                    </form>
                  ) : null}
                  <Button asChild size="sm" variant="secondary">
                    <a href={`/contest/${tid}/virtual/rejudge?attemptId=${encodeURIComponent(String(row._id))}`}>
                      <Flag />
                      预览并重测
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="还没有虚拟参赛记录。" />
          )}
        </Panel>
      ) : null}
    </Page>
  );
}

export function VirtualContestScoreboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { tdoc?: { docId?: string; title?: string }; rows?: VirtualScoreboardCell[][] };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const header = rows[0] || [];
  const body = rows.slice(1);
  return (
    <Page width="full">
      <PageHeader title="虚拟参赛榜单" description="按各自相对时间计分，与正式榜单完全分开。" />
      <div className="min-w-0 space-y-4">
        <Panel flush className="min-w-0">
          {header.length > 0 ? (
            <ScrollArea className="w-full" orientation="both">
              {/* ds-allow DS005: Table 自带 krypton-table-shell 横向滚动，套不进本页要求的 orientation=both ScrollArea */}
              <table className="krypton-table min-w-max w-full caption-bottom text-sm [&_tr>*:first-child]:pl-5 [&_tr>*:last-child]:pr-5">
                <TableHeader>
                  <TableRow>
                    {header.map((cell, index) => (
                      <TableHead
                        key={`${cell.type || 'col'}-${index}`}
                        className={cn(
                          '3xl:text-md',
                          scoreboardCellClass(cell.type, 'head'),
                          scoreboardStickyClass(index, 'head'),
                        )}
                      >
                        {scoreboardCellText(cell)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {body.map((row, rowIndex) => (
                    <TableRow key={rowIndex} className="group">
                      {row.map((cell, cellIndex) => (
                        <TableCell
                          key={`${rowIndex}-${cellIndex}`}
                          className={cn(
                            '3xl:text-md',
                            scoreboardCellClass(cell.type, 'body'),
                            isProblemScoreboardColumn(cell.type) ? SCOREBOARD_PROBLEM_CELL : undefined,
                            scoreboardStickyClass(cellIndex, 'body'),
                            scoreboardToneClass(cell),
                          )}
                        >
                          {scoreboardCellText(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </ScrollArea>
          ) : (
            <EmptyState compact title="暂无排行数据" />
          )}
        </Panel>
      </div>
    </Page>
  );
}
