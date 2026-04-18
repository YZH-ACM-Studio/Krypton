import {
  BookOpen,
  ClipboardList,
  Clock,
  GraduationCap,
  Home,
  LayoutDashboard,
  Medal,
  MessageSquare,
  Swords,
  Trophy,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/cn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  templates: string[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
  show?: boolean;
}

function SidebarLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <a
      href={item.href}
      className={cn(
        'flex items-center rounded-md text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

export function Sidebar({
  open,
  onClose,
  collapsed,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
}) {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;

  const groups: NavGroup[] = [
    {
      items: [
        { label: '首页', href: bs.urls.home, icon: Home, templates: ['main.html'] },
        { label: '题库', href: bs.urls.problems, icon: BookOpen, templates: ['problem_main.html', 'problem_detail.html', 'problem_submit.html', 'problem_edit.html', 'problem_config.html', 'problem_files.html', 'problem_solution.html', 'problem_statistics.html', 'problem_import.html'] },
        { label: '比赛', href: bs.urls.contests, icon: Trophy, templates: ['contest_main.html', 'contest_detail.html', 'contest_edit.html', 'contest_scoreboard.html', 'contest_manage.html', 'contest_problemlist.html', 'contest_user.html', 'contest_balloon.html', 'contest_clarification.html', 'contest_print.html'] },
        { label: '作业', href: bs.urls.homework, icon: ClipboardList, templates: ['homework_main.html', 'homework_detail.html', 'homework_edit.html', 'homework_files.html'] },
        { label: '训练', href: bs.urls.training, icon: GraduationCap, templates: ['training_main.html', 'training_detail.html', 'training_edit.html', 'training_files.html'] },
        { label: '讨论', href: bs.urls.discussions, icon: MessageSquare, templates: ['discussion_main_or_node.html', 'discussion_detail.html', 'discussion_create.html', 'discussion_edit.html'] },
        { label: '记录', href: bs.urls.records, icon: Clock, templates: ['record_main.html', 'record_detail.html'] },
        { label: '排名', href: bs.urls.ranking, icon: Medal, templates: ['ranking.html'] },
      ],
    },
    {
      label: '管理',
      show: bs.user.priv > 0 || bs.user.role === 'root',
      items: [
        { label: '域管理', href: bs.urls.domainDashboard, icon: LayoutDashboard, templates: ['domain_dashboard.html', 'domain_edit.html', 'domain_user.html', 'domain_user_raw.html', 'domain_permission.html', 'domain_role.html', 'domain_group.html', 'domain_join_applications.html'] },
        { label: '系统', href: bs.urls.manage, icon: Wrench, templates: ['manage_dashboard.html', 'manage_script.html', 'manage_setting.html', 'manage_config.html', 'manage_user_import.html', 'manage_user_priv.html'] },
      ],
    },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex shrink-0 items-center border-b', collapsed ? 'h-12 justify-center px-2' : 'h-12 gap-2 px-4')}>
        <a href={bs.urls.home} className="flex items-center gap-2 font-semibold">
          <Swords className="size-5 text-primary" />
          {!collapsed && <span>Krypton</span>}
        </a>
        {!collapsed && <div className="flex-1" />}
        {!collapsed && (
          <Button variant="ghost" size="icon" className="size-7 md:hidden" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Nav */}
      <TooltipProvider delayDuration={0}>
        <nav className={cn('flex-1 overflow-y-auto', collapsed ? 'p-1.5' : 'p-3')}>
          {groups.map((group, gi) => {
            if (group.show === false) return null;
            return (
              <div key={gi} className="mb-2">
                {group.label ? (
                  <>
                    <Separator className="my-3" />
                    {!collapsed && (
                      <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </p>
                    )}
                  </>
                ) : null}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarLink
                      key={item.href}
                      item={item}
                      active={item.templates.includes(tpl)}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </TooltipProvider>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r bg-sidebar transition-[width] duration-200 md:block',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="relative h-full w-56 bg-sidebar shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      ) : null}
    </>
  );
}
