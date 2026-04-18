import {
  BookOpen,
  ClipboardList,
  Clock,
  FolderOpen,
  GraduationCap,
  Home,
  LayoutDashboard,
  Mail,
  Medal,
  MessageSquare,
  Settings,
  Shield,
  Swords,
  Trophy,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { makeInitials } from '@/lib/format';
import { cn } from '@/lib/cn';

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
}: {
  item: NavItem;
  active: boolean;
}) {
  return (
    <a
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span>{item.label}</span>
    </a>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      label: '个人',
      show: bs.user.signedIn,
      items: [
        { label: '设置', href: bs.urls.settings, icon: Settings, templates: ['home_settings.html'] },
        { label: '安全', href: bs.urls.security, icon: Shield, templates: ['home_security.html'] },
        { label: '消息', href: bs.urls.messages, icon: Mail, templates: ['home_messages.html'] },
        { label: '文件', href: bs.urls.files, icon: FolderOpen, templates: ['home_files.html'] },
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
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <a href={bs.urls.home} className="flex items-center gap-2 font-semibold">
          <Swords className="size-5 text-primary" />
          <span>Krypton</span>
        </a>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3">
        {groups.map((group, gi) => {
          if (group.show === false) return null;
          return (
            <div key={gi} className="mb-2">
              {group.label ? (
                <>
                  <Separator className="my-3" />
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                </>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarLink
                    key={item.href}
                    item={item}
                    active={item.templates.includes(tpl)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User card */}
      <div className="border-t p-3">
        {bs.user.signedIn ? (
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{makeInitials(bs.user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{bs.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{bs.user.unreadMessages} 条未读</p>
            </div>
            <Button asChild variant="ghost" size="sm" className="shrink-0 text-xs">
              <a href={bs.urls.logout}>退出</a>
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button asChild size="sm" className="flex-1">
              <a href={bs.urls.login}>登录</a>
            </Button>
            <Button asChild variant="outline" size="sm" className="flex-1">
              <a href={bs.urls.register}>注册</a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:block">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="relative h-full w-60 bg-sidebar shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      ) : null}
    </>
  );
}
