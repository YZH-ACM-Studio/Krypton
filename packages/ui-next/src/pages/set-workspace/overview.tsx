import { roundPaperPoints } from '@hydrooj/common';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Circle, Minus, X } from 'lucide-react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { Column } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress, StatusDot } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { durationText, formatMoment } from '@/pages/problem-sets/model';
import { postForm, postJson } from '@/pages/teach/api';
import { isAcmWorkspace, firstOpenTarget, sectionHref, objectiveVerdictPending, type CellState, type SetWorkspace, type WsGroup, type WsInfoRow, type WsItem, type WsPaper } from '@/pages/set-workspace/model';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DASH = '\u2014';
const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})/g;
const CLIENT_TITLE = '请在机房客户端进入';
const CLIENT_NOTE = '这场考试只能用机房电脑上的 Krypton 客户端参加。在浏览器里只能查看说明和公告。';
const ATTEND_FALLBACK = '开始做作业失败。';
const START_FALLBACK = '开始作答失败。';
const RETAKE_FALLBACK = '再考一次失败。';
const TEAM_LINK = '打开原题页（代码快照）';

type ActionTone = 'info' | 'success' | 'neutral' | 'warning';
type ActionVariant = 'primary' | 'secondary';
type DialogKind = 'start' | 'retake';

interface ActionLink {
  label: string;
  variant: ActionVariant;
  href?: string;
  disabled?: boolean;
  onClick?: () => void;
}

interface ActionProgress {
  value: number;
  left: string;
  right: string;
}

interface ActionView {
  tone: ActionTone;
  status: string;
  headline: string;
  mono?: boolean;
  sentence?: string;
  warn?: boolean;
  /** Client-only notice has no status line and no controls. */
  bare?: boolean;
  buttons: ActionLink[];
  hint?: string;
  signup?: { url: string; invitationRequired?: boolean };
  extraLink?: { href: string; label: string };
  progress?: ActionProgress;
}

interface ActionHandlers {
  onStart: () => void;
  onStartNow: () => void;
  onRetake: () => void;
  onAttend: (code?: string) => void;
  attendBusy: boolean;
}

interface KindRow {
  key: string;
  range: string;
  name: string;
  count: number;
  points: number;
  answered: string;
  score: string;
  href: string;
}

interface LetterRow {
  key: string;
  state: CellState;
  label: string;
  title: string;
  result: string;
  href: string;
}

function instant(iso: string): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) throw new TypeError(`invalid timestamp ${iso}`);
  return value;
}

function requireIso(iso: string | null, label: string): string {
  if (!iso) throw new TypeError(`${label} is missing`);
  return iso;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function countdown(iso: string, now: number): string {
  const total = Math.floor(Math.max(0, instant(iso) - now) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function num(value: number | null): string {
  return value === null ? DASH : String(value);
}

function personallyTimed(ws: SetWorkspace): boolean {
  const minutes = ws.window.durationMinutes;
  return minutes !== null && minutes > 0;
}

function requireMinutes(ws: SetWorkspace): number {
  const minutes = ws.window.durationMinutes;
  if (minutes === null || minutes <= 0) throw new TypeError('personal duration is missing');
  return minutes;
}

function openRange(ws: SetWorkspace, now: number): string {
  return `${formatMoment(ws.window.beginAt, now)} – ${formatMoment(ws.window.endAt, now)}`;
}

function windowRemaining(ws: SetWorkspace, now: number): number {
  return instant(ws.window.endAt) - now;
}

function limitTooShort(ws: SetWorkspace, now: number): boolean {
  if (!personallyTimed(ws)) return false;
  return windowRemaining(ws, now) < requireMinutes(ws) * MINUTE_MS;
}

function remainLabel(ms: number): string {
  return durationText(Math.max(0, ms));
}

function deadlineIso(ws: SetWorkspace): string {
  return ws.window.dueAt ?? ws.window.endAt;
}

function latePeriod(ws: SetWorkspace): boolean {
  if (ws.window.dueAt === null) return false;
  return instant(ws.window.dueAt) < instant(ws.window.endAt);
}

function teamContest(ws: SetWorkspace): boolean {
  if (ws.team) return true;
  return ws.info.some((row) => row.label === '参赛' && row.text === '团队赛');
}

function contestLength(beginIso: string, endIso: string): string {
  const ms = instant(endIso) - instant(beginIso);
  if (ms <= 0) throw new TypeError('contest window must be positive');
  const hours = ms / HOUR_MS;
  if (Number.isInteger(hours)) return `${hours} 小时`;
  const tenths = Math.round(hours * 10) / 10;
  if (Math.abs(hours - tenths) < 1e-6) return `${tenths} 小时`;
  return durationText(ms);
}

function problemsHome(ws: SetWorkspace): string {
  return sectionHref(ws, 'problems');
}

function continueHref(ws: SetWorkspace): string {
  const target = firstOpenTarget(ws);
  if (!target) return problemsHome(ws);
  if (target.q !== null) return sectionHref(ws, 'problems', { q: target.q });
  return sectionHref(ws, 'problems', { kind: target.kind });
}

function ratio(done: number, total: number): number {
  if (total <= 0) return 0;
  return (done / total) * 100;
}

function countPair(done: number, total: number): string {
  return `${done}/${total}`;
}

function teamProblemHref(ws: SetWorkspace): string | null {
  const template = ws.urls.teamProblem;
  if (!template) return null;
  const pid = ws.groups[0]?.items[0]?.pid;
  if (pid === undefined) throw new TypeError('team problem link is missing a problem');
  return template.replace('__PID__', String(pid));
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  throw error;
}

function startDialogText(ws: SetWorkspace, now: number): string {
  const minutes = requireMinutes(ws);
  const endLabel = formatMoment(ws.window.endAt, now);
  if (limitTooShort(ws, now)) {
    return `现在开始只剩 ${remainLabel(windowRemaining(ws, now))}，${endLabel} 统一截止。`;
  }
  return `开始后计时 ${minutes} 分钟，中途不能暂停；${endLabel} 统一截止。`;
}

function retakeDialogText(ws: SetWorkspace): string {
  if (ws.officialRound !== undefined) {
    const number = (ws.officialRound?.roundNo ?? 0) + 1;
    const limit = ws.window.durationMinutes === null ? '' : `本轮限时 ${ws.window.durationMinutes} 分钟。`;
    return `将开始第 ${number} 轮作答，上一轮答案和成绩会保留。${limit}`;
  }
  const paper = ws.paper;
  if (!paper) throw new TypeError('retake is missing paper facts');
  if (paper.attemptLimit === null) throw new TypeError('retake is missing an attempt limit');
  const used = `已用 ${paper.attemptsUsed}/${paper.attemptLimit} 次。`;
  const minutes = ws.window.durationMinutes;
  if (minutes === null || minutes <= 0) return `会清空上一轮的答卷，重新抽题。${used}`;
  return `会清空上一轮的答卷，重新抽题并计时 ${minutes} 分钟。${used}`;
}

function withJudging(sentence: string, paper: WsPaper | null): string {
  if (paper?.judging !== true) return sentence;
  return sentence === '' ? '评测中' : `${sentence}评测中`;
}

function scoreHeadline(ws: SetWorkspace): string {
  if (isAcmWorkspace(ws)) return `通过 ${countPair(ws.totals.accepted ?? 0, ws.totals.problemCount)}`;
  return `${num(ws.totals.score)} / ${num(ws.totals.maxScore)}`;
}

function passSentence(paper: WsPaper | null): string | undefined {
  if (!paper || paper.passScore === null) return undefined;
  if (paper.judging) return `及格线 ${paper.passScore} · 评测中`;
  if (paper.passed === null) return `及格线 ${paper.passScore}`;
  return `及格线 ${paper.passScore} · ${paper.passed ? '已及格' : '未及格'}`;
}

function homeworkProgress(ws: SetWorkspace): ActionProgress {
  return {
    value: ratio(ws.totals.answered, ws.totals.problemCount),
    left: `已作答 ${countPair(ws.totals.answered, ws.totals.problemCount)}`,
    right: ws.totals.showScore
      ? `当前 ${num(ws.totals.score)} / ${num(ws.totals.maxScore)} 分`
      : '客观题待评测',
  };
}

function remainSentence(ws: SetWorkspace, now: number): string {
  const deadline = deadlineIso(ws);
  const remaining = instant(deadline) - now;
  const head = remaining <= 0 ? '已过截止' : `还有 ${durationText(remaining)}`;
  if (!latePeriod(ws)) return head;
  return `${head} · 截止后可迟交到 ${formatMoment(ws.window.endAt, now)}，按老师设置扣分`;
}

/** Ready homework: the late-submit clause belongs only to the untimed answering branch. */
function unattendedReadySentence(ws: SetWorkspace, now: number): string {
  const remaining = instant(deadlineIso(ws)) - now;
  if (remaining > 0) return `还有 ${durationText(remaining)}`;
  if (latePeriod(ws) && now < instant(ws.window.endAt)) return '已过截止，迟交会扣分';
  return '已过截止';
}

function contestResult(ws: SetWorkspace, item: WsItem): string {
  if (isAcmWorkspace(ws)) {
    if (item.state === 'correct') return '已通过';
    if (item.state === 'wrong') return `错误 ${item.submits} 次`;
    return DASH;
  }
  return item.excluded ? '已剔除' : `${num(item.lastScore)} / ${item.score}`;
}

function contestScoreHeadline(ws: SetWorkspace): string {
  if (!ws.action.attended) return '未参加';
  return scoreHeadline(ws);
}

function clientOnly(): ActionView {
  return {
    tone: 'warning',
    status: '',
    headline: CLIENT_TITLE,
    sentence: CLIENT_NOTE,
    bare: true,
    buttons: [],
  };
}

function paperAction(ws: SetWorkspace, now: number, handlers: ActionHandlers): ActionView {
  const answered = countPair(ws.totals.answered, ws.totals.problemCount);
  if (ws.phase === 'upcoming') {
    const minutes = ws.window.durationMinutes;
    const limit = minutes !== null && minutes > 0
      ? ` · 个人限时 ${minutes} 分钟，点「开始作答」后计时`
      : '';
    return {
      tone: 'info',
      status: '即将开始',
      headline: `距开考 ${countdown(ws.window.beginAt, now)}`,
      mono: true,
      sentence: `${openRange(ws, now)}${limit}`,
      buttons: [{ label: '开始作答', variant: 'primary', disabled: true }],
      hint: '开考后才能开始',
    };
  }
  if (ws.phase === 'ready') {
    const minutes = ws.window.durationMinutes;
    const timed = minutes !== null && minutes > 0;
    const endLabel = formatMoment(ws.window.endAt, now);
    return {
      tone: 'success',
      status: '进行中',
      headline: '还没开始',
      sentence: timed
        ? `个人限时 ${minutes} 分钟，点「开始作答」后计时；最晚 ${endLabel} 必须交卷。`
        : `最晚 ${endLabel} 必须交卷。`,
      buttons: [{
        label: '开始作答',
        variant: 'primary',
        onClick: timed ? handlers.onStart : handlers.onStartNow,
        disabled: !ws.action.canStart,
      }],
    };
  }
  if (ws.phase === 'answering') {
    const stop = ws.window.personalEndAt ?? ws.window.endAt;
    const stopLabel = formatMoment(stop, now);
    const sentence = personallyTimed(ws)
      ? `个人截止 ${stopLabel} · 已答 ${answered} · 需手动保存`
      : `最晚 ${formatMoment(ws.window.endAt, now)} 必须交卷 · 已答 ${answered} · 需手动保存`;
    return {
      tone: 'success',
      status: '作答中',
      headline: `剩余 ${countdown(stop, now)}`,
      mono: true,
      sentence,
      buttons: [{ label: '继续作答', variant: 'secondary', href: continueHref(ws) }],
      progress: {
        value: ratio(ws.totals.answered, ws.totals.problemCount),
        left: `已答 ${answered}`,
        right: `${stopLabel} 截止`,
      },
    };
  }
  if (ws.phase === 'submitted') {
    const showScore = ws.totals.showScore;
    const sentence = showScore ? '' : ws.officialRound !== undefined ? '成绩按老师设置的时间公布。' : `${formatMoment(ws.window.endAt, now)} 考试结束后公布成绩。`;
    const buttons: ActionLink[] = [
      { label: '查看我的答卷', variant: 'secondary', href: problemsHome(ws) },
    ];
    if (ws.action.canRetake) buttons.unshift({ label: ws.officialRound !== undefined ? '重新作答' : '再考一次', variant: 'primary', onClick: handlers.onRetake });
    return {
      tone: 'success',
      status: '进行中',
      headline: showScore ? isAcmWorkspace(ws) ? scoreHeadline(ws) : `${num(ws.totals.score)} 分` : '已交卷',
      sentence: withJudging(sentence, ws.paper),
      buttons,
    };
  }
  if (ws.phase === 'ended') {
    const retake = ws.action.canRetake;
    const buttons: ActionLink[] = [
      { label: '查看答卷', variant: retake ? 'secondary' : 'primary', href: problemsHome(ws) },
    ];
    if (retake) buttons.unshift({ label: ws.officialRound !== undefined ? '重新作答' : '再考一次', variant: 'primary', onClick: handlers.onRetake });
    return {
      tone: 'neutral',
      status: '已结束',
      headline: ws.totals.showScore ? scoreHeadline(ws) : '已结束',
      sentence: passSentence(ws.paper),
      buttons,
    };
  }
  throw new TypeError(`paper overview has no action for phase ${ws.phase}`);
}

function homeworkAction(ws: SetWorkspace, now: number, handlers: ActionHandlers): ActionView {
  const go: ActionLink = { label: '去做题', variant: 'primary', href: continueHref(ws) };
  if (ws.phase === 'upcoming') {
    return {
      tone: 'info',
      status: '即将开放',
      headline: `${formatMoment(ws.window.beginAt, now)} 开放`,
      sentence: `${openRange(ws, now)} · 开放后才能看到题目`,
      buttons: [{ label: '去做题', variant: 'primary', disabled: true }],
      hint: '开放后才能做',
    };
  }
  if (ws.phase === 'ready' && personallyTimed(ws)) {
    const minutes = requireMinutes(ws);
    const short = limitTooShort(ws, now);
    const sentence = short
      ? `现在开始只剩 ${remainLabel(windowRemaining(ws, now))}：${formatMoment(ws.window.endAt, now)} 统一截止，个人限时 ${minutes} 分钟用不完。`
      : `${openRange(ws, now)} 之间都能开始 · 个人限时 ${minutes} 分钟，点「开始作答」后计时`;
    return {
      tone: 'success',
      status: '进行中',
      headline: '还没开始',
      sentence,
      warn: short,
      buttons: [{ label: '开始作答', variant: 'primary', onClick: handlers.onStart, disabled: !ws.action.canStart }],
    };
  }
  if (ws.phase === 'ready' && !ws.action.attended && ws.locked?.reason === 'need_attend') {
    return {
      tone: 'success',
      status: '进行中',
      headline: `${formatMoment(deadlineIso(ws), now)} 截止`,
      sentence: unattendedReadySentence(ws, now),
      buttons: [{ label: '开始做作业', variant: 'primary', onClick: handlers.onAttend, disabled: handlers.attendBusy }],
    };
  }
  if (ws.phase === 'ready') {
    return {
      tone: 'success',
      status: '进行中',
      headline: `${formatMoment(deadlineIso(ws), now)} 截止`,
      sentence: unattendedReadySentence(ws, now),
      buttons: [],
    };
  }
  if (ws.phase === 'answering' && personallyTimed(ws)) {
    const personalEnd = requireIso(ws.window.personalEndAt, 'personalEndAt');
    return {
      tone: 'success',
      status: '作答中',
      headline: `剩余 ${countdown(personalEnd, now)}`,
      mono: true,
      sentence: `个人截止 ${formatMoment(personalEnd, now)} · 已作答 ${countPair(ws.totals.answered, ws.totals.problemCount)} · 到点后不能再提交`,
      buttons: [go],
      progress: homeworkProgress(ws),
    };
  }
  if (ws.phase === 'answering') {
    return {
      tone: 'success',
      status: '进行中',
      headline: `${formatMoment(deadlineIso(ws), now)} 截止`,
      sentence: remainSentence(ws, now),
      buttons: [go],
      progress: homeworkProgress(ws),
    };
  }
  if (ws.phase === 'submitted' || ws.phase === 'ended') {
    return {
      tone: 'neutral',
      status: '已结束',
      headline: ws.totals.showScore ? scoreHeadline(ws) : '待评测',
      sentence: '只按截止前最后一次提交计分',
      buttons: [{ label: '查看答卷', variant: 'secondary', href: problemsHome(ws) }],
    };
  }
  throw new TypeError(`homework overview has no action for phase ${ws.phase}`);
}

function contestSignupSentence(ws: SetWorkspace, now: number): string {
  const side = teamContest(ws) ? '团队赛' : '个人赛';
  return `${formatMoment(ws.window.beginAt, now)} 开始 · 时长 ${contestLength(ws.window.beginAt, ws.window.endAt)} · ${side}`;
}

function contestAction(ws: SetWorkspace, now: number): ActionView {
  const endLabel = formatMoment(ws.window.endAt, now);
  if (ws.phase === 'ended') {
    const practice = ws.urls.practice;
    const virtual = ws.urls.virtual;
    const buttons: ActionLink[] = [];
    if (practice) buttons.push({ label: '赛后补题', variant: 'primary', href: practice });
    if (virtual) buttons.push({ label: '虚拟参赛', variant: practice ? 'secondary' : 'primary', href: virtual });
    const closed = !practice && !virtual ? ' · 赛后补题未开放' : '';
    return {
      tone: 'neutral',
      status: '已结束',
      headline: contestScoreHeadline(ws),
      sentence: `${endLabel} 结束${closed}`,
      buttons,
    };
  }
  if (ws.phase === 'submitted') {
    const stop = ws.window.personalEndAt ?? ws.window.endAt;
    return {
      tone: 'success',
      status: '进行中',
      headline: contestScoreHeadline(ws),
      sentence: `${formatMoment(stop, now)} 个人时间已到`,
      buttons: [],
    };
  }
  if (ws.phase === 'answering') {
    const stop = ws.window.personalEndAt ?? ws.window.endAt;
    const sentence = isAcmWorkspace(ws)
      ? `${endLabel} 结束 · 已通过 ${countPair(ws.totals.accepted ?? 0, ws.totals.problemCount)}`
      : `${endLabel} 结束 · 当前 ${num(ws.totals.score)} 分`;
    const extra = teamProblemHref(ws);
    return {
      tone: 'success',
      status: '进行中',
      headline: `剩余 ${countdown(stop, now)}`,
      mono: true,
      sentence,
      buttons: [{ label: '进入比赛', variant: 'primary', href: problemsHome(ws) }],
      extraLink: extra ? { href: extra, label: TEAM_LINK } : undefined,
    };
  }
  if (ws.phase === 'upcoming' && ws.action.attended) {
    const sentence = ws.team
      ? `已随队伍「${ws.team.teamName}」报名 · 开始后点「进入比赛」`
      : '已报名 · 开始后点「进入比赛」';
    return {
      tone: 'info',
      status: '即将开始',
      headline: `距开始 ${countdown(ws.window.beginAt, now)}`,
      mono: true,
      sentence,
      buttons: [{ label: '进入比赛', variant: 'primary', disabled: true }],
      hint: '开始后才能进入',
    };
  }
  if ((ws.phase === 'upcoming' || ws.phase === 'ready') && !ws.action.attended) {
    const running = ws.phase === 'ready';
    const attend = ws.urls.attend;
    return {
      tone: running ? 'success' : 'info',
      status: running ? '进行中' : '即将开始',
      headline: running ? `剩余 ${countdown(ws.window.endAt, now)}` : `距开始 ${countdown(ws.window.beginAt, now)}`,
      mono: true,
      sentence: teamContest(ws) ? '团队赛按批次定版的队伍参赛' : contestSignupSentence(ws, now),
      buttons: [],
      signup: !teamContest(ws) && attend ? { url: attend } : undefined,
    };
  }
  throw new TypeError(`contest overview has no action for phase ${ws.phase}`);
}

function buildAction(ws: SetWorkspace, now: number, handlers: ActionHandlers): ActionView {
  if (ws.locked?.reason === 'client_only') return clientOnly();
  if (ws.officialRound !== undefined && ws.team?.role === 'member' && ws.phase !== 'ended') {
 return {
    tone: 'info', status: ws.phase === 'upcoming' ? '即将开始' : ws.phase === 'submitted' ? '本轮已结束' : '团队作答',
    headline: '跟随队长的作答轮次', sentence: '由队长开始、保存答案和交卷，队员可以查看团队答卷。',
    buttons: ws.officialRound ? [{ label: '查看团队答卷', variant: 'secondary', href: problemsHome(ws) }] : [],
  };
}
  if (ws.action.invitationRequired && ws.action.canAttend && ws.urls.attend) {
 return {
    tone: 'info', status: ws.phase === 'upcoming' ? '即将开始' : '进行中', headline: '输入邀请码后参加',
    sentence: '请填写老师提供的邀请码。', buttons: [],
    signup: { url: ws.urls.attend, invitationRequired: true },
  };
}
  if (ws.officialRound !== undefined || ws.kind === 'paper') return paperAction(ws, now, handlers);
  if (ws.kind === 'homework') return homeworkAction(ws, now, handlers);
  return contestAction(ws, now);
}

function ActionControl({ button }: { button: ActionLink }) {
  const className = 'w-full sm:w-auto';
  if (button.href && button.disabled !== true) {
    return (
      <Button asChild variant={button.variant} className={className}>
        <a href={button.href}>{button.label}</a>
      </Button>
    );
  }
  return (
    <Button type="button" variant={button.variant} className={className} disabled={button.disabled === true} onClick={button.onClick}>
      {button.label}
    </Button>
  );
}

function SignupForm({ url, invitationRequired, onAttend, busy }: {
  url: string; invitationRequired?: boolean; onAttend: (code?: string) => void; busy: boolean;
}) {
  const sent = useRef(false);
  const [pending, setPending] = useState(false);
  return (
    <form
      method="post"
      action={url}
      className="flex w-full flex-col gap-2 sm:w-auto sm:items-end"
      onSubmit={(event) => {
        if (invitationRequired) {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const code = fields.get('code');
          if (typeof code !== 'string' || code.trim() === '') return;
          onAttend(code.trim());
          return;
        }
        if (sent.current) {
          event.preventDefault();
          return;
        }
        sent.current = true;
        setPending(true);
      }}
    >
      <input type="hidden" name="operation" value="attend" />
      {invitationRequired ? <label className="flex flex-col gap-1 text-sm text-fg">邀请码<Input name="code" aria-label="邀请码" required autoComplete="off" disabled={busy} /></label> : null}
      <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={pending || busy}>{invitationRequired ? '确认邀请码' : '报名'}</Button>
    </form>
  );
}

function ActionProgressBar({ progress }: { progress: ActionProgress }) {
  return (
    <div>
      <Progress value={progress.value} size="sm" />
      <div className="mt-1 flex justify-between gap-4 text-xs text-fg-subtle tabular">
        <span>{progress.left}</span>
        <span>{progress.right}</span>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <DialogBody><Alert tone="danger">{error}</Alert></DialogBody> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
          <Button type="button" variant="primary" loading={pending} onClick={() => { void onConfirm(); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function postStart(ws: SetWorkspace, kind: DialogKind): Promise<void> {
  const url = ws.urls.start;
  if (!url) throw new TypeError('start url is missing');
  const body = ws.kind === 'homework' ? new URLSearchParams({ operation: 'start' }) : new URLSearchParams();
  const fallback = kind === 'retake' ? RETAKE_FALLBACK : START_FALLBACK;
  if (ws.officialRound !== undefined) await postJson(url, {}, fallback);
  else await postForm(url, body, fallback);
  window.location.assign(problemsHome(ws));
}

async function postAttend(ws: SetWorkspace, code?: string): Promise<void> {
  const url = ws.urls.attend;
  if (!url) throw new TypeError('attend url is missing');
  const body = new URLSearchParams({ operation: 'attend' });
  if (code !== undefined) body.set('code', code);
  await postForm(url, body, ATTEND_FALLBACK);
  window.location.assign(ws.officialRound !== undefined ? ws.urls.overview : problemsHome(ws));
}

function ActionCard({ ws, now }: { ws: SetWorkspace; now: number }) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [attendError, setAttendError] = useState<string | null>(null);
  const [attendBusy, setAttendBusy] = useState(false);
  const attendLock = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const attend = (code?: string) => {
    if (attendLock.current) return;
    attendLock.current = true;
    setAttendBusy(true);
    setAttendError(null);
    void postAttend(ws, code).catch((error: unknown) => {
      attendLock.current = false;
      setAttendBusy(false);
      setAttendError(errorText(error));
    });
  };
  const view = buildAction(ws, now, {
    onStart: () => { setDialogError(null); setDialog('start'); },
    onStartNow: () => {
      setActionError(null);
      void postStart(ws, 'start').catch((error: unknown) => {
        setActionError(errorText(error));
      });
    },
    onRetake: () => { setDialogError(null); setDialog('retake'); },
    attendBusy,
    onAttend: attend,
  });
  const hasActions = view.signup !== undefined || view.buttons.length > 0 || view.hint !== undefined || view.extraLink !== undefined || attendError !== null || actionError !== null;
  const confirm = async () => {
    if (dialog === null || pending) return;
    setPending(true);
    setDialogError(null);
    try {
      await postStart(ws, dialog);
    } catch (error) {
      setPending(false);
      setDialogError(errorText(error));
    }
  };
  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className={cn('flex flex-col gap-4', hasActions && 'sm:flex-row sm:items-center sm:justify-between')}>
          <div className="min-w-0">
            {view.bare ? null : (
              <div className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <StatusDot tone={view.tone} />
                <span>{view.status}</span>
              </div>
            )}
            <p className={cn('text-2xl font-semibold text-balance text-fg tabular', view.mono && 'font-mono', !view.bare && 'mt-1')}>{ws.totals.showScore && (ws.phase === 'submitted' || ws.phase === 'ended') ? (
              <a href={sectionHref(ws, 'records')} className="hover:text-brand-fg hover:underline" aria-label="查看我的提交">{view.headline}</a>
            ) : view.headline}</p>
            {view.sentence ? (
              <p className={cn('mt-1.5 max-w-prose text-sm text-pretty', view.warn ? 'font-medium text-warning-fg' : 'text-fg-muted')}>{view.sentence}</p>
            ) : null}
          </div>
          {hasActions ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              {view.signup ? <SignupForm {...view.signup} busy={attendBusy} onAttend={attend} /> : view.buttons.map((button) => (
                <ActionControl key={button.label} button={button} />
              ))}
              {view.hint ? <span className="text-xs text-fg-subtle">{view.hint}</span> : null}
              {view.extraLink ? (
                <a href={view.extraLink.href} className="text-xs text-brand-fg underline-offset-4 hover:underline">{view.extraLink.label}</a>
              ) : null}
              {attendError ? <Alert tone="danger">{attendError}</Alert> : null}
              {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
            </div>
          ) : null}
        </div>
        {view.progress ? <ActionProgressBar progress={view.progress} /> : null}
      </div>
      {dialog ? (
        <ConfirmDialog
          title={dialog === 'retake' ? ws.officialRound !== undefined ? '重新作答？' : '再考一次？' : '开始作答？'}
          description={dialog === 'retake' ? retakeDialogText(ws) : startDialogText(ws, now)}
          confirmLabel={dialog === 'retake' ? ws.officialRound !== undefined ? '重新作答' : '再考一次' : '开始作答'}
          pending={pending}
          error={dialogError}
          onClose={() => { if (!pending) setDialog(null); }}
          onConfirm={confirm}
        />
      ) : null}
    </Panel>
  );
}

function formatInfoText(text: string, now: number): string {
  return text.replace(ISO_IN_TEXT, (iso) => formatMoment(iso, now));
}

function infoDetail(row: WsInfoRow, now: number): string {
  const fields = [row.text !== undefined, row.at !== undefined, row.range !== undefined].filter(Boolean).length;
  if (fields !== 1) throw new TypeError(`info row ${row.label} must set exactly one of text, at, range`);
  if (row.text !== undefined) return formatInfoText(row.text, now);
  if (row.at !== undefined) return formatMoment(row.at, now);
  const range = row.range;
  if (!range) throw new TypeError(`info row ${row.label} is missing its range`);
  return `${formatMoment(range[0], now)} – ${formatMoment(range[1], now)}`;
}

function problemDescription(ws: SetWorkspace): string {
  const count = ws.totals.problemCount;
  if (isAcmWorkspace(ws)) return `${count} 题 · 按通过题数和罚时排名`;
  const fullMark = ws.objectiveVerdictVisible && !ws.officialRound
    ? ws.totals.maxScore
    : roundPaperPoints(ws.groups.reduce((sum, group) => sum + groupPoints(group), 0));
  if (ws.flavor === 'ioi' || ws.flavor === 'oi') return `${count} 题 · 满分 ${num(fullMark)}`;
  return `共 ${count} 题，满分 ${num(fullMark)}`;
}

function kindRange(group: WsGroup): string {
  if (group.no === null) throw new TypeError(`group ${group.kind} is missing its kind number`);
  return `${group.no}-1 ~ ${group.no}-${group.items.length}`;
}

function groupPoints(group: WsGroup): number {
  return roundPaperPoints(group.items.reduce((sum, item) => sum + item.score, 0));
}

function groupScore(group: WsGroup): number {
  return roundPaperPoints(group.items.reduce((sum, item) => sum + (item.lastScore ?? 0), 0));
}

function answeredIn(group: WsGroup): number {
  return group.items.filter((item) => item.state !== 'empty').length;
}

const KIND_COLUMNS: Column<KindRow>[] = [
  {
    key: 'range',
    header: '题号',
    cell: (row) => <span className="font-mono text-fg-muted tabular">{row.range}</span>,
  },
  { key: 'name', header: '题型', stackRole: 'title', cell: (row) => row.name },
  { key: 'count', header: '题数', align: 'right', cell: (row) => <span className="tabular">{row.count}</span> },
  { key: 'points', header: '分值', align: 'right', cell: (row) => <span className="tabular">{row.points}</span> },
  { key: 'answered', header: '作答', align: 'right', cell: (row) => <span className="tabular">{row.answered}</span> },
  {
    key: 'score',
    header: '得分',
    align: 'right',
    stackRole: 'meta',
    cell: (row) => <span className="tabular">{row.score}</span>,
  },
];

function stateLabel(state: CellState, pending: boolean): string {
  if (pending && state !== 'empty' && state !== 'draft') return '待评测';
  if (state === 'correct') return '已通过';
  if (state === 'wrong') return '未通过';
  if (state === 'partial') return '部分正确';
  if (state === 'submitted') return '已提交';
  if (state === 'draft') return '未提交';
  return '未作答';
}

function StateIcon({ state, pending = false }: { state: CellState; pending?: boolean }) {
  const label = stateLabel(state, pending);
  let icon: ReactNode;
  let tone = 'text-fg-subtle';
  if (state === 'correct') {
    icon = <Check aria-hidden="true" className="size-4" />;
    tone = 'text-success-fg';
  } else if (state === 'wrong') {
    icon = <X aria-hidden="true" className="size-4" />;
    tone = 'text-danger-fg';
  } else if (state === 'partial') {
    icon = <Minus aria-hidden="true" className="size-4" />;
    tone = 'text-info-fg';
  } else {
    icon = <Circle aria-hidden="true" className="size-4" />;
  }
  return (
    <span role="img" aria-label={label} className={cn('inline-flex', tone)}>
      {icon}
    </span>
  );
}

const LETTER_COLUMNS: Column<LetterRow>[] = [
  { key: 'state', header: '状态', stackRole: 'hidden', cell: (row) => <StateIcon state={row.state} /> },
  {
    key: 'label',
    header: '题号',
    stackRole: 'title',
    cell: (row) => <span className="font-mono font-semibold tabular">{row.label}</span>,
  },
  { key: 'title', header: '题目', cell: (row) => row.title },
  {
    key: 'result',
    header: '我的结果',
    align: 'right',
    stackRole: 'meta',
    cell: (row) => <span className="text-fg-muted tabular">{row.result}</span>,
  },
];

const ONE_PER_PAGE = new Set<WsGroup['kind']>(['program_fill', 'function', 'programming']);

function groupHref(ws: SetWorkspace, group: WsGroup): string {
  if (!ONE_PER_PAGE.has(group.kind)) return sectionHref(ws, 'problems', { kind: group.kind });
  const open = group.items.find((item) => item.state === 'empty' || item.state === 'draft') ?? group.items[0];
  if (!open) return sectionHref(ws, 'problems');
  return sectionHref(ws, 'problems', { q: open.pid });
}

function kindRows(ws: SetWorkspace): KindRow[] {
  const locked = ws.locked !== null;
  return ws.groups.map((group) => ({
    key: group.kind,
    range: kindRange(group),
    name: group.name,
    count: group.items.length,
    points: groupPoints(group),
    answered: locked ? DASH : `${answeredIn(group)} / ${group.items.length}`,
    score: ws.officialRound !== undefined
      ? group.items.some((item) => item.feedback?.score && item.lastScore !== null) ? String(groupScore(group)) : DASH
      : objectiveVerdictPending(ws, group.kind) ? '待评测' : ws.totals.showScore ? String(groupScore(group)) : DASH,
    href: groupHref(ws, group),
  }));
}

function letterRows(ws: SetWorkspace): LetterRow[] {
  const locked = ws.locked !== null;
  const rows: LetterRow[] = [];
  for (const group of ws.groups) {
    for (const item of group.items) {
      rows.push({
        key: String(item.pid),
        state: item.state,
        label: item.excluded ? `${item.label} · 已剔除` : item.label,
        title: locked ? '开始后显示' : item.title,
        result: contestResult(ws, item),
        href: sectionHref(ws, 'problems', { q: item.pid }),
      });
    }
  }
  return rows;
}

function ProblemTable({ ws }: { ws: SetWorkspace }) {
  if (ws.numbering === 'letter') {
    const rows = letterRows(ws);
    return (
      <Panel title="题目" description={problemDescription(ws)} flush>
        <DataTable columns={LETTER_COLUMNS} rows={rows} rowKey={(row) => row.key} rowHref={(row) => row.href} mobile="scroll" />
      </Panel>
    );
  }
  const rows = kindRows(ws);
  const columns = isAcmWorkspace(ws)
    ? KIND_COLUMNS.filter((column) => column.key !== 'points' && column.key !== 'score').concat({
      key: 'accepted', header: '通过', align: 'right', cell: (row) => {
        const group = ws.groups.find((candidate) => candidate.kind === row.key);
        if (!group) throw new TypeError(`group ${row.key} is missing`);
        const visible = ws.officialRound !== undefined
          ? group.items.every((item) => item.feedback?.verdict)
          : ws.totals.showScore;
        return <span className="tabular">{visible ? group.items.filter((item) => item.state === 'correct').length : DASH}</span>;
      },
    })
    : KIND_COLUMNS;
  return (
    <Panel title="题目" description={problemDescription(ws)} flush>
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} rowHref={(row) => row.href} mobile="scroll" />
    </Panel>
  );
}

function LatestAnnouncement({ ws, now }: { ws: SetWorkspace; now: number }) {
  const item = ws.announcements[0];
  if (!item) return null;
  return (
    <Panel title="最新公告">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <p className="font-medium text-fg">{item.subject}</p>
        <p className="text-xs text-fg-subtle tabular">{formatMoment(item.createdAt, now)}</p>
      </div>
      {item.content !== '' ? (
        <div className="mt-2">
          <MarkdownView content={item.content} />
        </div>
      ) : null}
    </Panel>
  );
}

function OverviewBody({ ws, now }: { ws: SetWorkspace; now: number }) {
  return (
    // ds-allow DS004: 概览右栏固定 20rem，间距档写不出这条轨道
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 gap-4">
        {ws.description.trim() !== '' ? (
          <Panel title="说明">
            <MarkdownView content={ws.description} />
          </Panel>
        ) : null}
        <ProblemTable ws={ws} />
        <LatestAnnouncement ws={ws} now={now} />
      </div>
      <Panel title="信息">
        <DescriptionList items={ws.info.map((row) => ({ term: row.label, detail: infoDetail(row, now) }))} />
      </Panel>
    </div>
  );
}

export function WorkspaceOverview({ ws }: { ws: SetWorkspace }) {
  const now = useExamNow(useBootstrap().generatedAt);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken">
      <div className="mx-auto grid w-full max-w-5xl gap-4 p-4">
        <ActionCard ws={ws} now={now} />
        {ws.urls.discussion ? <div><Button asChild variant="secondary"><a href={ws.urls.discussion}>进入讨论区</a></Button></div> : null}
        <OverviewBody ws={ws} now={now} />
      </div>
    </div>
  );
}
