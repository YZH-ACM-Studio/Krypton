import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  LogOut,
  Mail,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Swords,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sidebar } from '@/components/layout/sidebar';
import { PageResolver } from '@/pages/resolver';
import { makeInitials } from '@/lib/format';

const SIDEBAR_KEY = 'krypton:sidebar-collapsed';
const THEME_KEY = 'krypton:theme';

/**
 * Templates that render their own SPA shell (no main OJ sidebar/topbar).
 * For these we skip `AppShell` entirely and let `PageResolver` paint its own.
 */
const STANDALONE_TEMPLATES = new Set([
  'exam_mode_home.html',
  'exam_paper.html',
]);

function AppShell() {
  const bs = useBootstrap();
  // Exam-mode pages bring their own shell.
  if (STANDALONE_TEMPLATES.has(bs.page.templateName)) {
    return <PageResolver />;
  }
  return <DefaultAppShell />;
}

function DefaultAppShell() {
  const bs = useBootstrap();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored === 'dark';
    } catch {}
    return bs.theme === 'dark';
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const toggleTheme = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.lang = bs.locale || 'zh-CN';
    document.title = `${bs.domain.name} — Krypton`;
  }, [bs, dark]);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = () => setUserMenuOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [userMenuOpen]);

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} />

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — frosted glass */}
        <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl saturate-150 sm:px-4">
          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-4" />
          </Button>

          {/* Collapse toggle (desktop) */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-8 md:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>

          {/* Domain name / breadcrumb */}
          <a href={bs.urls.home} className="flex items-center gap-1.5 md:hidden">
            <Swords className="size-4 text-primary" />
          </a>
          <span className="hidden text-sm text-muted-foreground md:inline-block">
            {bs.domain.name}
          </span>

          <div className="flex-1" />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={toggleTheme}
            title={dark ? '切换亮色模式' : '切换暗色模式'}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          {/* Right: user section */}
          <div className="flex items-center gap-1.5">
            {bs.user.signedIn ? (
              <>
                {/* Messages icon */}
                <Button asChild variant="ghost" size="icon" className="relative size-8">
                  <a href={bs.urls.messages}>
                    <Mail className="size-4" />
                    {bs.user.unreadMessages > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                        {bs.user.unreadMessages > 9 ? '9+' : bs.user.unreadMessages}
                      </span>
                    )}
                  </a>
                </Button>

                {/* Settings shortcut */}
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <a href={`${bs.urls.settings}/preference`}>
                    <Settings className="size-4" />
                  </a>
                </Button>

                {/* User avatar + dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent"
                    onClick={(e) => { e.stopPropagation(); setUserMenuOpen((p) => !p); }}
                  >
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[10px]">{makeInitials(bs.user.name)}</AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-[120px] truncate text-sm font-medium sm:inline-block">
                      {bs.user.name}
                    </span>
                  </button>

                  {userMenuOpen && (
                    <div
                      className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-lg border bg-popover p-1 shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-3 py-2">
                        <p className="text-sm font-medium">{bs.user.name}</p>
                        <p className="text-[11px] text-muted-foreground">{bs.user.rp} RP</p>
                      </div>
                      <div className="my-1 h-px bg-border" />
                      <a href={`${bs.urls.settings}/preference`} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent">
                        <Settings className="size-3.5" />
                        账号设置
                      </a>
                      <a href={bs.urls.messages} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent">
                        <Mail className="size-3.5" />
                        消息
                        {bs.user.unreadMessages > 0 && (
                          <Badge className="ml-auto h-4 px-1 text-[10px]">{bs.user.unreadMessages}</Badge>
                        )}
                      </a>
                      <div className="my-1 h-px bg-border" />
                      <a href={bs.urls.logout} className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                        <LogOut className="size-3.5" />
                        退出登录
                      </a>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                  <a href={bs.urls.login}>登录</a>
                </Button>
                <Button asChild size="sm" className="h-7 text-xs">
                  <a href={bs.urls.register}>注册</a>
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Content area — full-bleed; pages decide their own max width.
            Outer padding scales: 12 / 24 / 32 / 40 px on mobile→ultrawide. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-6 xl:p-8 2xl:px-10">
          <div className="min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}


const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$',
  component: PageResolver,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
