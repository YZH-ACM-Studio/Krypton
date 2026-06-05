/**
 * ExamShell — standalone SPA chrome used by all /exam-mode/* pages.
 *
 * Distinct from the OJ AppShell: there is no main-site sidebar, no breadcrumb
 * to /problems / /contests, and no domain selector. Students log in from the
 * Qt client and are dropped straight into this shell.
 *
 * Two layouts:
 *  - Home: top bar only + content (used by ExamModeHomePage).
 *  - Exam detail: top bar + thin square icon sidebar (概览/题目/公告/排名).
 *    The sidebar items deep-link via hash (#overview / #problems / ...).
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  Bell, ClipboardList, ListOrdered, MessageSquare, Moon, Printer, Sun, Swords, Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { ScrollArea } from '@/components/ui/scroll-area';

const THEME_KEY = 'krypton:theme';

export type ExamSection = 'overview' | 'problems' | 'announcements' | 'discussion' | 'ranking' | 'print';

interface ExamSidebarItem {
  key: ExamSection;
  label: string;
  icon: LucideIcon;
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
  const toggle = () => setDark((prev) => {
    const next = !prev;
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch {}
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
 * Live-updating "剩余时间" pill for the exam top bar. Reads beginAt / endAt
 * from `bs.page.data.examMode` (server-injected by `paper.ts`). Falls back
 * to nothing if the page isn't an exam-mode page.
 */
function ExamCountdown() {
  const bs = useBootstrap();
  const examMode = (bs.page.data || {}).examMode || {};
  const beginIso = examMode.beginAt as string | undefined;
  const endIso = examMode.endAt as string | undefined;
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
  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums sm:flex',
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
            : `剩余时间 · ${formatRemaining(state.ms)}`
      }
    >
      <span className="text-[10px] font-normal text-muted-foreground">
        {state.kind === 'before' ? '开赛倒计时' : state.kind === 'ended' ? '已结束' : '剩余'}
      </span>
      <span>{formatRemaining(state.ms)}</span>
    </div>
  );
}

function StudentBadge() {
  const bs = useBootstrap();
  if (!bs.user.signedIn) return null;
  const examMode = (bs.page.data || {}).examMode || {};
  const student = examMode.student as { studentId?: string; realName?: string } | undefined;
  const realName = student?.realName?.trim();
  const studentId = student?.studentId?.trim();
  const avatarUrl = bs.user.avatarUrl;
  // Fallback initials for users without resolved avatar (very rare on Krypton).
  const initials = (realName || bs.user.name || '?').slice(0, 2).toUpperCase();

  // Display: realName · studentId, fall back to OJ uname.
  const line1 = realName || bs.user.name;
  const line2 = studentId || null;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card pl-1.5 pr-2 py-1">
      {/* "考" mark, anchors the badge — visually labels what role this
          chrome belongs to (考生 / 考试模式) regardless of UI scale. */}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 font-sans text-sm font-bold text-primary ring-1 ring-primary/30">
        考
      </div>
      {avatarUrl
        ? (
          <img
            src={avatarUrl}
            alt={line1}
            className="size-7 shrink-0 rounded-full object-cover ring-1 ring-border"
            referrerPolicy="no-referrer"
          />
        )
        : (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
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

function ExamTopBar({
  title, subtitle, right,
}: { title?: string; subtitle?: ReactNode; right?: ReactNode }) {
  const { dark, toggle } = useDark();
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-xl sm:px-6">
      <a href="/exam-mode" className="flex items-center gap-2 font-semibold">
        <Swords className="size-5 text-primary" />
        <span className="hidden sm:inline">Krypton 考试</span>
      </a>
      <div className="mx-2 hidden h-5 w-px bg-border sm:block" />
      <div className="min-w-0 flex-1">
        {title && <p className="truncate text-sm font-semibold">{title}</p>}
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {right}
      <ExamCountdown />
      <button
        type="button"
        onClick={toggle}
        title={dark ? '切换亮色模式' : '切换暗色模式'}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <StudentBadge />
    </header>
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
 * Detail shell: top bar + thin icon sidebar + main outlet.
 * The active section is controlled via the URL hash to keep the inner page
 * a plain component without router knowledge.
 */
export function ExamDetailShell({
  title, subtitle, topBarRight, children,
  section, onSectionChange,
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
        {/* Thin square icon sidebar */}
        <aside className="flex w-20 shrink-0 flex-col border-r bg-card/40">
          <nav className="flex flex-col gap-1.5 p-2.5">
            {EXAM_SIDEBAR.map((item) => {
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSectionChange(item.key)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className="size-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        {/* Main outlet */}
        <main className="min-w-0 flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

export function ExamContestShell({
  children,
}: {
  children: ReactNode;
}) {
  const bs = useBootstrap();
  const data = bs.page.data || {};
  const examMode = data.examMode || {};
  const tdoc = data.tdoc || {};
  const section = (examMode.section || 'overview') as ExamSection;
  const title = examMode.title || tdoc.title || '考试';
  const urls = examMode.urls || {};
  const beginAt = examMode.beginAt ? Date.parse(examMode.beginAt) : NaN;
  const beforeStart = Number.isFinite(beginAt) && Date.now() < beginAt && !examMode.previewMode;
  const lockedBeforeStart = new Set<ExamSection>(['problems', 'print']);
  const items = CLIENT_WORKSPACE_SIDEBAR.filter((item) => item.key !== 'print' || examMode.allowPrint);
  const subtitle = examMode.previewMode ? (
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
      <ExamTopBar title={title} subtitle={subtitle} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-20 shrink-0 flex-col border-r bg-card/40">
          <nav className="flex flex-col gap-1.5 p-2.5">
            {items.map((item) => {
              const active = section === item.key;
              const disabled = beforeStart && lockedBeforeStart.has(item.key);
              const href = disabled ? '#' : hrefFor(item.key);
              return (
                <a
                  key={item.key}
                  href={href}
                  aria-disabled={disabled}
                  title={disabled ? '考试开始后开放' : item.label}
                  onClick={disabled ? (event) => event.preventDefault() : undefined}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors',
                    disabled
                      ? 'cursor-not-allowed text-muted-foreground/45'
                      : active
                      ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className="size-5" />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden" onClickCapture={stopUserProfileLinks}>
          <ScrollArea className="h-full" viewportClassName="p-4 sm:p-6 xl:p-8 2xl:px-10">
            {children}
          </ScrollArea>
        </main>
      </div>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = (s: ExamSection) => {
    if (window.location.hash !== `#${s}`) {
      window.history.replaceState(null, '', `#${s}`);
    }
    setSection(s);
  };
  return [section, update];
}
