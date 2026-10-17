import type { TeachTab } from '@hydrooj/common';
import type { LucideIcon } from 'lucide-react';
import {
  Armchair,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  ExternalLink,
  Eye,
  FolderOpen,
  KeyRound,
  MessageSquare,
  PenLine,
  Send,
  Trophy,
  Users,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Progress, Stat } from '@/components/ui/display';
import { DescriptionList, Panel } from '@/components/ui/panel';
import type { TeachAudienceSummary, TeachContainerSummary, TeachWorkbenchPayload } from '../model';
import { paperFromPayload, paperNumbering, paperSummary } from '../paper';

const MISSING = '\u2014';
const SUMMARY_PREFIX_SEP = ' \u00B7 ';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const READINESS_DESCRIPTION = '开始前确认这几项。点「去处理」直接跳到对应页签。';
const PASS_RATE_DESCRIPTION = '通过人数 / 尝试人数';
const NO_PROBLEM_DETAIL = '去「题目」页签加题';
const PASS_MISSING_DETAIL = '不设则没有补考，只看是否交卷';
const VIGIL_OFF_DETAIL = '未开启 · 在「高级」里配置';
const PERSONAL_DETAIL = '学生点「开始作答」后计时';
const LATE_DENIED_DETAIL = '截止后不能再提交';
const LOCK_OFF_DETAIL = '在「设置」里可以设置';
const INTEGRITY_DETAIL = '在「高级」里配置';
const REDEEM_DETAIL = '在「高级」里管理兑换码';

export interface ReadinessItem {
  state: 'ok' | 'todo' | 'opt';
  title: string;
  detail: string;
  tab: TeachTab | null;
}

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface StatEntry {
  label: string;
  value: string;
}

interface PassRow {
  docId: number;
  label: string;
  title: string;
  accepted: number;
  attempted: number;
}

type QuickTarget =
  | { label: string; icon: LucideIcon; href: string }
  | { label: string; icon: LucideIcon; tab: TeachTab };

const READINESS_ICON: Record<ReadinessItem['state'], LucideIcon> = {
  ok: CheckCircle2,
  todo: CircleAlert,
  opt: Circle,
};

const READINESS_TONE: Record<ReadinessItem['state'], string> = {
  ok: 'text-success-fg',
  todo: 'text-warning-fg',
  opt: 'text-fg-subtle',
};

function requireInstant(value: string | null, field: string): number {
  if (typeof value !== 'string') throw new TypeError(`teach overview ${field} is missing`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`teach overview ${field} is invalid`);
  return ms;
}

function requireLink(href: string | null, name: string): string {
  if (typeof href !== 'string' || href.length === 0) throw new TypeError(`teach overview link ${name} is missing`);
  return href;
}

function countText(value: number | null): string {
  return value === null ? MISSING : String(value);
}

function hasPersonalLimit(minutes: number | null): boolean {
  return typeof minutes === 'number' && minutes > 0;
}

function problemDetail(payload: TeachWorkbenchPayload): string {
  const summary = paperSummary(paperFromPayload(payload.paper, payload.container));
  const prefix = `共 ${payload.paper.problems.length} 道${SUMMARY_PREFIX_SEP}`;
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : summary;
}

function audienceItem(audience: TeachAudienceSummary): ReadinessItem {
  if (audience.mode === 'all') {
    return { state: 'ok', title: '给谁做：所有人', detail: '登录即可看到', tab: null };
  }
  if (audience.mode === 'groups') {
    return {
      state: 'ok',
      title: `已指定 ${audience.groupNames.length} 个用户组`,
      detail: `${audience.groupNames.join('、')}${SUMMARY_PREFIX_SEP}共 ${countText(audience.boundStudentCount)} 名已绑定学生`,
      tab: null,
    };
  }
  if (audience.mode === 'schools') {
    return {
      state: 'ok',
      title: `给谁做：${audience.schoolNames.join('、')}`,
      detail: '按学生记录所在学校',
      tab: null,
    };
  }
  if (audience.mode === 'redeem_only') {
    return { state: 'opt', title: '只能通过兑换码进入', detail: REDEEM_DETAIL, tab: 'advanced' };
  }
  const unexpected: never = audience.mode;
  throw new TypeError(`teach overview audience mode is invalid: ${String(unexpected)}`);
}

function homeworkWindow(container: TeachContainerSummary): ReadinessItem {
  if (hasPersonalLimit(container.durationMinutes)) {
    return {
      state: 'ok',
      title: `个人限时 ${container.durationMinutes} 分钟`,
      detail: PERSONAL_DETAIL,
      tab: null,
    };
  }
  const endMs = requireInstant(container.endAt, 'endAt');
  const penaltyMs = container.penaltySince === null ? null : requireInstant(container.penaltySince, 'penaltySince');
  if (penaltyMs === null || penaltyMs >= endMs) {
    return { state: 'ok', title: '不允许迟交', detail: LATE_DENIED_DETAIL, tab: null };
  }
  const hours = Math.max(1, Math.round((endMs - penaltyMs) / HOUR_MS));
  return { state: 'ok', title: '允许迟交', detail: `截止后 ${hours} 小时内按规则扣分`, tab: null };
}

function vigilItem(container: TeachContainerSummary): ReadinessItem {
  if (!container.vigilEnabled) {
    return { state: 'opt', title: '机房监考（可选）', detail: VIGIL_OFF_DETAIL, tab: 'advanced' };
  }
  return {
    state: 'ok',
    title: '已开启机房监考',
    detail: container.entryMode === 'client_required' ? '必须通过客户端进入' : '普通网页可进入',
    tab: null,
  };
}

function lockItem(container: TeachContainerSummary): ReadinessItem {
  if (container.lockAt === null) {
    return { state: 'opt', title: '不封榜', detail: LOCK_OFF_DETAIL, tab: 'settings' };
  }
  const minutes = Math.round((requireInstant(container.endAt, 'endAt') - requireInstant(container.lockAt, 'lockAt')) / MINUTE_MS);
  return { state: 'ok', title: '封榜', detail: `结束前 ${minutes} 分钟`, tab: null };
}

function passItem(container: TeachContainerSummary): ReadinessItem {
  const score = container.examPassScore;
  if (score === null || score === 0) {
    return { state: 'todo', title: '还没设置及格线', detail: PASS_MISSING_DETAIL, tab: 'settings' };
  }
  const attempts = container.examAttemptLimit === null || container.examAttemptLimit < 1 ? 1 : container.examAttemptLimit;
  return { state: 'ok', title: `及格线 ${score} 分`, detail: `最多考 ${attempts} 次`, tab: null };
}

export function readinessItems(payload: TeachWorkbenchPayload): ReadinessItem[] {
  const { container } = payload;
  const count = payload.paper.problems.length;
  const items: ReadinessItem[] = [
    count === 0
      ? { state: 'todo', title: '还没有题目', detail: NO_PROBLEM_DETAIL, tab: 'problems' }
      : { state: 'ok', title: `已添加 ${count} 道题`, detail: problemDetail(payload), tab: null },
    audienceItem(container.audience),
  ];
  if (container.type === 'exam') items.push(passItem(container));
  if (container.type === 'exam' || container.type === 'acm' || container.type === 'oi') items.push(vigilItem(container));
  if (container.type === 'homework') items.push(homeworkWindow(container));
  if (container.type === 'acm') items.push(lockItem(container));
  if (container.type === 'practice') {
    items.push({ state: 'opt', title: '真实性训练策略（可选）', detail: INTEGRITY_DETAIL, tab: 'advanced' });
  }
  return items;
}

function homeworkDeadlineMs(container: TeachContainerSummary): number {
  const endMs = requireInstant(container.endAt, 'endAt');
  if (container.penaltySince === null) return endMs;
  const penaltyMs = requireInstant(container.penaltySince, 'penaltySince');
  return penaltyMs < endMs ? penaltyMs : endMs;
}

function formatDistance(targetMs: number, nowMs: number): string {
  const remaining = targetMs - nowMs;
  if (remaining <= 0) return '已结束';
  const totalMinutes = Math.floor(remaining / MINUTE_MS);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes - days * 24 * 60 - hours * 60;
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  return `${Math.max(minutes, 1)} 分钟`;
}

function windowStat(labelBefore: string, beginAt: string | null, endAt: string | null, now: number): StatEntry {
  const begin = requireInstant(beginAt, 'beginAt');
  const end = requireInstant(endAt, 'endAt');
  if (now < begin) return { label: labelBefore, value: formatDistance(begin, now) };
  return { label: '距结束', value: formatDistance(end, now) };
}

function statEntries(payload: TeachWorkbenchPayload, now: number): StatEntry[] {
  const { container, paper, stats } = payload;
  if (container.type === 'practice') {
    return [
      { label: '在做', value: String(stats.participantCount) },
      { label: '题目', value: String(paper.problems.length) },
      { label: '阶段', value: String(paper.stages?.length ?? 0) },
    ];
  }
  if (container.type === 'homework') {
    const rows: StatEntry[] = [
      { label: '应交', value: countText(stats.audienceCount) },
      { label: '已提交', value: countText(stats.submittedCount) },
    ];
    if (hasPersonalLimit(container.durationMinutes)) rows.push({ label: '已开始', value: countText(stats.startedCount) });
    rows.push({ label: '距截止', value: formatDistance(homeworkDeadlineMs(container), now) });
    return rows;
  }
  if (container.type === 'exam') {
    return [
      { label: '应考', value: countText(stats.audienceCount) },
      { label: '已开考', value: countText(stats.startedCount) },
      { label: '已交卷', value: countText(stats.finalizedCount) },
      windowStat('距开考', container.beginAt, container.endAt, now),
    ];
  }
  return [
    { label: '参赛', value: String(stats.participantCount) },
    { label: '提交', value: countText(stats.recordCount) },
    { label: '题目', value: String(paper.problems.length) },
    windowStat('距开赛', container.beginAt, container.endAt, now),
  ];
}

function passRows(payload: TeachWorkbenchPayload): PassRow[] | null {
  if (payload.container.type === 'practice') return null;
  const stats = payload.stats.problemStats;
  if (stats === null || stats.length === 0) return null;
  const byId = new Map(stats.map((entry) => [entry.docId, entry]));
  const numbers = paperNumbering(paperFromPayload(payload.paper, payload.container));
  return payload.paper.problems.map((problem) => {
    const label = numbers.get(problem.docId);
    if (!label) throw new TypeError(`teach overview missing number for ${problem.docId}`);
    const stat = byId.get(problem.docId);
    return {
      docId: problem.docId,
      label,
      title: problem.title,
      accepted: stat?.accepted ?? 0,
      attempted: stat?.attempted ?? 0,
    };
  });
}

function passPercent(accepted: number, attempted: number): number {
  if (attempted <= 0) return 0;
  return Math.round((accepted * 100) / attempted);
}

function quickTargets(payload: TeachWorkbenchPayload): QuickTarget[] {
  const { container, capabilities } = payload;
  const { links, type } = container;
  if (type === 'practice') {
    const rows: QuickTarget[] = [
      { label: '学生视角', icon: Eye, href: links.studentView },
      { label: '学习进度', icon: Users, tab: 'grades' },
    ];
    if (links.redemption) rows.push({ label: '兑换码', icon: KeyRound, href: links.redemption });
    return rows;
  }
  if (type === 'homework') {
    return [
      { label: '学生视角', icon: Eye, href: links.studentView },
      { label: '全部提交', icon: Send, tab: 'records' },
      { label: '附件文件', icon: FolderOpen, href: links.files },
    ];
  }
  if (type === 'exam') {
    const rows: QuickTarget[] = [
      { label: '预览试卷', icon: Eye, href: links.studentView },
      { label: '答疑与公告', icon: MessageSquare, href: requireLink(links.clarification, 'clarification') },
    ];
    if (capabilities.canGrade) rows.push({ label: '主观题阅卷', icon: PenLine, href: requireLink(links.grading, 'grading') });
    rows.push({ label: '座位与机房', icon: Armchair, tab: 'advanced' });
    return rows;
  }
  return [
    { label: '答疑与公告', icon: MessageSquare, href: requireLink(links.clarification, 'clarification') },
    { label: '排行榜', icon: Trophy, href: requireLink(links.scoreboard, 'scoreboard') },
    { label: '参赛选手', icon: Users, href: requireLink(links.users, 'users') },
    { label: '全部提交', icon: Send, tab: 'records' },
  ];
}

function createdLabel(iso: string, locale: string): string {
  if (!Number.isFinite(Date.parse(iso))) throw new TypeError('teach overview createdAt is invalid');
  return formatDateTime(iso, locale);
}

function infoItems(container: TeachContainerSummary, locale: string): Array<{ term: string; detail: string }> {
  const items = [{ term: '所有者', detail: container.owner.name }];
  if (container.type !== 'practice') {
    const names = container.maintainers.map((user) => user.name);
    items.push({ term: '协作者', detail: names.length === 0 ? '无' : names.join('、') });
  }
  items.push({ term: '创建于', detail: createdLabel(container.createdAt, locale) });
  if (container.copiedFrom) {
    items.push({ term: '来源', detail: `复制自 ${container.copiedFrom.ownerName}《${container.copiedFrom.title}》` });
  }
  items.push({ term: '学校共享', detail: container.schoolShared ? '共享中' : '未共享' });
  return items;
}

function QuickLinkControl({
  target,
  onNavigateTab,
}: {
  target: QuickTarget;
  onNavigateTab: (tab: TeachTab) => void;
}) {
  const Icon = target.icon;
  const content = (
    <>
      <Icon />
      <span className="min-w-0 flex-1 truncate text-left">{target.label}</span>
      {'href' in target ? <ExternalLink /> : <ChevronRight />}
    </>
  );
  if ('href' in target) {
    return (
      <Button asChild variant="ghost" className="h-auto min-h-12 w-full justify-start px-2">
        <a href={target.href} target="_blank" rel="noreferrer">{content}</a>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" className="h-auto min-h-12 w-full justify-start px-2" onClick={() => onNavigateTab(target.tab)}>
      {content}
    </Button>
  );
}

export function OverviewTab({ payload, onNavigateTab }: TeachTabProps) {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const rates = passRows(payload);
  return (
    // ds-allow DS004: 详情页主栏加 20rem 侧栏，间距档写不出这条轨道
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel title="准备情况" description={READINESS_DESCRIPTION}>
          <ul className="flex flex-col gap-3">
            {readinessItems(payload).map((item) => {
              const Icon = READINESS_ICON[item.state];
              const tab = item.tab;
              return (
                <li key={`${item.state}:${item.title}`} className="flex items-center gap-3">
                  <Icon className={cn('size-4 shrink-0', READINESS_TONE[item.state])} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg">{item.title}</div>
                    <div className="text-xs text-fg-subtle">{item.detail}</div>
                  </div>
                  {tab ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => onNavigateTab(tab)}>
                      去处理
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel flush>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 p-4 md:grid-cols-4 md:divide-x md:divide-line-subtle [&>*]:md:pl-6 [&>*:first-child]:md:pl-0">
            {statEntries(payload, now).map((entry) => (
              <Stat key={entry.label} label={entry.label} value={entry.value} />
            ))}
          </div>
        </Panel>
        {rates ? (
          <Panel
            title="各题通过率"
            description={PASS_RATE_DESCRIPTION}
            actions={(
              <Button type="button" variant="ghost" size="sm" onClick={() => onNavigateTab('grades')}>
                看成绩
              </Button>
            )}
          >
            <div className="flex flex-col gap-3">
              {rates.map((row) => (
                <div key={row.docId} className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-sm font-medium tabular">{row.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
                  <div className="w-24 shrink-0">
                    <Progress value={passPercent(row.accepted, row.attempted)} size="sm" />
                  </div>
                  <span className="shrink-0 tabular text-xs">{`${row.accepted} / ${row.attempted}`}</span>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
      <aside className="flex flex-col gap-4">
        <Panel title="快捷入口">
          <div className="flex flex-col gap-1">
            {quickTargets(payload).map((target) => (
              <QuickLinkControl key={target.label} target={target} onNavigateTab={onNavigateTab} />
            ))}
          </div>
        </Panel>
        <Panel
          title="基本信息"
          footer={(
            <Button type="button" variant="secondary" size="sm" onClick={() => onNavigateTab('settings')}>
              编辑设置
            </Button>
          )}
        >
          <DescriptionList items={infoItems(payload.container, bootstrap.locale)} />
        </Panel>
      </aside>
    </div>
  );
}
