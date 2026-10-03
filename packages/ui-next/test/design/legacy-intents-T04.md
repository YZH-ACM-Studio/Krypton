# T04 遗留布局意图

## test/problem-set-roster.spec.ts::renders PracticeRosterCard full-width on the dedicated roster page
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(rosterPage).to.include('w-full min-w-0');`
- 意图（一句话）：题集参加名单页的根容器和名单卡片占满可用宽度，不能被挤窄。
- 后续阶段应如何表达：页面迁移后，名单页根容器与 PracticeRosterCard 带 `w-full min-w-0`。

## test/problem-set-roster.spec.ts::renders PracticeRosterCard full-width on the dedicated roster page
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(rosterPage).not.to.include('mx-auto');`
- 意图（一句话）：名单页不得用自动水平外边距收成居中窄栏。
- 后续阶段应如何表达：页面迁移后，名单页不含 `mx-auto`。

## test/problem-set-roster.spec.ts::renders PracticeRosterCard full-width on the dedicated roster page
- 源文件：`src/pages/problem-set-roster.tsx`
- 删除的断言：`expect(rosterPage).not.to.include('max-w-[');`
- 意图（一句话）：名单页不得用任意 max-width 限制整页宽度。
- 后续阶段应如何表达：页面迁移后，名单页不含任意值 `max-w-[…]`。

## test/practice-roster-card-source.spec.ts::keeps the roster title, search, class-group header, and both-axis table scroll
- 源文件：`src/components/practice-roster.tsx`
- 删除的断言：`expect(roster).to.include('max-h-[28rem]');`
- 意图（一句话）：成员名单表的滚动区最高 28rem，超出后在卡片内滚动。
- 后续阶段应如何表达：页面迁移后，成员表 ScrollArea 带 `max-h-[28rem]`。

## test/practice-roster-card-source.spec.ts::keeps the roster title, search, class-group header, and both-axis table scroll
- 源文件：`src/components/practice-roster.tsx`
- 删除的断言：`expect(roster).to.include('min-w-[640px]');`
- 意图（一句话）：成员表至少 640px 宽，窄容器里横向滚动而不是挤列。
- 后续阶段应如何表达：页面迁移后，成员表带 `min-w-[640px]`。

## test/krypton-ide-submit.spec.tsx::keeps the run-all control width stable while a self-test enters cooldown
- 源文件：`src/components/krypton-ide.tsx`
- 删除的断言：`expect(runAll).toHaveClass('w-[7.25rem]', 'shrink-0');`
- 意图（一句话）：运行全部自测按钮固定宽度，文案换成倒计时后位置不跳动。
- 后续阶段应如何表达：页面迁移后，运行全部自测按钮带 `w-[7.25rem] shrink-0`。

## test/krypton-ide-submit.spec.tsx::keeps the run-all control width stable while a self-test enters cooldown
- 源文件：`src/components/krypton-ide.tsx`
- 删除的断言：`expect(screen.getByRole('button', { name: '3s' })).toHaveClass('w-[7.25rem]', 'shrink-0');`
- 意图（一句话）：冷却中显示秒数的同一按钮仍保持固定宽度。
- 后续阶段应如何表达：页面迁移后，冷却态按钮带 `w-[7.25rem] shrink-0`。

## test/domain-permission-workspace.spec.ts::renders one full-width master-detail workspace with the same narrow-screen business state
- 源文件：`src/pages/domain-permission-workspace.tsx`
- 删除的断言：`expect(workspace).to.include('lg:grid-cols-[17rem_minmax(0,1fr)]');`
- 意图（一句话）：宽屏下角色列表与权限详情并排，左栏 17rem，右栏占满剩余宽度。
- 后续阶段应如何表达：页面迁移后，工作区网格带 `lg:grid-cols-[17rem_minmax(0,1fr)]`。

## test/domain-permission-workspace.spec.ts::renders one full-width master-detail workspace with the same narrow-screen business state
- 源文件：`src/pages/domain-permission-workspace.tsx`
- 删除的断言：`expect(workspace).to.include('className="border-b p-4 lg:hidden"');`
- 意图（一句话）：窄屏用顶部分隔的角色选择器，lg 及以上隐藏，不与左侧列表重复。
- 后续阶段应如何表达：页面迁移后，窄屏角色选择器带 `border-b p-4 lg:hidden`。

## test/domain-permission-workspace.spec.ts::renders one full-width master-detail workspace with the same narrow-screen business state
- 源文件：`src/pages/domain-permission-workspace.tsx`
- 删除的断言：`expect(workspace).not.to.include('transition-all');`
- 意图（一句话）：工作区不得用 transition-all 动画宽屏分栏切换。
- 后续阶段应如何表达：页面迁移后，权限工作区不含 `transition-all`。

## test/domain-permission-workspace.spec.ts::keeps drafts local, previews exact differences and retains failures
- 源文件：`src/pages/domain-permission-workspace.tsx`
- 删除的断言：`expect(workspace).to.include('sticky bottom-2');`
- 意图（一句话）：未保存草稿的操作条贴在视口底部，长权限列表滚动时仍可保存。
- 后续阶段应如何表达：页面迁移后，草稿操作条带 `sticky bottom-2`。

## test/contest-exam-seat-entry.spec.tsx::keeps the seat workflow beside the contest editor instead of a narrow stacked card
- 源文件：`src/pages/contest-manage.tsx`
- 删除的断言：`expect(layout?.className).toContain('gap-6');`
- 意图（一句话）：编辑页上座位工作流与比赛表单同一网格，间距为 gap-6，而不是窄卡片叠放。
- 后续阶段应如何表达：页面迁移后，编辑页主网格带 `gap-6`。

## test/contest-exam-seat-entry.spec.tsx::keeps the seat workflow beside the contest editor instead of a narrow stacked card
- 源文件：`src/pages/contest-manage.tsx`
- 删除的断言：`expect(layout?.className).toContain('2xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]');`
- 意图（一句话）：2xl 及以上座位卡在表单右侧，左栏弹性、右栏 24–32rem。
- 后续阶段应如何表达：页面迁移后，编辑页主网格带 `2xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]`。

## test/contest-exam-seat-entry.spec.tsx::keeps the seat workflow beside the contest editor instead of a narrow stacked card
- 源文件：`src/pages/contest-manage.tsx`
- 删除的断言：`expect(layout?.querySelector('.max-w-5xl')).toBeNull();`
- 意图（一句话）：座位卡的父级布局里不再套一层 max-w-5xl 窄容器。
- 后续阶段应如何表达：页面迁移后，该布局不含 `max-w-5xl`。

## test/competitive-companion.spec.ts::keeps the problem page bridge off Exam Mode
- 源文件：`src/pages/problem-detail.tsx`
- 删除的断言：`expect(problemDetail).not.to.match(/<div className="flex-1" \/>\s*\{showCompanion \? \(\s*<CompetitiveCompanionBridge/);`
- 意图（一句话）：Companion 桥不得接在空的 flex-1 占位后面被挤到行尾。
- 后续阶段应如何表达：页面迁移后，题目页不把 CompetitiveCompanionBridge 放在 `flex-1` 占位之后。

## test/admin-nav.spec.ts::keeps the secondary w-56 rail off the layout below lg
- 源文件：`src/components/admin/admin-sidebar.tsx`
- 删除的断言：`expect(sidebar).to.include('hidden h-full min-h-0 w-56 shrink-0 lg:block');`
- 意图（一句话）：管理侧栏在 lg 以下隐藏，lg 及以上是 14rem 宽的独立纵向滚动轨。
- 后续阶段应如何表达：页面迁移后，AdminSidebar 的 aside 带 `hidden h-full min-h-0 w-56 shrink-0 lg:block`。

## test/table-both-axis-scroll.spec.tsx::uses that both-axis owner around the IDE records table and the training roster
- 源文件：`src/pages/problem-detail.tsx`
- 删除的断言：`const tableAt = problemDetail.indexOf('className="min-w-[620px] w-full text-xs"');`
- 意图（一句话）：IDE 提交记录表至少 620px 宽且铺满，窄视口下各列仍可横向到达。
- 后续阶段应如何表达：页面迁移后，提交记录表带 `min-w-[620px] w-full text-xs`。

## test/table-both-axis-scroll.spec.tsx::uses that both-axis owner around the IDE records table and the training roster
- 源文件：`src/components/practice-roster.tsx`
- 删除的断言：`const membersAt = roster.indexOf('min-w-[640px]');`
- 意图（一句话）：训练名单成员表至少 640px 宽，并位于双向滚动区之内。
- 后续阶段应如何表达：页面迁移后，成员表带 `min-w-[640px]`。

## test/table-both-axis-scroll.spec.tsx::uses that both-axis owner around the IDE records table and the training roster
- 源文件：`src/components/practice-roster.tsx`
- 删除的断言：`expect(roster).to.include('whitespace-nowrap');`
- 意图（一句话）：名单表单元格不换行，列宽由内容撑开后横向滚动。
- 后续阶段应如何表达：页面迁移后，名单表带 `whitespace-nowrap`。

## test/table-both-axis-scroll.spec.tsx::uses that both-axis owner around the IDE records table and the training roster
- 源文件：`src/components/practice-roster.tsx`
- 删除的断言：`expect(roster).to.include('sticky left-0');`
- 意图（一句话）：每题完成人数矩阵的题目标题列在横向滚动时钉在左侧。
- 后续阶段应如何表达：页面迁移后，矩阵首列带 `sticky left-0`。
