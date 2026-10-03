# T03 遗留布局意图

## test/user-account-settings.spec.ts::redesigns settings with MiniTabs and Chinese identity copy
- 源文件：`src/pages/user-account.tsx`
- 删除的断言：`expect(page).to.include('overflow-x-auto');`
- 意图（一句话）：账户设置顶栏在窄宽度下横向滚动，页签不被裁掉。
- 后续阶段应如何表达：页面迁移后，账户设置顶栏带 `overflow-x-auto`。

## test/user-account-settings.spec.ts::redesigns settings with MiniTabs and Chinese identity copy
- 源文件：`src/pages/user-account.tsx`
- 删除的断言：`expect(page).to.include('max-w-3xl');`
- 意图（一句话）：账户设置主列限制在中等阅读宽度，而不是铺满整屏。
- 后续阶段应如何表达：页面迁移后，账户设置主列带 `max-w-3xl`。

## test/user-account-settings.spec.ts::redesigns settings with MiniTabs and Chinese identity copy
- 源文件：`src/pages/user-account.tsx`
- 删除的断言：`expect(page).to.include('lg:grid-cols-3');`
- 意图（一句话）：大屏设置表单按三列排布。
- 后续阶段应如何表达：页面迁移后，账户设置表单带 `lg:grid-cols-3`。

## test/user-account-settings.spec.ts::redesigns settings with MiniTabs and Chinese identity copy
- 源文件：`src/pages/user-account.tsx`
- 删除的断言：`expect(page).to.include('flex-wrap');`
- 意图（一句话）：设置页的操作行和页脚允许换行，避免窄屏挤出视口。
- 后续阶段应如何表达：页面迁移后，账户设置的操作行带 `flex-wrap`。

## test/user-account-settings.spec.ts::redesigns settings with MiniTabs and Chinese identity copy
- 源文件：`src/pages/user-account.tsx`
- 删除的断言：`expect(page).not.to.include('sm:grid-cols-[200px_1fr]');`
- 意图（一句话）：设置页不再使用 200px 标签列加剩余内容列的旧网格。
- 后续阶段应如何表达：页面迁移后，账户设置不含 `sm:grid-cols-[200px_1fr]`。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`exportedReturnRootClasses` 用 `className="([^"]+)"` 捕获导出函数返回根节点的类名
- 意图（一句话）：题集参加名单页通过根节点 className 捕获来检查整页宽度，类名不应再当定位器。
- 后续阶段应如何表达：页面迁移后，名单页根节点不靠捕获 `className` 来证明宽度。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(exportAt, export function should be exported).to.be.greaterThan(-1)`
- 意图（一句话）：根类名捕获要求 ProblemSetRosterPage 已导出；该检查只服务于类名定位。
- 后续阶段应如何表达：页面迁移后，名单页根节点不靠导出函数位置提取类名。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(match, should expose a static page root class).not.to.equal(null)`
- 意图（一句话）：名单页根节点必须有一段静态 className，供后续类名断言读取。
- 后续阶段应如何表达：页面迁移后，名单页根节点带铺满内容区的宽度，而不是再暴露静态 class 捕获。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：题集参加名单页根节点占满 AppShell 内容宽度。
- 后续阶段应如何表达：页面迁移后，名单页根节点带 `w-full`。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(classes).to.include('min-w-0');`
- 意图（一句话）：名单页根节点可以在 flex 父级中收缩，避免撑破内容区。
- 后续阶段应如何表达：页面迁移后，名单页根节点带 `min-w-0`。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(roster).not.to.include('mx-auto');`
- 意图（一句话）：名单页不得用自动水平外边距收成居中窄栏。
- 后续阶段应如何表达：页面迁移后，名单页不含 `mx-auto`。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(roster).not.to.include('max-w-7xl');`
- 意图（一句话）：名单页不得用 max-w-7xl 限制整页宽度。
- 后续阶段应如何表达：页面迁移后，名单页不含 `max-w-7xl`。

## test/problem-set-roster-layout.spec.ts::fills the shared AppShell content width
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(roster).not.to.include('max-w-[90rem]');`
- 意图（一句话）：名单页不得用 90rem 任意最大宽度限制整页。
- 后续阶段应如何表达：页面迁移后，名单页不含 `max-w-[90rem]`。

## test/problem-set-roster-layout.spec.ts::keeps the training detail motion.div full-width without rendering PracticeRosterCard
- 源文件：`src/pages/training.tsx`
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：训练详情的 motion.div 根节点占满内容宽度。
- 后续阶段应如何表达：页面迁移后，训练详情根节点带 `w-full`。

## test/problem-set-roster-layout.spec.ts::keeps the training detail motion.div full-width without rendering PracticeRosterCard
- 源文件：`src/pages/training.tsx`
- 删除的断言：`expect(classes).to.include('min-w-0');`
- 意图（一句话）：训练详情根节点可以在 flex 父级中收缩。
- 后续阶段应如何表达：页面迁移后，训练详情根节点带 `min-w-0`。

## test/exam-seat-plan.page.spec.tsx::assigns a student to an unoccupied eligible seat without exposing excluded candidates
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`expect(emptySeat).toHaveClass('border-dashed');`
- 意图（一句话）：未分配的空座位用虚线边框标出，区别于已占用座位。
- 后续阶段应如何表达：页面迁移后，未分配空座位带 `border-dashed`。

## test/exam-seat-plan.page.spec.tsx::assigns a student to an unoccupied eligible seat without exposing excluded candidates
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`expect(emptySeat).not.toHaveClass('bg-primary');`
- 意图（一句话）：空座位不使用品牌色高亮：不含 `bg-brand`。
- 后续阶段应如何表达：页面迁移后，未分配空座位不含 `bg-brand`。

## test/exam-seat-plan.page.spec.tsx::shows structured v2 seats and keeps prestart closed until the P2.14 writer gate is enabled
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`expect(screen.getByText('告警：座位朝向已变化')).toHaveClass('text-amber-700');`
- 意图（一句话）：该告警使用 warning tone：`text-warning-fg`。
- 后续阶段应如何表达：页面迁移后，座位朝向告警带 `text-warning-fg`。

## test/exam-seat-plan.page.spec.tsx::scrolls 500-person assignment and prelogin tables inside a both-axis owner
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`expect(EXAM_SEAT_PLAN_SOURCE).to.include('max-h-[min(65vh,680px)] w-full min-w-0');`
- 意图（一句话）：500 人分配表和预登录表限制在矮屏可滚动的高度内，并在窄容器里收缩。
- 后续阶段应如何表达：页面迁移后，双向滚动表容器带 `max-h-[min(65vh,680px)] w-full min-w-0`。

## test/exam-seat-plan.page.spec.tsx::scrolls 500-person assignment and prelogin tables inside a both-axis owner
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`expect(EXAM_SEAT_PLAN_SOURCE).to.include("min-w-[56rem]");`
- 意图（一句话）：座位表至少 56rem 宽，列不被压扁，由外层双向滚动承接。
- 后续阶段应如何表达：页面迁移后，座位表带 `min-w-[56rem]`。

## test/exam-seat-plan.page.spec.tsx::retains an unresolved confirm request and locks history until the same request converges
- 源文件：`src/pages/exam-seat-plan.tsx`
- 删除的断言：`const item = detail.closest('div.rounded-md');`
- 意图（一句话）：历史批次按钮不再靠 rounded-md 容器从 requestId 往上定位。
- 后续阶段应如何表达：页面迁移后，历史批次按钮不靠 `rounded-md` 定位，而由技术细节 details 的相邻 button 表达。

## test/contest-team-workspace.spec.ts::shows bound student identity on rosters and keeps the manager view dense and server-paginated
- 源文件：`src/pages/contest-teams.tsx`
- 删除的断言：`expect(page).to.include('xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_minmax(16rem,auto)]');`
- 意图（一句话）：管理端队伍行在 xl 上分成身份、成员和操作三列，保持密集的一行。
- 后续阶段应如何表达：页面迁移后，管理端队伍行带 `xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_minmax(16rem,auto)]`。

## test/contest-team-workspace.spec.ts::shows bound student identity on rosters and keeps the manager view dense and server-paginated
- 源文件：`src/pages/contest-teams.tsx`
- 删除的断言：`expect(page).not.to.include('grid gap-3 lg:grid-cols-2');`
- 意图（一句话）：管理端队伍列表不再使用两列卡片网格。
- 后续阶段应如何表达：页面迁移后，管理端队伍列表不含 `grid gap-3 lg:grid-cols-2`。

## test/contest-team-workspace.spec.ts::uses the shared polished team dialog with inline validation instead of the native required bubble
- 源文件：`src/components/team-dialog.tsx`
- 删除的断言：`expect(chrome).to.include('overflow-y-auto overscroll-contain');`
- 意图（一句话）：队伍对话框正文在自身内部纵向滚动，不把滚动传给页面。
- 后续阶段应如何表达：页面迁移后，队伍对话框正文带 `overflow-y-auto overscroll-contain`。

## test/contest-team-workspace.spec.ts::uses the shared polished team dialog with inline validation instead of the native required bubble
- 源文件：`src/components/team-dialog.tsx`
- 删除的断言：`expect(chrome).to.include('rounded-[28px]');`
- 意图（一句话）：队伍对话框使用 28px 大圆角面板。
- 后续阶段应如何表达：页面迁移后，队伍对话框面板带 `rounded-[28px]`。

## test/contest-team-workspace.spec.ts::uses the shared polished team dialog with inline validation instead of the native required bubble
- 源文件：`src/components/team-dialog.tsx`
- 删除的断言：`expect(chrome).to.include('active:scale-[0.96]');`
- 意图（一句话）：队伍对话框按钮按下时略微缩小，作为按压反馈。
- 后续阶段应如何表达：页面迁移后，队伍对话框按钮带 `active:scale-[0.96]`。

## test/contest-team-workspace.spec.ts::uses the shared polished team dialog with inline validation instead of the native required bubble
- 源文件：`src/components/team-dialog.tsx`
- 删除的断言：`expect(chrome).not.to.include('transition-all');`
- 意图（一句话）：队伍对话框不得用 transition-all 动画全部属性。
- 后续阶段应如何表达：页面迁移后，队伍对话框不含 `transition-all`。

## test/user-account-messages.spec.tsx::keeps a long last-message preview inside a truncating list row
- 源文件：`src/pages/messages/conversation-list.tsx`
- 删除的断言：`const preview = screen.getAllByText(long).find((node) => node.classList.contains('truncate'));`
- 意图（一句话）：长最后一条消息的预览曾靠 truncate 类定位，样式类不应再当定位器。
- 后续阶段应如何表达：页面迁移后，会话列表的最后一条预览带 `truncate`，且不靠该类名查找节点。

## test/user-account-messages.spec.tsx::keeps a long last-message preview inside a truncating list row
- 源文件：`src/pages/messages/conversation-list.tsx`
- 删除的断言：`expect(preview).toBeTruthy();`
- 意图（一句话）：会话列表里必须能找到带截断样式的最后一条预览。
- 后续阶段应如何表达：页面迁移后，会话列表预览带 `truncate`。

## test/user-account-messages.spec.tsx::keeps a long last-message preview inside a truncating list row
- 源文件：`src/pages/messages/conversation-list.tsx`
- 删除的断言：`expect(preview?.className).toMatch(/\bmin-w-0\b/);`
- 意图（一句话）：截断预览可以在行内收缩，长文本不把会话行撑破。
- 后续阶段应如何表达：页面迁移后，会话列表预览带 `min-w-0`。

## test/user-account-messages.spec.tsx::keeps a long last-message preview inside a truncating list row
- 源文件：`src/pages/messages/conversation-list.tsx`
- 删除的断言：`expect(preview?.className).toMatch(/\bflex-1\b/);`
- 意图（一句话）：截断预览占据行内剩余宽度。
- 后续阶段应如何表达：页面迁移后，会话列表预览带 `flex-1`。

## test/user-account-messages.spec.tsx::keeps JS matchMedia on the same OR query as the CSS dual-pane complement
- 源文件：`src/pages/messages/panel.tsx`
- 删除的断言：`expect(panel).not.toContain('min-h-[480px]');`
- 意图（一句话）：消息面板不再用 480px 最小高度，而跟视口和双栏查询走。
- 后续阶段应如何表达：页面迁移后，消息面板不含 `min-h-[480px]`。

## test/user-account-messages.spec.tsx::keeps JS matchMedia on the same OR query as the CSS dual-pane complement
- 源文件：`src/pages/messages/panel.tsx`
- 删除的断言：`expect(panel).toMatch(/flex-1/);`
- 意图（一句话）：消息面板在父级 flex 中占据剩余空间。
- 后续阶段应如何表达：页面迁移后，消息面板带 `flex-1`。

## test/user-account-messages.spec.tsx::keeps JS matchMedia on the same OR query as the CSS dual-pane complement
- 源文件：`src/pages/messages/panel.tsx`
- 删除的断言：`expect(panel).toMatch(/min-h-0/);`
- 意图（一句话）：消息面板可以在 flex 列里收缩，从而形成内部滚动。
- 后续阶段应如何表达：页面迁移后，消息面板带 `min-h-0`。

## test/task-management-workspace.spec.ts::keeps the public task cards equal-height with their primary actions aligned
- 源文件：`src/pages/tasks/index.tsx`
- 删除的断言：`expect(publicTasks).not.to.include('auto-rows-fr');`
- 意图（一句话）：公开任务卡片网格不再用 auto-rows-fr 把行高拉成等分。
- 后续阶段应如何表达：页面迁移后，公开任务网格不含 `auto-rows-fr`。

## test/task-management-workspace.spec.ts::keeps the public task cards equal-height with their primary actions aligned
- 源文件：`src/pages/tasks/index.tsx`
- 删除的断言：`expect(publicTasks).not.to.include("!task.description && 'invisible'");`
- 意图（一句话）：没有简介的任务卡不得用 invisible 占位把简介行撑高。
- 后续阶段应如何表达：页面迁移后，公开任务卡不含 `invisible` 简介占位。

## test/task-management-workspace.spec.ts::keeps the public task cards equal-height with their primary actions aligned
- 源文件：`src/pages/tasks/index.tsx`
- 删除的断言：`expect(publicTasks).to.include("'h-full transition-[box-shadow,opacity]");`
- 意图（一句话）：公开任务卡拉满所在网格行，悬停只过渡阴影和透明度。
- 后续阶段应如何表达：页面迁移后，公开任务卡带 `h-full transition-[box-shadow,opacity]`。

## test/task-management-workspace.spec.ts::keeps the public task cards equal-height with their primary actions aligned
- 源文件：`src/pages/tasks/index.tsx`
- 删除的断言：`expect(publicTasks).to.match(/<CardContent[^>]*flex h-full flex-col/);`
- 意图（一句话）：任务卡内容区是纵向 flex 并拉满高度；改写后只保留存在 CardContent。
- 后续阶段应如何表达：页面迁移后，公开任务卡 CardContent 带 `flex h-full flex-col`。

## test/task-management-workspace.spec.ts::keeps the public task cards equal-height with their primary actions aligned
- 源文件：`src/pages/tasks/index.tsx`
- 删除的断言：`expect(publicTasks).to.match(/className="mt-auto pt-1"[\s\S]*?<Button/);`
- 意图（一句话）：主操作按钮贴在卡片底部；改写后只保留存在 Button。
- 后续阶段应如何表达：页面迁移后，公开任务卡主操作带 `mt-auto pt-1`。

## test/task-management-workspace.spec.ts::keeps multi-action task headers reachable on narrow workspaces
- 源文件：`src/pages/admin-tasks/index.tsx`
- 删除的断言：`expect(statsPage).to.include('className="flex max-w-full flex-wrap gap-2"');`
- 意图（一句话）：任务统计页头部的多个操作在窄工作区换行，而不是溢出。
- 后续阶段应如何表达：页面迁移后，任务统计页头部操作行带 `flex max-w-full flex-wrap gap-2`。

## test/task-management-workspace.spec.ts::keeps multi-action task headers reachable on narrow workspaces
- 源文件：`src/pages/admin-tasks/index.tsx`
- 删除的断言：`expect(candidatesPage).to.include('className="flex max-w-full flex-wrap items-center gap-2"');`
- 意图（一句话）：候选名单页头部操作换行并垂直居中，窄工作区仍可点到。
- 后续阶段应如何表达：页面迁移后，候选名单页头部操作行带 `flex max-w-full flex-wrap items-center gap-2`。

## test/management-entry-dialog-announcement.spec.ts::keeps announcement management controls at least forty pixels tall
- 源文件：`src/pages/announcement/index.tsx`
- 删除的断言：`expect(adminWorkspace.match(/contentClassName="\[&_\[role=option\]\]:min-h-10"/g) || []).to.have.lengthOf(3);`
- 意图（一句话）：公告管理的三个下拉选项至少 40px 高。
- 后续阶段应如何表达：页面迁移后，公告管理下拉选项带 `[&_[role=option]]:min-h-10`。

## test/management-entry-dialog-announcement.spec.ts::keeps announcement management controls at least forty pixels tall
- 源文件：`src/pages/announcement/index.tsx`
- 删除的断言：`expect(adminWorkspace.match(/min-h-10/g) || []).to.have.lengthOf(29);`
- 意图（一句话）：公告管理列表里的可点控件普遍至少 40px 高。
- 后续阶段应如何表达：页面迁移后，公告管理控件带 `min-h-10`。

## test/management-entry-dialog-announcement.spec.ts::provides one shared, bounded native-scroll body
- 源文件：`src/components/ui/dialog.tsx`
- 删除的断言：`expect(dialog).to.include('min-h-0 flex-1 overflow-y-auto overscroll-contain');`
- 意图（一句话）：共享 DialogBody 在弹窗内形成有界的原生纵向滚动。
- 后续阶段应如何表达：页面迁移后，DialogBody 带 `min-h-0 flex-1 overflow-y-auto overscroll-contain`。

## test/management-entry-dialog-announcement.spec.ts::keeps both long create forms between fixed headers and action bars
- 源文件：`src/pages/authtoken/index.tsx`
- 删除的断言：`expect(tokens).to.match(/function IssueDialog[\s\S]*?<DialogBody[\s\S]*?<\/DialogBody>[\s\S]*?border-t/);`
- 意图（一句话）：签发令牌表单的操作条在 DialogBody 之后，并用上边框与正文分开；改写后只保留 IssueDialog 含 DialogBody。
- 后续阶段应如何表达：页面迁移后，IssueDialog 操作条带 `border-t`。

## test/management-entry-dialog-announcement.spec.ts::keeps both long create forms between fixed headers and action bars
- 源文件：`src/pages/admin-accounts.tsx`
- 删除的断言：`expect(accounts).to.match(/function CreateAccountDialog[\s\S]*?<DialogBody[\s\S]*?<\/DialogBody>[\s\S]*?border-t/);`
- 意图（一句话）：创建账号表单的操作条在 DialogBody 之后，并用上边框与正文分开；改写后只保留 CreateAccountDialog 含 DialogBody。
- 后续阶段应如何表达：页面迁移后，CreateAccountDialog 操作条带 `border-t`。

## test/sidebar-tooltip.spec.ts::portals floating content beyond scroll-area clipping
- 源文件：`src/components/ui/tooltip.tsx`
- 删除的断言：`expect(tooltip).to.include("position: 'fixed'");`
- 意图（一句话）：侧栏 tooltip 通过 portal 使用 fixed 定位，避免被滚动容器裁切；改写后只保留 position 声明。
- 后续阶段应如何表达：页面迁移后，Tooltip 浮层带 `position: fixed`。

## test/sidebar-tooltip.spec.ts::keeps collapsed navigation targets accessible and deliberately animated
- 源文件：`src/components/layout/sidebar.tsx`
- 删除的断言：`expect(sidebar).to.include('size-11');`
- 意图（一句话）：折叠侧栏的导航目标是 44px 的方形点击区。
- 后续阶段应如何表达：页面迁移后，折叠导航项带 `size-11`。

## test/sidebar-tooltip.spec.ts::keeps collapsed navigation targets accessible and deliberately animated
- 源文件：`src/components/layout/sidebar.tsx`
- 删除的断言：`expect(sidebar).to.include('min-h-11');`
- 意图（一句话）：折叠导航项最小高度 44px，满足触控目标。
- 后续阶段应如何表达：页面迁移后，折叠导航项带 `min-h-11`。

## test/sidebar-tooltip.spec.ts::keeps collapsed navigation targets accessible and deliberately animated
- 源文件：`src/components/layout/sidebar.tsx`
- 删除的断言：`expect(sidebar).to.include('md:min-h-10');`
- 意图（一句话）：md 及以上折叠导航项的最小高度降到 40px。
- 后续阶段应如何表达：页面迁移后，折叠导航项带 `md:min-h-10`。

## test/sidebar-tooltip.spec.ts::keeps collapsed navigation targets accessible and deliberately animated
- 源文件：`src/components/layout/sidebar.tsx`
- 删除的断言：`expect(sidebar).to.include('size-8 min-h-11 min-w-11 md:hidden');`
- 意图（一句话）：移动端关闭侧栏的按钮在 md 以下至少 44px，图标本身是 32px。
- 后续阶段应如何表达：页面迁移后，移动端关闭按钮带 `size-8 min-h-11 min-w-11 md:hidden`。

## test/sidebar-tooltip.spec.ts::keeps collapsed navigation targets accessible and deliberately animated
- 源文件：`src/components/layout/sidebar.tsx`
- 删除的断言：`expect(sidebar).not.to.include('transition-all');`
- 意图（一句话）：折叠侧栏不得用 transition-all，只动画明确列出的属性。
- 后续阶段应如何表达：页面迁移后，侧栏不含 `transition-all`。
