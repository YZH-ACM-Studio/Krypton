import {
  ArrowLeft,
  Bell,
  ChartColumn,
  Eye,
  Gauge,
  Lock,
  MessageSquare,
  PenLine,
  Printer,
  Rows3,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { makeInitials } from '@/lib/format';
import {
  railItems,
  sectionHref,
  timerView,
  type RailItem,
  type SectionName,
  type SetWorkspace,
  type TimerTone,
  type TimerView,
  type WsAnnouncement,
  type WsFlavor,
  type WsPhase,
} from './model';

export interface SetWorkspaceShellProps {
  ws: SetWorkspace;
  section: SectionName;
  column: ReactNode;
  onFinalize: () => void;
  onNavigate?: (href: string) => void;
  children: ReactNode;
}

const RAIL_ICON: Record<string, LucideIcon> = {
  Gauge,
  PenLine,
  Rows3,
  ChartColumn,
  Bell,
  MessageSquare,
  Printer,
};

const TIMER_TONE_CLASS: Record<TimerTone, string> = {
  fg: 'text-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

const BOTTOM_LIMIT = 5;

function railIcon(name: string): LucideIcon {
  const icon = RAIL_ICON[name];
  if (!icon) throw new TypeError(`unknown rail icon ${name}`);
  return icon;
}

function shortRailLabel(label: string): string {
  if (label === '题目列表') return '题目';
  if (label === '提交列表') return '提交';
  return label;
}

function phaseLabel(phase: WsPhase): string {
  switch (phase) {
    case 'upcoming':
      return '即将开始';
    case 'ready':
      return '进行中';
    case 'answering':
      return '作答中';
    case 'submitted':
      return '已交卷';
    case 'ended':
      return '已结束';
    default: {
      const unexpected: never = phase;
      throw new TypeError(`unknown workspace phase ${String(unexpected)}`);
    }
  }
}

function phaseTone(phase: WsPhase): BadgeTone {
  switch (phase) {
    case 'upcoming':
      return 'info';
    case 'ready':
    case 'answering':
      return 'success';
    case 'submitted':
    case 'ended':
      return 'neutral';
    default: {
      const unexpected: never = phase;
      throw new TypeError(`unknown workspace phase ${String(unexpected)}`);
    }
  }
}

function typeLabel(flavor: WsFlavor): string {
  switch (flavor) {
    case 'homework':
      return '作业';
    case 'paper':
      return '考试 · 试卷';
    case 'acm':
      return '考试 · ACM';
    case 'ioi':
      return '考试 · IOI';
    case 'oi':
      return '考试 · OI';
    default: {
      const unexpected: never = flavor;
      throw new TypeError(`unknown workspace flavor ${String(unexpected)}`);
    }
  }
}

/** 窗口内的试卷，以及客户端里已经开赛且未结束的考试。 */
function showExamMode(ws: SetWorkspace): boolean {
  if (ws.kind === 'homework') return false;
  if (ws.phase === 'upcoming' || ws.phase === 'ended') return false;
  if (ws.kind === 'paper') return true;
  return ws.mode === 'client';
}

function noticeStorageKey(tid: string): string {
  return `ws-notice:${tid}`;
}

function parseStoredTime(raw: string): number | null {
  const numeric = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function readNoticeSeen(tid: string): number | null {
  const raw = localStorage.getItem(noticeStorageKey(tid));
  if (raw === null) return null;
  return parseStoredTime(raw);
}

function latestAnnouncementAt(announcements: readonly WsAnnouncement[]): number | null {
  if (announcements.length === 0) return null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const item of announcements) {
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at)) throw new TypeError(`announcement time is invalid: ${item.createdAt}`);
    if (at > latest) latest = at;
  }
  return latest;
}

function noticeUnread(latest: number | null, seen: number | null): boolean {
  if (latest === null) return false;
  if (seen === null) return true;
  return latest > seen;
}

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timerText(view: TimerView, now: number): string {
  if (view.text !== null) return view.text;
  if (view.endAt === null) throw new TypeError('countdown is missing endAt');
  return formatClock(view.endAt - now);
}

function studentIdText(studentId: string | null): string | null {
  if (studentId === null || studentId.trim() === '') return null;
  return studentId;
}

function exitPreviewHref(ws: SetWorkspace): string | null {
  if (ws.urls.manage) return ws.urls.manage;
  return ws.urls.back;
}

function PreviewBanner({ href }: { href: string | null }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning-line bg-warning-soft px-4 py-1.5 text-xs text-fg">
      <Eye aria-hidden className="size-3.5 shrink-0 text-warning-fg" />
      <span>验题模式：你的作答只有你自己看得到，不计成绩。</span>
      <span className="flex-1" />
      {href ? (
        <a href={href} className="shrink-0 text-brand-fg underline-offset-4 hover:underline">
          退出验题
        </a>
      ) : null}
    </div>
  );
}

function BackControl({ ws }: { ws: SetWorkspace }) {
  if (ws.mode === 'client') {
    return (
      <span className="inline-flex size-7 shrink-0 items-center justify-center text-fg-muted" aria-hidden>
        <Lock className="size-3.5" />
      </span>
    );
  }
  if (!ws.urls.back) return null;
  return (
    <Button variant="ghost" size="sm" iconOnly asChild>
      <a href={ws.urls.back} aria-label="返回题目集">
        <ArrowLeft />
      </a>
    </Button>
  );
}

function ModeMark({ ws }: { ws: SetWorkspace }) {
  if (showExamMode(ws)) {
    return (
      <span className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-sm bg-surface-active px-2 text-xs whitespace-nowrap text-fg-muted">
        <Lock className="size-3.5" />
        <span className="hidden sm:inline">考试模式</span>
      </span>
    );
  }
  return (
    <Badge tone="neutral" variant="outline" size="sm">
      {ws.officialRound !== undefined ? { homework: '作业', paper: '考试', contest: '比赛' }[ws.kind] : typeLabel(ws.flavor)}
    </Badge>
  );
}

function TimerBlock({ view, now }: { view: TimerView; now: number }) {
  const tone = TIMER_TONE_CLASS[view.tone];
  return (
    <div className="flex shrink-0 flex-col items-end leading-tight">
      <span className="text-2xs font-normal text-fg-subtle">{view.label}</span>
      <span className={cn('font-mono text-lg font-semibold tabular', tone)}>{timerText(view, now)}</span>
    </div>
  );
}

function StudentMark({ ws }: { ws: SetWorkspace }) {
  const studentId = studentIdText(ws.student.studentId);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="hidden min-w-0 text-right leading-tight sm:block">
        <p className="truncate text-xs text-fg">{ws.student.name}</p>
        {studentId ? <p className="truncate font-mono text-2xs text-fg-subtle">{studentId}</p> : null}
      </div>
      <Avatar className="size-7">
        <AvatarFallback className="text-2xs">{makeInitials(ws.student.name)}</AvatarFallback>
      </Avatar>
    </div>
  );
}

function WorkspaceNavLink({
  ws,
  item,
  section,
  compact,
  unread,
}: {
  ws: SetWorkspace;
  item: RailItem;
  section: SectionName;
  compact: boolean;
  unread: boolean;
}) {
  const Icon = railIcon(item.icon);
  const current = item.section === section;
  const label = compact ? shortRailLabel(item.label) : item.label;
  return (
    <a
      href={sectionHref(ws, item.section)}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'relative flex flex-col items-center gap-0.5 text-2xs text-fg-muted',
        compact ? 'min-w-0 flex-1 px-1 py-1.5' : 'w-full px-1 py-2',
        current ? 'bg-brand-soft font-semibold text-brand-fg' : 'hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon aria-hidden className={compact ? 'size-4' : 'size-5'} />
      <span>{label}</span>
      {item.section === 'notice' && unread ? (
        <span aria-hidden className="absolute top-1 right-2 size-1.5 rounded-full bg-danger" />
      ) : null}
    </a>
  );
}

export function SetWorkspaceShell({ ws, section, column, onFinalize, onNavigate, children }: SetWorkspaceShellProps) {
  const { generatedAt } = useBootstrap();
  const now = useExamNow(generatedAt);
  const timer = timerView(ws, now);
  const items = railItems(ws);
  const latestNoticeAt = latestAnnouncementAt(ws.announcements);
  const [noticeSeenAt, setNoticeSeenAt] = useState<number | null>(() => readNoticeSeen(ws.tid));
  const unread = noticeUnread(latestNoticeAt, noticeSeenAt);

  useEffect(() => {
    if (section !== 'notice' || latestNoticeAt === null) return;
    localStorage.setItem(noticeStorageKey(ws.tid), new Date(latestNoticeAt).toISOString());
    setNoticeSeenAt(latestNoticeAt);
  }, [section, ws.tid, latestNoticeAt]);

  return (
    <div
className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg"
onClickCapture={(event) => {
      if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download') || !link.href) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search && url.hash)) return;
      event.preventDefault();
      event.stopPropagation();
      onNavigate(link.href);
    }}>
      {ws.mode === 'preview' ? <PreviewBanner href={exitPreviewHref(ws)} /> : null}
      <header className="flex h-12 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-line bg-surface px-2 short:h-11 sm:gap-2.5 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BackControl ws={ws} />
          <span className="min-w-0 truncate text-sm font-semibold">{ws.title}</span>
          <ModeMark ws={ws} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={phaseTone(ws.phase)} size="sm" dot className="hidden sm:inline-flex">
            {phaseLabel(ws.phase)}
          </Badge>
          {timer ? <TimerBlock view={timer} now={now} /> : null}
          {ws.action.canFinalize ? (
            <Button type="button" variant="primary" size="sm" onClick={onFinalize}>
              交卷
            </Button>
          ) : null}
          {ws.urls.manage ? (
            <Button variant="secondary" size="sm" asChild>
              <a href={ws.urls.manage}>管理</a>
            </Button>
          ) : null}
          <StudentMark ws={ws} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="题目集导航" className="hidden w-16 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface py-2.5 lg:flex">
          {items.map((item) => (
            <WorkspaceNavLink key={item.section} ws={ws} item={item} section={section} compact={false} unread={unread} />
          ))}
        </nav>
        {column ? (
          <div className="hidden min-h-0 w-60 shrink-0 lg:flex">{column}</div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {/* ds-allow DS004: 底栏安全区用 env(safe-area-inset-bottom)，间距档没有这一档 */}
      <nav
        aria-label="题目集导航"
        className="flex shrink-0 border-t border-line bg-surface lg:hidden pb-[env(safe-area-inset-bottom)]"
      >
        {items.slice(0, BOTTOM_LIMIT).map((item) => (
          <WorkspaceNavLink key={item.section} ws={ws} item={item} section={section} compact unread={unread} />
        ))}
      </nav>
    </div>
  );
}
