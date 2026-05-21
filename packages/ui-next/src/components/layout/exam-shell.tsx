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
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell, ClipboardList, ListOrdered, LogOut, Moon, Sun, Swords, Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

const THEME_KEY = 'krypton:theme';

export type ExamSection = 'overview' | 'problems' | 'announcements' | 'ranking';

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

function ExamTopBar({
  title, subtitle, right,
}: { title?: string; subtitle?: ReactNode; right?: ReactNode }) {
  const bs = useBootstrap();
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
      <button
        type="button"
        onClick={toggle}
        title={dark ? '切换亮色模式' : '切换暗色模式'}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      {bs.user.signedIn && (
        <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs">
          <div className="flex size-6 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
            {bs.user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden sm:block">
            <p className="font-medium leading-none">{bs.user.name}</p>
          </div>
          <a
            href={bs.urls.logout}
            title="退出"
            className="ml-1 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-3.5" />
          </a>
        </div>
      )}
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
      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 xl:p-8 2xl:px-10">
        {children}
      </main>
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

/** Read the section from the URL hash (`#overview`, etc.). */
export function useExamSection(defaultSection: ExamSection = 'overview'): [ExamSection, (s: ExamSection) => void] {
  const parse = (): ExamSection => {
    const raw = window.location.hash.replace(/^#/, '');
    if (['overview', 'problems', 'announcements', 'ranking'].includes(raw)) {
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
