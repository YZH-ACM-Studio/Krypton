import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import {
  Eye,
  LogOut,
  Mail,
  Menu as MenuIcon,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Settings,
  Sun,
  Swords,
  User,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnnouncementPopover } from '@/components/announcement-popover';
import { CollectPendingBadge } from '@/components/collect-pending-badge';
import { KryptonFooter } from '@/components/layout/footer';
import { Sidebar } from '@/components/layout/sidebar';
import { RedeemDialogButton } from '@/components/redeem-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBreakpoint } from '@/components/ui/media';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToastProvider } from '@/components/ui/toast';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useBootstrap } from '@/lib/bootstrap';
import { makeInitials, replaceRouteTokens } from '@/lib/format';
import { useThemePreference, type ThemePreference } from '@/lib/theme';
import { PageResolver } from '@/pages/resolver';

const SIDEBAR_KEY = 'krypton:sidebar-collapsed';
const CHROME_HEIGHT_BEFORE_MEASURE_PX = 48;

/**
 * Templates that render their own SPA shell (no main OJ sidebar/topbar).
 * For these we skip `AppShell` entirely and let `PageResolver` paint its own.
 */
const STANDALONE_TEMPLATES = new Set(['exam_mode_home.html', 'exam_contest.html', 'exam_paper.html', 'contest_workspace.html']);

const THEME_TABS: MiniTabItem<ThemePreference>[] = [
  { value: 'light', label: null, ariaLabel: '亮色', icon: Sun },
  { value: 'dark', label: null, ariaLabel: '暗色', icon: Moon },
  { value: 'system', label: null, ariaLabel: '跟随系统', icon: Monitor },
];

type UserMenuEntry = MenuItem | 'separator' | { group: string };

function readSidebarPreference(): boolean | null {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === '1') {
      return true;
    }
    if (stored === '0') {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

function workspaceStyle(height: number): CSSProperties {
  if (!Number.isFinite(height) || height < 0) {
    throw new RangeError(`workspace chrome height must be a non-negative finite number, got ${String(height)}`);
  }
  return { '--workspace-h': `calc(100dvh - ${height}px)` } as CSSProperties;
}

function useSidebarCollapsed() {
  const wide = useBreakpoint('xl');
  const [preference, setPreference] = useState<boolean | null>(readSidebarPreference);
  const collapsed = preference ?? !wide;
  const toggleCollapsed = useCallback(() => {
    setPreference((current) => {
      const next = !(current ?? !wide);
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // Denied storage still keeps the in-memory choice.
      }
      return next;
    });
  }, [wide]);
  return { collapsed, toggleCollapsed };
}

function useChromeHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(CHROME_HEIGHT_BEFORE_MEASURE_PX);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const blockSize = entry.borderBoxSize?.[0]?.blockSize;
      const measured = typeof blockSize === 'number' ? blockSize : entry.contentRect.height;
      if (!Number.isFinite(measured) || measured <= 0) {
        return;
      }
      setHeight(Math.round(measured));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, height };
}

function themeMenuEntries(setPreference: (pref: ThemePreference) => void): UserMenuEntry[] {
  return [
    { group: '主题' },
    { label: '亮色', icon: <Sun />, onSelect: () => setPreference('light') },
    { label: '暗色', icon: <Moon />, onSelect: () => setPreference('dark') },
    { label: '跟随系统', icon: <Monitor />, onSelect: () => setPreference('system') },
  ];
}

function UserMenu({ smUp, setPreference }: { smUp: boolean; setPreference: (pref: ThemePreference) => void }) {
  const bs = useBootstrap();
  if (!bs.user.signedIn) {
    return (
      <div className="flex items-center gap-1.5">
        <Button asChild variant="ghost" size="sm">
          <a href={bs.urls.login}>登录</a>
        </Button>
        <Button asChild size="sm">
          <a href={bs.urls.register}>注册</a>
        </Button>
      </div>
    );
  }

  const items: UserMenuEntry[] = [
    { group: `${bs.user.name} · ${bs.user.rp} RP` },
    {
      label: '个人主页',
      icon: <User />,
      href: replaceRouteTokens(bs.urls.userDetail, { UID: String(bs.user.id) }),
    },
    {
      label: '账号设置',
      icon: <Settings />,
      href: `${bs.urls.settings}/preference`,
    },
    {
      label: bs.user.unreadMessages > 0 ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span>消息</span>
          <Badge tone="danger" size="sm" className="ml-auto">{bs.user.unreadMessages}</Badge>
        </span>
      ) : '消息',
      icon: <Mail />,
      href: bs.urls.messages,
    },
  ];
  if (!smUp) {
    items.push('separator', ...themeMenuEntries(setPreference));
  }
  items.push('separator', {
    label: '退出登录',
    icon: <LogOut />,
    href: bs.urls.logout,
    danger: true,
  });

  return (
    <Menu
      label="用户菜单"
      placement="bottom-end"
      trigger={({ ref, onClick, 'aria-expanded': expanded }) => (
        <Button
          ref={ref}
          variant="ghost"
          size="sm"
          className="max-w-full gap-2 px-2"
          aria-expanded={expanded}
          aria-label={bs.user.name}
          onClick={onClick}
        >
          <Avatar className="size-7">
            {bs.user.avatarUrl ? <AvatarImage src={bs.user.avatarUrl} alt={bs.user.name} /> : null}
            <AvatarFallback className="text-2xs">{makeInitials(bs.user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate sm:inline">{bs.user.name}</span>
        </Button>
      )}
      items={items}
    />
  );
}

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
  const smUp = useBreakpoint('sm');
  const desktop = useBreakpoint('lg');
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const { preference, setPreference } = useThemePreference(bs.theme);
  const { ref: chromeRef, height: chromeHeight } = useChromeHeight();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (desktop) {
      setSidebarOpen(false);
    }
  }, [desktop]);

  useEffect(() => {
    document.documentElement.lang = bs.locale || 'zh-CN';
    document.title = `${bs.domain.name} — Krypton`;
  }, [bs.domain.name, bs.locale]);

  return (
    <ToastProvider>
      <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-bg" style={workspaceStyle(chromeHeight)}>
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={chromeRef} className="shrink-0">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg px-3 short:h-11 sm:px-4">
              <SimpleTooltip content="打开菜单">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="lg:hidden"
                  aria-label="打开菜单"
                  onClick={() => setSidebarOpen(true)}
                >
                  <MenuIcon />
                </Button>
              </SimpleTooltip>
              <SimpleTooltip content={collapsed ? '展开侧边栏' : '收起侧边栏'}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="hidden lg:inline-flex"
                  aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
                  onClick={toggleCollapsed}
                >
                  {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
              </SimpleTooltip>
              <a href={bs.urls.home} className="flex items-center text-fg lg:hidden" aria-label={bs.appName || 'Krypton'}>
                <Swords className="size-4" aria-hidden="true" />
              </a>
              <span className="hidden min-w-0 truncate text-sm text-fg-muted lg:inline">{bs.domain.name}</span>
              <div className="flex-1" />
              <MiniTabs
                size="sm"
                aria-label="主题"
                value={preference}
                onValueChange={setPreference}
                items={THEME_TABS}
                className={bs.user.signedIn ? 'hidden sm:inline-flex' : undefined}
              />
              <div className="flex min-w-0 items-center gap-1.5">
                {bs.user.signedIn ? (
                  <>
                    <AnnouncementPopover signedIn={bs.user.signedIn} />
                    <CollectPendingBadge />
                    <SimpleTooltip content="消息">
                      <Button asChild variant="ghost" size="sm" iconOnly className="relative hidden sm:inline-flex">
                        <a href={bs.urls.messages} aria-label="消息">
                          <Mail />
                          {bs.user.unreadMessages > 0 ? (
                            <Badge tone="danger" size="sm" className="absolute -top-1 -right-1">
                              {bs.user.unreadMessages > 9 ? '9+' : bs.user.unreadMessages}
                            </Badge>
                          ) : null}
                        </a>
                      </Button>
                    </SimpleTooltip>
                    <RedeemDialogButton variant="ghost" size="sm" iconOnly />
                    <SimpleTooltip content="账号设置">
                      <Button asChild variant="ghost" size="sm" iconOnly className="hidden sm:inline-flex">
                        <a href={`${bs.urls.settings}/preference`} aria-label="账号设置">
                          <Settings />
                        </a>
                      </Button>
                    </SimpleTooltip>
                  </>
                ) : null}
                <UserMenu smUp={smUp} setPreference={setPreference} />
              </div>
            </header>
            {bs.user.impersonation ? (
              <div className="flex items-center gap-3 border-b border-warning-line bg-warning-soft px-4 py-2 text-sm text-fg">
                <Eye className="size-4 shrink-0 text-warning-fg" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  正在以 <strong>{bs.user.impersonation.targetName}</strong>（UID {bs.user.impersonation.targetUid}）身份浏览；原管理员为{' '}
                  <strong>{bs.user.impersonation.actorName}</strong>（UID {bs.user.impersonation.actorUid}）
                  {bs.user.impersonation.startedAt ? (
                    <>，开始于 <time dateTime={bs.user.impersonation.startedAt}>{new Date(bs.user.impersonation.startedAt).toLocaleString('zh-CN')}</time></>
                  ) : null}
                </span>
                <form method="post" action="/admin/accounts/return">
                  <Button type="submit" variant="secondary" size="sm">
                    <RotateCcw />
                    返回原账号
                  </Button>
                </form>
              </div>
            ) : null}
            {bs.user.bindRequired && bs.page.templateName === 'main.html' ? (
              <div className="flex items-center gap-3 border-b border-warning-line bg-warning-soft px-4 py-2 text-sm text-fg">
                <User className="size-4 shrink-0 text-warning-fg" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">请先绑定学生身份，才能使用题目、比赛和作业。</span>
                <Button asChild variant="secondary" size="sm">
                  <a href="/userbind">去绑定</a>
                </Button>
              </div>
            ) : null}
          </div>
          <ScrollArea
            data-scroll-owner="page"
            className="min-h-0 min-w-0 flex-1"
            viewportClassName="[&>div]:!flex [&>div]:!flex-col [&>div]:!min-h-full pb-[env(safe-area-inset-bottom)]"
          >
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="min-w-0 flex-1 p-3 sm:p-6 xl:p-8 has-[>[data-slot=page]]:p-0 has-[>[data-slot=workspace]]:p-0">
                <Outlet />
              </div>
              <KryptonFooter />
            </main>
          </ScrollArea>
        </div>
      </div>
    </ToastProvider>
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
