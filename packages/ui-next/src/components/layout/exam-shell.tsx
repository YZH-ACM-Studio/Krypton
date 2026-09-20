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
import { Bell, ClipboardList, Code2, ListOrdered, MessageSquare, Moon, Printer, Sun, Swords, Trophy, type LucideIcon } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { TeamCodeSnapshotDrawer } from '@/components/team-code-snapshots';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { readTeamExamModeContext, TeamExamModeSummary } from '@/components/team-exam-mode';
import { useRecordSocket } from '@/hooks/use-record-socket';

const THEME_KEY = 'krypton:theme';

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

function useDark() {
  const bs = useBootstrap();
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored === 'dark';
    } catch {}
    return bs.theme === 'dark';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const toggle = () =>
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      } catch {}
      return next;
    });
  return { dark, toggle };
}

/**
 * Formats a ms duration into `H:MM:SS` (or `MM:SS` when < 1h).
 * Negative durations clamp to `0:00:00`.
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
 * Live-updating "剩余时间" pill for the exam top bar.
 * Exam paper bootstrap projects the personal stop onto `tdoc.endAt`;
 * programming workspace keeps the shared contest `tdoc.endAt`.
 * `examMode` is only a fallback for pages that do not ship `tdoc`.
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
  const danger = state.kind === 'during' && state.ms < 5 * 60 * 1000;
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
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[11px] tabular-nums sm:gap-1.5 sm:px-2.5 sm:text-xs',
        state.kind === 'ended'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : danger
            ? 'border-amber-400/60 bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
            : 'border-border bg-card text-foreground',
      )}
      title={
        state.kind === 'before'
          ? `比赛开始倒计时 · ${formatRemaining(state.ms)}`
          : state.kind === 'ended'
            ? '比赛已结束'
            : `${duringTitle} · ${formatRemaining(state.ms)}`
      }
    >
      <span
        className={cn(
          'text-[10px] font-normal text-muted-foreground',
          state.kind === 'before' && 'hidden sm:inline',
        )}
      >
        {state.kind === 'before' ? '开赛倒计时' : state.kind === 'ended' ? '已结束' : duringLabelNode}
      </span>
      <span>{formatRemaining(state.ms)}</span>
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
    <div className="flex shrink-0 items-center gap-2 rounded-md border bg-card py-1 pl-1.5 pr-2">
      {/* "考" mark, anchors the badge — visually labels what role this
          chrome belongs to (考生 / 考试模式) regardless of UI scale. */}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 font-sans text-sm font-bold text-primary ring-1 ring-primary/30">
        考
      </div>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={line1}
          className="hidden size-7 shrink-0 rounded-full object-cover ring-1 ring-border sm:block"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="hidden size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary sm:flex">
          {initials}
        </div>
      )}
      <div className="hidden min-w-0 leading-tight sm:block">
        <p className="truncate text-xs font-medium">{line1}</p>
        {line2 && <p className="truncate font-mono text-[10px] text-muted-foreground">{line2}</p>}
      </div>
    </div>
  );
}

function ExamTopBar({ title, subtitle, right }: { title?: string; subtitle?: ReactNode; right?: ReactNode }) {
  const { dark, toggle } = useDark();
  return (
    <header className="sticky top-0 z-40 flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-xl sm:gap-3 sm:px-6">
      <a href="/exam-mode" className="flex shrink-0 items-center gap-2 font-semibold">
        <Swords className="size-5 text-primary" />
        <span className="hidden sm:inline">Krypton 考试</span>
      </a>
      <div className="mx-2 hidden h-5 w-px bg-border sm:block" />
      <div className="min-w-0 flex-1 truncate">
        {title && <p className="truncate text-sm font-semibold">{title}</p>}
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {right}
        <ExamCountdown />
        <button
          type="button"
          onClick={toggle}
          title={dark ? '切换亮色模式' : '切换暗色模式'}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <StudentBadge />
      </div>
    </header>
  );
}

function examNavItemClass(active: boolean, disabled: boolean, layout: 'rail' | 'bar') {
  return cn(
    'flex flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors',
    layout === 'rail' ? 'aspect-square gap-1' : 'min-h-11 min-w-[3.75rem] shrink-0 px-2.5',
    disabled
      ? 'cursor-not-allowed text-muted-foreground/45'
      : active
        ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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
        <item.icon className={layout === 'bar' ? 'size-4' : 'size-5'} />
        <span>{item.label}</span>
      </>
    );
    if (hrefFor) {
      return (
        <a
          key={item.key}
          href={disabled ? '#' : hrefFor(item.key)}
          aria-disabled={disabled}
          title={disabled ? '考试开始后开放' : item.label}
          onClick={disabled ? (event) => event.preventDefault() : undefined}
          className={className}
        >
          {inner}
        </a>
      );
    }
    return (
      <button key={item.key} type="button" onClick={() => onSelect?.(item.key)} className={className}>
        {inner}
      </button>
    );
  });

  if (layout === 'rail') {
    return (
      <aside className="hidden min-h-0 w-20 shrink-0 flex-col overflow-y-auto border-r bg-card/40 md:flex">
        <nav aria-label="考试导航" className="flex flex-col gap-1.5 p-2.5">
          {nodes}
        </nav>
      </aside>
    );
  }

  return (
    <nav
      aria-label="考试导航"
      className="flex shrink-0 overflow-x-auto border-t bg-card/95 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden"
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
    <div className="flex h-dvh min-w-0 flex-col bg-background">
      <ExamTopBar />
      <ScrollArea className="min-w-0 flex-1" viewportClassName="p-4 sm:p-6 xl:p-8 2xl:px-10">
        {children}
      </ScrollArea>
    </div>
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
    <div className="flex h-dvh min-w-0 flex-col bg-background">
      <ExamTopBar title={title} subtitle={subtitle} right={topBarRight} />
      <div className="flex min-h-0 flex-1">
        <ExamSectionNav items={EXAM_SIDEBAR} section={section} layout="rail" onSelect={onSectionChange} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <ExamSectionNav items={EXAM_SIDEBAR} section={section} layout="bar" onSelect={onSectionChange} />
    </div>
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
    <span className="text-amber-600 dark:text-amber-300">管理员预览模式</span>
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
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background">
      <ExamTopBar
        title={title}
        subtitle={subtitle}
        right={
          teamContext?.teamId && teamCodeEndpoint ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2 text-xs sm:px-3"
              onClick={() => {
                setPreferredTeamCodeSnapshotId(null);
                setTeamCodeDrawerOpen(true);
              }}
            >
              <Code2 className="size-3.5" />
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
          <ScrollArea className="h-full" viewportClassName="p-4 sm:p-6 xl:p-8 2xl:px-10">
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
