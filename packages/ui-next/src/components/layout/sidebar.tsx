import {
  Award,
  BarChart3,
  BookMarked,
  BookOpen,
  ClipboardList,
  Clock,
  FolderUp,
  GraduationCap,
  HardDriveDownload,
  Home,
  KeyRound,
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
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MOTION } from '@/components/ui/motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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

// SimpleTooltip cannot set sideOffset. Keep the existing collapsed-rail gap.
const COLLAPSED_TOOLTIP_OFFSET = 18;

function sidebarMotion(token: typeof MOTION.state) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Sidebar motion ease must be a four-number bezier');
  }
  return { duration: token.duration, ease: [x1, y1, x2, y2] as const };
}

function SidebarLink({
  item, active, collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'relative flex h-(--row-h) w-full items-center rounded-md text-md outline-none transition-colors duration-(--dur-1) ease-(--ease-standard) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        active
          ? 'bg-surface-active font-medium text-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <item.icon
        className={cn('size-5 shrink-0', active ? 'text-fg' : 'text-fg-subtle')}
        aria-hidden="true"
      />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {item.badge ? (
        <Badge
          tone="success"
          size="sm"
          className={cn(collapsed ? 'absolute -top-0.5 -right-0.5' : 'ml-auto')}
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
            {item.badge ? <span className="text-xs tabular text-fg-muted">{item.badge}</span> : null}
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
                  'problem_review.html',
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
            'contest_virtual.html',
            'contest_virtual_scoreboard.html',
          ],
        },
        { label: '队伍', href: '/teams', icon: Users, templates: ['team_batches.html', 'team_batch_detail.html'] },
        {
          label: '作业',
          href: bs.urls.homework,
          icon: ClipboardList,
          templates: ['homework_main.html', 'homework_detail.html', 'homework_edit.html', 'homework_files.html'],
        },
        { label: '课程', href: '/course', icon: BookMarked, templates: ['course_main.html', 'course_detail.html', 'course_edit.html', 'course_mindmap_edit.html', 'course_videos.html'] },
        {
          label: '题集',
          href: bs.urls.training,
          icon: GraduationCap,
          templates: ['problem_set_main.html', 'problem_set_detail.html', 'problem_set_edit.html', 'problem_set_files.html', 'problem_set_roster.html'],
        },
        { label: '任务', href: '/tasks', icon: ListChecks, templates: ['tasks_center.html', 'tasks_my.html', 'tasks_detail.html'] },
        { label: '文件收集', href: '/collect', icon: FolderUp, templates: ['collect_main.html', 'collect_detail.html'] },
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
      if (canSeeAdminAffordance(userCtx, 'domainAdmin') || bs.user.canManageDomainPermissions) {
        adminItems.push({
          label: '域管理',
          href: bs.urls.domainDashboard,
          icon: LayoutDashboard,
          templates: [
            'domain_dashboard.html',
            'domain_edit.html',
            'domain_user.html',
            'domain_user_raw.html',
            'domain_group.html',
            'domain_join_applications.html',
          ],
        });
      }
      if (bs.user.canManageDomainPermissions) {
        adminItems.push({
          label: '权限管理',
          href: bs.urls.domainPermission,
          icon: KeyRound,
          templates: ['domain_permission.html', 'domain_role.html'],
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
      if (bs.user.canManageCollect) {
        adminItems.push({
          label: '文件收集',
          href: '/admin/collect',
          icon: FolderUp,
          templates: ['admin_collect.html', 'admin_collect_edit.html', 'admin_collect_stats.html'],
        });
      }
      if (bs.user.canManageRedemptionCodes) {
        adminItems.push({
          label: '兑换码',
          href: '/manage/redemption-codes',
          icon: KeyRound,
          templates: ['redemption_code_manage.html'],
        });
      }
      if (bs.user.canManageExamInfrastructure) {
        adminItems.push({
          label: '考试基础设施',
          href: '/admin/exam-infrastructure',
          icon: HardDriveDownload,
          templates: ['admin_exam_infrastructure.html', 'admin_exam_event.html', 'admin_exam_classroom.html', 'admin_exam_seats.html'],
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
          badge: Number((bs.page.data as { pendingBindingRequests?: unknown }).pendingBindingRequests || 0),
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

  const renderSidebarContent = (isCollapsed: boolean, scrollType: 'hover' | 'auto' = 'hover') => (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-12 shrink-0 items-center border-b border-line', isCollapsed ? 'justify-center px-2' : 'gap-2 px-3')}>
        <a
          href={bs.urls.home}
          aria-label={isCollapsed ? 'Krypton 首页' : undefined}
          className={cn(
            'flex items-center gap-2 text-md font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            isCollapsed ? 'size-8 justify-center rounded-md hover:bg-surface-hover' : '',
          )}
        >
          <Swords className="size-5 shrink-0" aria-hidden="true" />
          {isCollapsed ? null : <span>Krypton</span>}
        </a>
        {isCollapsed ? null : <div className="flex-1" />}
        {!isCollapsed && scrollType === 'auto' ? (
          <SimpleTooltip content="关闭菜单">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="关闭菜单"
              onClick={onClose}
            >
              <X />
            </Button>
          </SimpleTooltip>
        ) : null}
      </div>

      <TooltipProvider delayDuration={160}>
        <ScrollArea type={scrollType} className="min-h-0 flex-1" viewportClassName="px-2 py-2">
          <nav aria-label="主导航">
            {groups.map((group, gi) => {
              if (group.show === false) {
                return null;
              }
              return (
                <div key={gi}>
                  {group.label ? (
                    isCollapsed ? (
                      <div className="mx-auto my-2 h-px w-4 bg-line" />
                    ) : (
                      <p className="px-3 pt-4 pb-1 text-xs font-semibold text-fg-subtle">{group.label}</p>
                    )
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <SidebarLink
                        key={item.href}
                        item={item}
                        active={item.templates.includes(tpl)}
                        collapsed={isCollapsed}
                      />
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
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 56 : 240 }}
        transition={sidebarMotion(MOTION.state)}
        className={cn(
          'hidden h-full shrink-0 flex-col overflow-hidden border-r border-line bg-surface-sunken lg:flex',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        {renderSidebarContent(collapsed)}
      </motion.aside>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="sidebar-scrim"
            className="fixed inset-0 z-40 bg-scrim lg:hidden"
            initial={{ opacity: 0 /* ds-allow DS015: mobile drawer scrim must enter from transparent; layout is not gate-exempt */ }}
            animate={{ opacity: 1, transition: sidebarMotion(MOTION.enter) }}
            exit={{ opacity: 0, transition: sidebarMotion(MOTION.exit) }}
            onClick={onClose}
          />
        ) : null}
        {open ? (
          <motion.aside
            key="sidebar-drawer"
            className="fixed inset-y-0 left-0 z-40 flex h-full w-72 max-w-[85vw] flex-col bg-surface-raised shadow-pop lg:hidden"
            initial={{ x: '-100%' /* ds-allow DS015: mobile drawer must start off-screen; layout is not gate-exempt */ }}
            animate={{ x: 0, transition: sidebarMotion(MOTION.enter) }}
            exit={{ x: '-100%', transition: sidebarMotion(MOTION.exit) }}
          >
            {renderSidebarContent(false, 'auto')}
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
