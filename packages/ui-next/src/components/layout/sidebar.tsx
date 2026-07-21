import {
  Award,
  BarChart3,
  BookMarked,
  BookOpen,
  ClipboardList,
  Clock,
  GraduationCap,
  Home,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Medal,
  Megaphone,
  MessageSquare,
  Network,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
  UserRoundCog,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canSeeAdminAffordance } from '@/lib/perms';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  templates: string[];
  badge?: number;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
  show?: boolean;
}

// The 44px item is centered in a 64px rail: 10px inset + 8px visual gap.
const COLLAPSED_TOOLTIP_OFFSET = 18;

function SidebarLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const link = (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center text-sm font-medium outline-none transition-[background-color,color,box-shadow,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-background active:scale-[0.96]',
        collapsed ? 'mx-auto size-11 justify-center rounded-[14px]' : 'min-h-11 w-full gap-3 rounded-xl px-3 py-2 md:min-h-10',
        active
          ? 'bg-sidebar-primary/12 text-sidebar-primary shadow-sm'
          : 'text-sidebar-foreground/68 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground',
      )}
    >
      <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {item.badge ? (
        <Badge
          variant="destructive"
          className={cn('h-5 min-w-5 justify-center px-1.5 text-[10px] shadow-sm', collapsed ? 'absolute -right-0.5 -top-0.5' : 'ml-auto')}
        >
          {item.badge}
        </Badge>
      ) : null}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={COLLAPSED_TOOLTIP_OFFSET}>
          <span className="flex items-center gap-2">
            <span>{item.label}</span>
            {item.badge ? <span className="text-xs tabular-nums text-muted-foreground">{item.badge}</span> : null}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

export function Sidebar({ open, onClose, collapsed }: { open: boolean; onClose: () => void; collapsed: boolean }) {
  const bs = useBootstrap();
  const tpl = bs.page.templateName;

  const groups: NavGroup[] = [
    {
      items: [
        { label: '首页', href: bs.urls.home, icon: Home, templates: ['main.html'] },
        { label: '公告', href: '/announce', icon: Megaphone, templates: ['announce_list.html', 'announce_detail.html'] },
        // P2.11：三个题库枚举入口只消费服务端的唯一 capability。具体题详情、
        // 比赛/作业/训练入口始终保留；导航隐藏不是服务端授权边界。
        ...(bs.user.canBrowseProblemBank
          ? [
              {
                label: '题库',
                href: bs.urls.problems,
                icon: BookOpen,
                templates: [
                  'problem_main.html',
                  'problem_mine.html',
                  'problem_create_hub.html',
                  'problem_detail.html',
                  'problem_submit.html',
                  'problem_hack.html',
                  'problem_edit.html',
                  'problem_edit_single.html',
                  'problem_edit_multi.html',
                  'problem_edit_true_false.html',
                  'problem_edit_blank.html',
                  'problem_edit_subjective.html',
                  'problem_edit_program_fill.html',
                  'problem_edit_function.html',
                  'problem_config.html',
                  'problem_files.html',
                  'problem_solution.html',
                  'problem_statistics.html',
                  'problem_import.html',
                  'problem_import_fps.html',
                ],
              },
            ]
          : []),
        { label: '导图', href: '/mindmap', icon: Network, templates: ['mindmap_main.html'] },
        {
          label: '比赛',
          href: bs.urls.contests,
          icon: Trophy,
          templates: [
            'contest_main.html',
            'contest_detail.html',
            'contest_teams.html',
            'contest_edit.html',
            'contest_scoreboard.html',
            'xcpcio_board.html',
            'contest_manage.html',
            'contest_problemlist.html',
            'contest_user.html',
            'contest_balloon.html',
            'contest_clarification.html',
            'contest_print.html',
          ],
        },
        { label: '队伍', href: '/teams', icon: Users, templates: ['team_batches.html', 'team_batch_detail.html'] },
        {
          label: '作业',
          href: bs.urls.homework,
          icon: ClipboardList,
          templates: ['homework_main.html', 'homework_detail.html', 'homework_edit.html', 'homework_files.html'],
        },
        { label: '课程', href: '/course', icon: BookMarked, templates: ['course_main.html', 'course_detail.html', 'course_edit.html'] },
        {
          label: '训练',
          href: bs.urls.training,
          icon: GraduationCap,
          templates: ['training_main.html', 'training_detail.html', 'training_edit.html', 'training_files.html'],
        },
        { label: '任务', href: '/tasks', icon: ListChecks, templates: ['tasks_center.html', 'tasks_my.html', 'tasks_detail.html'] },
        { label: '协作', href: '/permits/inbox', icon: ShieldCheck, templates: ['my_verify_inbox.html'] },
        {
          label: '讨论',
          href: bs.urls.discussions,
          icon: MessageSquare,
          templates: ['discussion_main_or_node.html', 'discussion_detail.html', 'discussion_create.html', 'discussion_edit.html'],
        },
        { label: '记录', href: bs.urls.records, icon: Clock, templates: ['record_main.html', 'record_detail.html'] },
        { label: '排名', href: bs.urls.ranking, icon: Medal, templates: ['ranking.html'] },
        { label: '荣誉榜', href: '/rankboard', icon: Award, templates: ['rankboard_main.html', 'rankboard_detail.html'] },
      ],
    },
    // Admin entries: gate per-item. Default users + guests see nothing here;
    // the group itself disappears when neither child is visible.
    (() => {
      const userCtx = { priv: bs.user.priv ?? 0, role: bs.user.role, signedIn: bs.user.signedIn };
      const adminItems: NavItem[] = [];
      if (canSeeAdminAffordance(userCtx, 'domainAdmin')) {
        adminItems.push({
          label: '域管理',
          href: bs.urls.domainDashboard,
          icon: LayoutDashboard,
          templates: [
            'domain_dashboard.html',
            'domain_edit.html',
            'domain_user.html',
            'domain_user_raw.html',
            'domain_permission.html',
            'domain_role.html',
            'domain_group.html',
            'domain_join_applications.html',
          ],
        });
      }
      if (bs.user.canManageAnnouncements) {
        adminItems.push({
          label: '公告管理',
          href: '/admin/announce',
          icon: Megaphone,
          templates: ['admin_announce_list.html', 'admin_announce_edit.html', 'admin_announce_categories.html'],
        });
      }
      if (bs.user.canManageTasks) {
        adminItems.push({
          label: '任务管理',
          href: '/admin/tasks',
          icon: ListChecks,
          templates: [
            'admin_tasks.html',
            'admin_tasks_edit.html',
            'admin_tasks_assign.html',
            'admin_tasks_stats.html',
            'admin_tasks_candidates.html',
            'admin_tasks_scores.html',
            'admin_tasks_settings.html',
          ],
        });
      }
      if (bs.user.canImportRankboard || bs.user.canManageRankboard) {
        adminItems.push({
          label: '荣誉管理',
          href: '/admin/rankboard?section=people',
          icon: Award,
          templates: ['admin_rankboard.html', 'admin_rankboard_person.html', 'admin_rankboard_awards.html'],
        });
      }
      if (canSeeAdminAffordance(userCtx, 'systemAdmin')) {
        adminItems.push({
          label: '导图管理',
          href: '/admin/mindmap',
          icon: Network,
          templates: ['admin_mindmap.html'],
        });
        adminItems.push({
          label: '用户绑定',
          href: '/admin/userbind/schools',
          icon: UserRoundCog,
          badge: Number(bs.page.data.pendingBindingRequests || 0),
          templates: [
            'admin_userbind_overview.html',
            'admin_userbind_schools.html',
            'admin_userbind_school_detail.html',
            'admin_userbind_groups.html',
            'admin_userbind_group_detail.html',
            'admin_userbind_students.html',
            'admin_userbind_students_import.html',
            'admin_userbind_tokens.html',
            'admin_userbind_requests.html',
          ],
        });
        adminItems.push({
          label: '反作弊',
          href: '/admin/vigil',
          icon: ShieldAlert,
          templates: [
            'admin_vigil_overview.html',
            'admin_vigil_approvals.html',
            'admin_vigil_sessions.html',
            'admin_vigil_events.html',
            'admin_vigil_exam_detail.html',
          ],
        });
        adminItems.push({
          label: '统计中心',
          href: '/admin/stats',
          icon: BarChart3,
          templates: ['admin_stats.html'],
        });
        adminItems.push({
          label: '赛时通过率',
          href: '/manage/realpass',
          icon: BarChart3,
          templates: ['manage_realpass.html'],
        });
        adminItems.push({
          label: '账号管理',
          href: '/admin/accounts',
          icon: UserRoundCog,
          templates: ['admin_accounts.html', 'admin_account_detail.html'],
        });
        adminItems.push({
          label: '系统',
          href: bs.urls.manage,
          icon: Wrench,
          templates: ['manage_dashboard.html', 'manage_script.html', 'manage_setting.html', 'manage_config.html'],
        });
      }
      return {
        label: '管理',
        show: adminItems.length > 0,
        items: adminItems,
      } satisfies NavGroup;
    })(),
  ];

  const renderSidebarContent = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex shrink-0 items-center border-b', isCollapsed ? 'h-12 justify-center px-2' : 'h-12 gap-2 px-4')}>
        <a
          href={bs.urls.home}
          aria-label={isCollapsed ? 'Krypton 首页' : undefined}
          className={cn(
            'flex items-center gap-2 font-semibold outline-none transition-[background-color,color,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.96]',
            isCollapsed ? 'size-10 justify-center rounded-xl hover:bg-sidebar-accent' : '',
          )}
        >
          <Swords className="size-5 text-primary" />
          {!isCollapsed && <span>Krypton</span>}
        </a>
        {!isCollapsed && <div className="flex-1" />}
        {!isCollapsed && (
          <Button variant="ghost" size="icon" className="size-7 md:hidden" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Nav */}
      <TooltipProvider delayDuration={160}>
        <ScrollArea type="hover" className="min-h-0 flex-1" viewportClassName={cn(isCollapsed ? 'px-2 py-2.5' : 'p-3')}>
          <nav aria-label="主导航">
            {groups.map((group, gi) => {
              if (group.show === false) return null;
              return (
                <div key={gi} className="mb-2">
                  {group.label ? (
                    <>
                      <Separator className={cn('my-3', isCollapsed ? 'mx-auto w-8' : '')} />
                      {!isCollapsed && (
                        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                      )}
                    </>
                  ) : null}
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <SidebarLink key={item.href} item={item} active={item.templates.includes(tpl)} collapsed={isCollapsed} />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </ScrollArea>
      </TooltipProvider>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground transition-[width] duration-200 ease-out md:block',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        {renderSidebarContent(collapsed)}
      </aside>

      {/* Mobile overlay */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
          <aside className="relative h-full w-[min(18rem,82vw)] border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground shadow-2xl">
            {renderSidebarContent(false)}
          </aside>
        </div>
      ) : null}
    </>
  );
}
