/**
 * ExamShell — standalone SPA chrome used by all /exam-mode/* pages.
 *
 * Distinct from the OJ AppShell: there is no main-site sidebar, no breadcrumb
 * to /problems / /contests, and no domain selector. Students log in from the
 * Qt client and are dropped straight into this shell.
 *
 * Two layouts:
 *  - Home: top bar only + content (used by ExamModeHomePage).
 *  - Exam detail: top bar + section nav (概览/题目/公告/排名).
 *    md+: thin square icon rail. <md: bottom horizontally scrollable tabs.
 *    The items deep-link via hash (#overview / #problems / ...).
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Bell, ClipboardList, Code2, ListOrdered, MessageSquare, Monitor, Moon, Printer, Sun, Swords, Trophy, type LucideIcon } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useThemePreference, type ThemePreference } from '@/lib/theme';
import { TeamCodeSnapshotDrawer } from '@/components/team-code-snapshots';
import { Button } from '@/components/ui/button';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToastProvider } from '@/components/ui/toast';
import { readTeamExamModeContext, TeamExamModeSummary } from '@/components/team-exam-mode';
import { useRecordSocket } from '@/hooks/use-record-socket';

const THEME_TABS: MiniTabItem<ThemePreference>[] = [
  { value: 'light', label: null, ariaLabel: '亮色', icon: Sun },
  { value: 'dark', label: null, ariaLabel: '暗色', icon: Moon },
  { value: 'system', label: null, ariaLabel: '跟随系统', icon: Monitor },
];

export type ExamSection = 'overview' | 'problems' | 'announcements' | 'discussion' | 'ranking' | 'print';

interface ExamSidebarItem {
  key: ExamSection;
  label: string;
  icon: LucideIcon;
}

interface ExamShellModeData {
  allowPrint?: boolean;
  beginAt?: string;
  endAt?: string;
  previewMode?: boolean;
  section?: ExamSection;
  student?: {
    studentId?: string;
    realName?: string;
  };
  tid?: unknown;
  title?: string;
  urls?: Record<string, string | undefined>;
  [key: string]: unknown;
}

interface ExamShellPageData {
  examMode?: ExamShellModeData;
  tdoc?: { title?: string; beginAt?: string | Date; endAt?: string | Date };
  paperStarted?: boolean;
  contestBeginAt?: string | Date;
  contestEndAt?: string | Date;
}

function examShellClockIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
}

const EXAM_SIDEBAR: ExamSidebarItem[] = [
  { key: 'overview', label: '概览', icon: ClipboardList },
  { key: 'problems', label: '题目', icon: ListOrdered },
  { key: 'announcements', label: '公告', icon: Bell },
  { key: 'ranking', label: '排名', icon: Trophy },
];

const CLIENT_WORKSPACE_SIDEBAR: ExamSidebarItem[] = [
  { key: 'overview', label: '概览', icon: ClipboardList },
  { key: 'problems', label: '题目', icon: ListOrdered },
  { key: 'announcements', label: '公告', icon: Bell },
  { key: 'discussion', label: '讨论', icon: MessageSquare },
  { key: 'ranking', label: '排名', icon: Trophy },
  { key: 'print', label: '打印', icon: Printer },
];

/**
 * Formats a ms duration into `HH:MM:SS`.
 * Negative durations clamp to `00:00:00`.
 */
function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Live-updating "剩余时间" for the exam top bar.
 * Exam paper bootstrap projects the personal stop onto `tdoc.endAt`;
 * programming workspace keeps the shared contest `tdoc.endAt`.
 * `examMode` is only a fallback for pages that do not ship `tdoc`.
 * Color follows remaining time: text-fg, then warning at 5 minutes, danger at 1 minute.
 */
function ExamCountdown() {
  const bs = useBootstrap();
  const data = (bs.page.data || {}) as ExamShellPageData;
  const examMode = data.examMode || {};
  const wallClock = data.paperStarted === false;
  const beginIso = wallClock
    ? examShellClockIso(data.contestBeginAt) ?? examShellClockIso(data.tdoc?.beginAt) ?? examMode.beginAt
    : examShellClockIso(data.tdoc?.beginAt) ?? examMode.beginAt;
  const endIso = wallClock
    ? examShellClockIso(data.contestEndAt) ?? examShellClockIso(data.tdoc?.endAt) ?? examMode.endAt
    : examShellClockIso(data.tdoc?.endAt) ?? examMode.endAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endIso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endIso]);

  const state = useMemo(() => {
    if (!endIso) return null;
    const endAt = Date.parse(endIso);
    const beginAt = beginIso ? Date.parse(beginIso) : 0;
    if (!Number.isFinite(endAt)) return null;
    if (beginAt && now < beginAt) {
      return { kind: 'before' as const, ms: beginAt - now };
    }
    if (now >= endAt) return { kind: 'ended' as const, ms: 0 };
    return { kind: 'during' as const, ms: endAt - now };
  }, [beginIso, endIso, now]);

  if (!state) return null;
  const tone = state.kind === 'ended' || (state.kind === 'during' && state.ms <= 60 * 1000)
    ? 'text-danger-fg'
    : state.kind === 'during' && state.ms <= 5 * 60 * 1000
      ? 'text-warning-fg'
      : 'text-fg';
  const duringLabel = wallClock ? '整场剩余' : '剩余';
  const duringTitle = wallClock ? '整场剩余' : '剩余时间';
  const duringLabelNode =
    wallClock ? (
      <>
        <span className="sm:hidden">剩余</span>
        <span className="hidden sm:inline">整场剩余</span>
      </>
    ) : (
      duringLabel
    );
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 sm:gap-1"
      title={
        state.kind === 'before'
          ? `比赛开始倒计时 · ${formatRemaining(state.ms)}`
          : state.kind === 'ended'
            ? '比赛已结束'
            : `${duringTitle} · ${formatRemaining(state.ms)}`
      }
    >
      <span className="whitespace-nowrap text-2xs font-normal text-fg-subtle">
        {state.kind === 'before' ? '开赛倒计时' : state.kind === 'ended' ? '已结束' : duringLabelNode}
      </span>
      <span className={cn('font-mono text-lg font-semibold tabular', tone)}>{formatRemaining(state.ms)}</span>
    </div>
  );
}

function StudentBadge() {
  const bs = useBootstrap();
  if (!bs.user.signedIn) return null;
  const examMode = ((bs.page.data || {}) as ExamShellPageData).examMode || {};
  const student = examMode.student;
  const realName = student?.realName?.trim();
  const studentId = student?.studentId?.trim();
  const avatarUrl = bs.user.avatarUrl;
  // Fallback initials for users without resolved avatar (very rare on Krypton).
  const initials = (realName || bs.user.name || '?').slice(0, 2).toUpperCase();

  // Display: realName · studentId, fall back to OJ uname.
  const line1 = realName || bs.user.name;
  const line2 = studentId || null;

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-1 pr-1">
      {/* "考" mark, anchors the badge — visually labels what role this
          chrome belongs to (考生 / 考试模式) regardless of UI scale. */}
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-xs font-semibold text-brand-fg ring-1 ring-ring">
        考
      </div>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={line1}
          className="hidden size-6 shrink-0 rounded-full object-cover ring-1 ring-line md:block"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft font-mono text-2xs font-semibold text-brand-fg md:flex">
          {initials}
        </div>
      )}
      <div className="hidden min-w-0 max-w-16 leading-tight sm:block">
        <p className="min-w-0 truncate text-xs font-medium text-fg">{line1}</p>
        {line2 && <p className="min-w-0 truncate font-mono text-2xs text-fg-subtle">{line2}</p>}
      </div>
    </div>
  );
}

function ExamTopBar({ title, subtitle, right }: { title?: string; subtitle?: ReactNode; right?: ReactNode }) {
  const bs = useBootstrap();
  const { preference, setPreference } = useThemePreference(bs.theme);
  return (
    <header className="flex h-12 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-bg px-1.5 short:h-11 sm:gap-2 sm:px-3">
      <a
        href="/exam-mode"
        aria-label="Krypton 考试"
        className="flex shrink-0 items-center gap-1.5 rounded-md font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Swords className="size-5 shrink-0 text-brand-fg" aria-hidden="true" />
        <span className="hidden sm:inline">Krypton 考试</span>
      </a>
      <div className="mx-2 hidden h-5 w-px shrink-0 bg-line md:block" />
      <div className="min-w-0 flex-1 overflow-hidden">
        {title && <p className="min-w-0 truncate text-sm font-semibold text-fg">{title}</p>}
        {subtitle && <div className="min-w-0 truncate text-xs text-fg-subtle">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
        {right}
        <ExamCountdown />
        <MiniTabs
          size="sm"
          aria-label="主题"
          value={preference}
          onValueChange={setPreference}
          items={THEME_TABS}
          className="shrink-0"
        />
        <StudentBadge />
      </div>
    </header>
  );
}

function examNavItemClass(active: boolean, disabled: boolean, layout: 'rail' | 'bar') {
  return cn(
    'h-auto! flex-col gap-0.5 text-2xs font-medium',
    layout === 'rail' ? 'aspect-square w-full gap-1 px-1 [&_svg]:size-5!' : 'min-h-11 min-w-16 shrink-0 px-2.5 [&_svg]:size-4!',
    disabled
      ? 'cursor-not-allowed text-fg-disabled hover:bg-transparent hover:text-fg-disabled'
      : active
        ? 'bg-surface-active text-fg hover:bg-surface-active hover:text-fg'
        : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
  );
}

function ExamSectionNav({
  items,
  section,
  layout,
  hrefFor,
  onSelect,
  isDisabled,
}: {
  items: ExamSidebarItem[];
  section: ExamSection;
  layout: 'rail' | 'bar';
  hrefFor?: (key: ExamSection) => string;
  onSelect?: (key: ExamSection) => void;
  isDisabled?: (key: ExamSection) => boolean;
}) {
  const nodes = items.map((item) => {
    const active = section === item.key;
    const disabled = isDisabled?.(item.key) === true;
    const className = examNavItemClass(active, disabled, layout);
    const inner = (
      <>
        <item.icon className={layout === 'bar' ? 'size-4' : 'size-5'} aria-hidden="true" />
        <span>{item.label}</span>
      </>
    );
    if (hrefFor) {
      return (
        <Button key={item.key} asChild variant="ghost" size="sm" className={className}>
          <a
            href={disabled ? '#' : hrefFor(item.key)}
            aria-disabled={disabled}
            title={disabled ? '考试开始后开放' : item.label}
            onClick={disabled ? (event) => event.preventDefault() : undefined}
          >
            {inner}
          </a>
        </Button>
      );
    }
    return (
      <Button key={item.key} type="button" variant="ghost" size="sm" onClick={() => onSelect?.(item.key)} className={className}>
        {inner}
      </Button>
    );
  });

  if (layout === 'rail') {
    return (
      <aside className="hidden min-h-0 w-20 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex">
        <nav aria-label="考试导航" className="flex flex-col gap-1.5 p-2.5">
          {nodes}
        </nav>
      </aside>
    );
  }

  return (
    <nav
      aria-label="考试导航"
      className="flex shrink-0 overflow-x-auto overflow-y-hidden scrollbar-none border-t border-line bg-surface pb-[max(.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="flex min-w-max gap-1 px-2 py-1.5">{nodes}</div>
    </nav>
  );
}

/**
 * Home shell: just a top bar + content area. No sidebar.
 */
export function ExamHomeShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-dvh min-w-0 flex-col bg-bg text-fg">
        <ExamTopBar />
        <ScrollArea className="min-w-0 flex-1" viewportClassName="p-4 sm:p-6 xl:p-8">
          {children}
        </ScrollArea>
      </div>
    </ToastProvider>
  );
}

/**
 * Detail shell: top bar + section nav (md+ icon rail, <md bottom tabs) + main outlet.
 * The active section is controlled via the URL hash to keep the inner page
 * a plain component without router knowledge.
 */
export function ExamDetailShell({
  title,
  subtitle,
  topBarRight,
  children,
  section,
  onSectionChange,
}: {
  title?: string;
  subtitle?: ReactNode;
  topBarRight?: ReactNode;
  children: ReactNode;
  section: ExamSection;
  onSectionChange: (s: ExamSection) => void;
}) {
  return (
    <ToastProvider>
      <div className="flex h-dvh min-w-0 flex-col bg-bg text-fg">
        <ExamTopBar title={title} subtitle={subtitle} right={topBarRight} />
        <div className="flex min-h-0 flex-1">
          <ExamSectionNav items={EXAM_SIDEBAR} section={section} layout="rail" onSelect={onSectionChange} />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        </div>
        <ExamSectionNav items={EXAM_SIDEBAR} section={section} layout="bar" onSelect={onSectionChange} />
      </div>
    </ToastProvider>
  );
}

export function ExamContestShell({ children }: { children: ReactNode }) {
  const bs = useBootstrap();
  const data = bs.page.data || {};
  const examMode = (data as ExamShellPageData).examMode || {};
  const tdoc = (data as ExamShellPageData).tdoc || {};
  const section = (examMode.section || 'overview') as ExamSection;
  const title = examMode.title || tdoc.title || '考试';
  const urls = examMode.urls || {};
  const beginAt = examMode.beginAt ? Date.parse(examMode.beginAt) : Number.NaN;
  const beforeStart = Number.isFinite(beginAt) && Date.now() < beginAt && !examMode.previewMode;
  const lockedBeforeStart = new Set<ExamSection>();
  const items = CLIENT_WORKSPACE_SIDEBAR.filter((item) => item.key !== 'print' || examMode.allowPrint);
  const teamContext = readTeamExamModeContext(examMode);
  const teamRoleTid = String(examMode.tid || '');
  const teamRoleRevision = teamContext?.teamInfo?.revision;
  const teamCodeEndpoint = String(urls.teamCodeSnapshots || '');
  const [teamCodeDrawerOpen, setTeamCodeDrawerOpen] = useState(false);
  const [preferredTeamCodeSnapshotId, setPreferredTeamCodeSnapshotId] = useState<string | null>(null);
  const openIncomingTeamCode = useCallback((snapshotId: string) => {
    setPreferredTeamCodeSnapshotId(snapshotId);
    setTeamCodeDrawerOpen(true);
  }, []);
  useRecordSocket({
    path: '/exam-mode/team-role-conn',
    filters: {
      tid: teamRoleTid || undefined,
      teamId: teamContext?.teamId || undefined,
      teamRevision: Number.isSafeInteger(teamRoleRevision) ? teamRoleRevision : undefined,
    },
    onRdoc: () => {},
    onTeamRoleChange: teamContext ? () => window.location.reload() : undefined,
    onTeamCodeAvailable: teamContext?.teamRole === 'member' ? openIncomingTeamCode : undefined,
    disabled: !teamContext?.teamId || !teamRoleTid || !Number.isSafeInteger(teamRoleRevision),
  });
  const subtitle = teamContext ? (
    <TeamExamModeSummary context={teamContext} />
  ) : examMode.previewMode ? (
    <span className="text-warning-fg">管理员预览模式</span>
  ) : null;
  const stopUserProfileLinks = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith('/user/')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const hrefFor = (key: ExamSection) => {
    if (key === 'overview') return urls.overview || '#';
    if (key === 'problems') return urls.problems || '#';
    if (key === 'announcements') return urls.announcements || '#';
    if (key === 'discussion') return urls.discussion || '#';
    if (key === 'ranking') return urls.ranking || '#';
    if (key === 'print') return urls.print || '#';
    return '#';
  };

  return (
    <ToastProvider>
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-bg text-fg">
        <ExamTopBar
          title={title}
          subtitle={subtitle}
          right={
            teamContext?.teamId && teamCodeEndpoint ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5 px-1.5 text-xs sm:px-3"
                aria-label="代码快照"
                onClick={() => {
                  setPreferredTeamCodeSnapshotId(null);
                  setTeamCodeDrawerOpen(true);
                }}
              >
                <Code2 className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">代码快照</span>
              </Button>
            ) : null
          }
        />
        <div className="flex min-h-0 flex-1">
          <ExamSectionNav
            items={items}
            section={section}
            layout="rail"
            hrefFor={hrefFor}
            isDisabled={(key) => beforeStart && lockedBeforeStart.has(key)}
          />
          <main className="min-w-0 flex-1 overflow-hidden" onClickCapture={stopUserProfileLinks}>
            <ScrollArea className="h-full" viewportClassName="p-4 sm:p-6 xl:p-8">
              {children}
            </ScrollArea>
          </main>
        </div>
        <ExamSectionNav
          items={items}
          section={section}
          layout="bar"
          hrefFor={hrefFor}
          isDisabled={(key) => beforeStart && lockedBeforeStart.has(key)}
        />
        {teamContext?.teamId && teamCodeEndpoint ? (
          <TeamCodeSnapshotDrawer
            open={teamCodeDrawerOpen}
            onOpenChange={setTeamCodeDrawerOpen}
            endpoint={teamCodeEndpoint}
            locale={bs.locale}
            preferredSnapshotId={preferredTeamCodeSnapshotId}
          />
        ) : null}
      </div>
    </ToastProvider>
  );
}

/** Read the section from the URL hash (`#overview`, etc.). */
export function useExamSection(defaultSection: ExamSection = 'overview'): [ExamSection, (s: ExamSection) => void] {
  const parse = (): ExamSection => {
    const raw = window.location.hash.replace(/^#/, '');
    if (['overview', 'problems', 'announcements', 'discussion', 'ranking', 'print'].includes(raw)) {
      return raw as ExamSection;
    }
    return defaultSection;
  };
  const [section, setSection] = useState<ExamSection>(parse);
  useEffect(() => {
    const handler = () => setSection(parse());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const update = (s: ExamSection) => {
    if (window.location.hash !== `#${s}`) {
      window.history.replaceState(null, '', `#${s}`);
    }
    setSection(s);
  };
  return [section, update];
}
