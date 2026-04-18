import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Menu, Swords } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sidebar } from '@/components/layout/sidebar';
import { PageResolver } from '@/pages/resolver';
import { makeInitials } from '@/lib/format';

function AppShell() {
  const bs = useBootstrap();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', bs.theme === 'dark');
    document.documentElement.lang = bs.locale || 'zh-CN';
    document.title = `${bs.domain.name} — Krypton`;
  }, [bs]);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          {/* Domain name */}
          <a href={bs.urls.home} className="flex items-center gap-2 text-sm font-semibold md:hidden">
            <Swords className="size-4 text-primary" />
          </a>
          <span className="hidden text-sm font-medium text-muted-foreground md:inline-block">
            {bs.domain.name}
          </span>

          <div className="flex-1" />

          {/* Right section */}
          <div className="flex items-center gap-2">
            {bs.user.signedIn ? (
              <a href={bs.urls.messages} className="flex items-center gap-2">
                {bs.user.unreadMessages > 0 ? (
                  <Badge variant="default" className="text-[10px]">{bs.user.unreadMessages}</Badge>
                ) : null}
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">{makeInitials(bs.user.name)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline-block">{bs.user.name}</span>
              </a>
            ) : (
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <a href={bs.urls.login}>登录</a>
                </Button>
                <Button asChild size="sm">
                  <a href={bs.urls.register}>注册</a>
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">
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
