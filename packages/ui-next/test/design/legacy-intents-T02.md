## test/drawer-scroll-consumers.spec.ts::keeps every previous sheet title and routes bodies through SheetBody or ScrollArea
- 源文件：src/pages/problems.tsx
- 删除的断言：``expect(tag, `${path} SheetContent must not own overflow-y-auto`).not.to.include('overflow-y-auto');``
- 意图（一句话）：题库、课程、监考、代码快照和任务管理的 SheetContent 开标签不得自己纵向滚动。
- 后续阶段应如何表达：页面迁移后，这些抽屉的 SheetContent 不得带 `overflow-y-auto`。

## test/drawer-scroll-consumers.spec.ts::keeps every previous sheet title and routes bodies through SheetBody or ScrollArea
- 源文件：src/components/team-code-snapshots.tsx
- 删除的断言：`expect(snapshots).to.include('grid-rows-[minmax(0,40%)_minmax(0,1fr)]');`
- 意图（一句话）：代码快照抽屉在窄屏把上下两栏限制在 40% 与剩余高度。
- 后续阶段应如何表达：页面迁移后，快照网格带 `grid-rows-[minmax(0,40%)_minmax(0,1fr)]`。

## test/drawer-scroll-consumers.spec.ts::keeps every previous sheet title and routes bodies through SheetBody or ScrollArea
- 源文件：src/components/team-code-snapshots.tsx
- 删除的断言：`expect(snapshots).to.include('md:grid-rows-[minmax(0,1fr)]');`
- 意图（一句话）：中屏及以上取消上下分栏，改成单行撑满。
- 后续阶段应如何表达：页面迁移后，快照网格带 `md:grid-rows-[minmax(0,1fr)]`。

## test/drawer-scroll-consumers.spec.ts::keeps every previous sheet title and routes bodies through SheetBody or ScrollArea
- 源文件：src/components/team-code-snapshots.tsx
- 删除的断言：`expect(snapshots).to.include('md:grid-cols-[19rem_minmax(0,1fr)]');`
- 意图（一句话）：中屏及以上左侧列表固定 19rem，右侧内容占据剩余宽度。
- 后续阶段应如何表达：页面迁移后，快照网格带 `md:grid-cols-[19rem_minmax(0,1fr)]`。

## test/drawer-scroll-consumers.spec.ts::keeps every previous sheet title and routes bodies through SheetBody or ScrollArea
- 源文件：src/components/team-code-snapshots.tsx
- 删除的断言：`expect(snapshots).not.to.include('min-h-[18rem]');`
- 意图（一句话）：快照面板不得再用 18rem 的硬性最小高度。
- 后续阶段应如何表达：页面迁移后，快照面板不得带 `min-h-[18rem]`。

## test/drawer-scroll-consumers.spec.ts::preserves DialogBody and TeamDialogBody native overflow contracts
- 源文件：src/components/ui/dialog.tsx
- 删除的断言：`expect(dialog).to.include('min-h-0 flex-1 overflow-y-auto overscroll-contain');`
- 意图（一句话）：DialogBody 是对话框里可收缩的纵向滚动主体，并挡住滚动链。
- 后续阶段应如何表达：页面迁移后，DialogBody 带 `min-h-0 flex-1 overflow-y-auto overscroll-contain`。

## test/drawer-scroll-consumers.spec.ts::preserves DialogBody and TeamDialogBody native overflow contracts
- 源文件：src/components/team-dialog.tsx
- 删除的断言：`expect(team).to.include('overflow-y-auto overscroll-contain');`
- 意图（一句话）：TeamDialogBody 继续纵向滚动并挡住滚动链。
- 后续阶段应如何表达：页面迁移后，TeamDialogBody 带 `overflow-y-auto overscroll-contain`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/pages/problem-detail.tsx
- 删除的断言：`expect(problemDetail).to.include('min-w-[620px]');`
- 意图（一句话）：题目详情里的宽表至少 620px，以便在双向滚动区域内横向滚动。
- 后续阶段应如何表达：页面迁移后，该表带 `min-w-[620px]`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/pages/problem-detail.tsx
- 删除的断言：`expect(problemDetail).to.match(/<ScrollArea className="min-h-0 flex-1" orientation="both">/);`
- 意图（一句话）：题目详情宽表的 ScrollArea 在剩余高度内双向滚动；改写后仍断言 `orientation="both"`。
- 后续阶段应如何表达：页面迁移后，该 ScrollArea 带 `min-h-0 flex-1`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/components/practice-roster.tsx
- 删除的断言：`expect(roster).to.match(/<ScrollArea className="max-h-\[28rem\]" orientation="both">/);`
- 意图（一句话）：参加名单表格限制在 28rem 高度内并双向滚动；改写后仍断言 `orientation="both"`。
- 后续阶段应如何表达：页面迁移后，名单 ScrollArea 带 `max-h-[28rem]`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/components/practice-roster.tsx
- 删除的断言：`expect(roster).to.include('min-w-[640px]');`
- 意图（一句话）：参加名单表格至少 640px 宽，避免列被压扁。
- 后续阶段应如何表达：页面迁移后，名单表格带 `min-w-[640px]`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/pages/records.tsx
- 删除的断言：`expect(records).to.match(/<ScrollArea className="max-h-\[min\(65vh,680px\)\] w-full" orientation="both">/);`
- 意图（一句话）：记录表滚动区全宽，高度不超过 65vh 与 680px 中的较小值，并双向滚动；改写后仍断言 `orientation="both"`。
- 后续阶段应如何表达：页面迁移后，记录 ScrollArea 带 `max-h-[min(65vh,680px)] w-full`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/pages/records.tsx
- 删除的断言：`expect(records).to.include("<table className={cn(RECORD_NATIVE_TABLE_CLASS, 'min-w-[56rem]')}>");`
- 意图（一句话）：记录原生表在共用表格类之外至少 56rem 宽；改写后仍断言使用 `RECORD_NATIVE_TABLE_CLASS`。
- 后续阶段应如何表达：页面迁移后，该记录表带 `min-w-[56rem]`。

## test/drawer-scroll-consumers.spec.ts::keeps both-axis scroll on wide native tables and lets Table own horizontal overflow
- 源文件：src/pages/realpass-manage.tsx
- 删除的断言：`expect(realpass).to.match(/<ScrollArea className="max-h-80" viewportLayout="block">/);`
- 意图（一句话）：赛时通过率表格限制在 max-h-80，并由块级视口承接横向滚动；改写后仍断言 `viewportLayout="block"`。
- 后续阶段应如何表达：页面迁移后，该 ScrollArea 带 `max-h-80`。

## test/drawer-scroll-consumers.spec.ts::exports a shared SheetBody scroll owner from the existing Sheet primitive
- 源文件：src/components/ui/sheet.tsx
- 删除的断言：`expect(sheet).not.to.include('overflow-y-auto');`
- 意图（一句话）：Sheet 原语自身不带纵向滚动，滚动只属于 SheetBody。
- 后续阶段应如何表达：页面迁移后，Sheet 原语不得带 `overflow-y-auto`。

## test/user-profile-external-rating.spec.ts::keeps the two-site rating row full width without max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(profileSource).to.include('sm:grid-cols-2');`
- 意图（一句话）：两个外站 Rating 同时可见时，中屏排成两列。
- 后续阶段应如何表达：页面迁移后，双站 Rating 行带 `sm:grid-cols-2`。

## test/user-profile-external-rating.spec.ts::keeps the two-site rating row full width without max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(profileSource).to.include("cn('grid w-full min-w-0 gap-6', visibleExternalRatingSites.length > 1 && 'sm:grid-cols-2')");`
- 意图（一句话）：两列网格只在可见站点多于一个时加上，并且行本身全宽可收缩；改写后仍断言站点数量条件。
- 后续阶段应如何表达：页面迁移后，Rating 行带 `grid w-full min-w-0 gap-6`，多于一个站点时再带 `sm:grid-cols-2`。

## test/user-profile-external-rating.spec.ts::keeps the two-site rating row full width without max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(profileSource).not.to.include('max-w-xl');`
- 意图（一句话）：外站 Rating 区域不得再被收成 max-w-xl。
- 后续阶段应如何表达：页面迁移后，Rating 区域不得带 `max-w-xl`。

## test/user-profile-external-rating.spec.ts::renders EChart only when a visible site history array length >= 1
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(profileSource).to.include('h-[240px] w-full min-w-0');`
- 意图（一句话）：Rating 历史图固定 240px 高、全宽且允许收缩。
- 后续阶段应如何表达：页面迁移后，Rating 历史图带 `h-[240px] w-full min-w-0`。

## test/user-profile-external-rating.spec.ts::uses a full-width two-site rating row with no max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(row!.className).to.include('sm:grid-cols-2');`
- 意图（一句话）：两个站点都公开时，渲染出的 Rating 行在中屏是两列。
- 后续阶段应如何表达：页面迁移后，双站 Rating 行带 `sm:grid-cols-2`。

## test/user-profile-external-rating.spec.ts::uses a full-width two-site rating row with no max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(row!.className).not.to.match(/max-w-xl/);`
- 意图（一句话）：双站 Rating 行的 DOM 不得带 max-w-xl。
- 后续阶段应如何表达：页面迁移后，双站 Rating 行不得带 `max-w-xl`。

## test/user-profile-external-rating.spec.ts::keeps a single visible site full width instead of max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(row!.className).not.to.include('sm:grid-cols-2');`
- 意图（一句话）：只公开一个站点时，Rating 行不得排成两列。
- 后续阶段应如何表达：页面迁移后，单站 Rating 行不得带 `sm:grid-cols-2`。

## test/user-profile-external-rating.spec.ts::keeps a single visible site full width instead of max-w-xl
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(row!.className).not.to.match(/max-w-xl/);`
- 意图（一句话）：单站 Rating 行也不得收成 max-w-xl。
- 后续阶段应如何表达：页面迁移后，单站 Rating 行不得带 `max-w-xl`。

## test/user-profile-external-rating.spec.ts::renders EChart when history has at least one point
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(chart.className).to.include('h-[240px]');`
- 意图（一句话）：有历史点时挂载的图表高度为 240px。
- 后续阶段应如何表达：页面迁移后，Rating 历史图带 `h-[240px]`。

## test/user-profile-external-rating.spec.ts::renders EChart for a privileged viewer when handle is unset but history remains
- 源文件：src/pages/user.tsx
- 删除的断言：`expect(chart.className).to.include('h-[240px]');`
- 意图（一句话）：本人仍能看到未公开手柄留下的历史图，且高度为 240px。
- 后续阶段应如何表达：页面迁移后，该历史图带 `h-[240px]`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /overflow-x-auto/);`
- 意图（一句话）：模块导航在窄屏可以横向滚动。
- 后续阶段应如何表达：页面迁移后，模块导航带 `overflow-x-auto`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /min-h-11/);`
- 意图（一句话）：导航链接的点击高度至少为 44px。
- 后续阶段应如何表达：页面迁移后，导航链接带 `min-h-11`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /focus-visible:ring-2/);`
- 意图（一句话）：键盘聚焦导航链接时显示 2px 焦点环。
- 后续阶段应如何表达：页面迁移后，导航链接带 `focus-visible:ring-2`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /duration-200/);`
- 意图（一句话）：导航颜色与背景过渡时长为 200ms。
- 后续阶段应如何表达：页面迁移后，导航链接带 `duration-200`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /motion-reduce:transition-none/);`
- 意图（一句话）：用户要求减少动效时，导航不再播放过渡。
- 后续阶段应如何表达：页面迁移后，导航链接带 `motion-reduce:transition-none`。

## test/management-workspace.contract.test.mjs::management workspace navigation is accessible, compact, and reduced-motion aware
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.doesNotMatch(workspace, /backdrop-blur|gradient/);`
- 意图（一句话）：管理工作区不使用磨砂玻璃或渐变。
- 后续阶段应如何表达：页面迁移后，管理工作区不得带 `backdrop-blur` 或渐变背景。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /<section aria-labelledby=\{titleId\} className="min-w-0 max-w-full space-y-5">/);`
- 意图（一句话）：工作区主区域可收缩、不超过父宽度，区块间距为 space-y-5；改写后仍断言 `aria-labelledby={titleId}`。
- 后续阶段应如何表达：页面迁移后，该 section 带 `min-w-0 max-w-full space-y-5`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.doesNotMatch(workspace, /overflow-x-clip/);`
- 意图（一句话）：工作区不得用 overflow-x-clip 裁掉横向溢出。
- 后续阶段应如何表达：页面迁移后，工作区不得带 `overflow-x-clip`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /<nav aria-label=\{navAriaLabel\} className="-mx-1 overflow-x-auto px-1 pb-1 touch-pan-x lg:hidden">/);`
- 意图（一句话）：lg 以下用可横向拖动的胶囊导航，lg 起隐藏；改写后仍断言 `aria-label={navAriaLabel}`。
- 后续阶段应如何表达：页面迁移后，胶囊导航带 `-mx-1 overflow-x-auto px-1 pb-1 touch-pan-x lg:hidden`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /overflow-x-auto/);`
- 意图（一句话）：窄屏导航可以横向滚动。
- 后续阶段应如何表达：页面迁移后，窄屏导航带 `overflow-x-auto`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /touch-pan-x/);`
- 意图（一句话）：窄屏导航允许横向触摸平移。
- 后续阶段应如何表达：页面迁移后，窄屏导航带 `touch-pan-x`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /whitespace-nowrap/);`
- 意图（一句话）：导航文字不换行，以便整行横向滚动。
- 后续阶段应如何表达：页面迁移后，导航链接带 `whitespace-nowrap`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /shrink-0/);`
- 意图（一句话）：导航链接不被 flex 压缩。
- 后续阶段应如何表达：页面迁移后，导航链接带 `shrink-0`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /lg:hidden/);`
- 意图（一句话）：胶囊导航从 lg 起隐藏。
- 后续阶段应如何表达：页面迁移后，胶囊导航带 `lg:hidden`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);`
- 意图（一句话）：lg 起左侧导航轨固定 15rem，内容占剩余宽度。
- 后续阶段应如何表达：页面迁移后，导航布局带 `lg:grid-cols-[15rem_minmax(0,1fr)]`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /sticky top-0/);`
- 意图（一句话）：宽屏导航轨贴在滚动容器顶部。
- 后续阶段应如何表达：页面迁移后，宽屏导航带 `sticky top-0`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /hidden min-w-0 lg:block/);`
- 意图（一句话）：侧栏在 lg 以下隐藏，lg 起显示且允许收缩。
- 后续阶段应如何表达：页面迁移后，侧栏带 `hidden min-w-0 lg:block`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /flex min-h-11 min-w-0 flex-wrap/);`
- 意图（一句话）：工具条至少 44px 高、可换行且允许收缩。
- 后续阶段应如何表达：页面迁移后，工具条带 `flex min-h-11 min-w-0 flex-wrap`。

## test/management-workspace.contract.test.mjs::keeps compact pills below lg, a sticky 15rem rail from lg, and full width when nav is hidden
- 源文件：src/components/management/module-workspace.tsx
- 删除的断言：`assert.match(workspace, /hideNav \? \([\s\S]*?toolbarSection[\s\S]*?mainContent[\s\S]*?lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);`
- 意图（一句话）：隐藏导航时先放工具条再放正文，15rem 轨只出现在显示导航的分支；改写后仍断言 hideNav 分支的顺序。
- 后续阶段应如何表达：页面迁移后，显示导航的分支带 `lg:grid-cols-[15rem_minmax(0,1fr)]`。

## test/admin-stats-echarts.spec.ts::renders every chart through EChart and drops the local SVG/CSS charts
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('h-[280px] w-full min-w-0');`
- 意图（一句话）：统计图容器高 280px、全宽且允许收缩。
- 后续阶段应如何表达：页面迁移后，统计图容器带 `h-[280px] w-full min-w-0`。

## test/admin-stats-echarts.spec.ts::renders every chart through EChart and drops the local SVG/CSS charts
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).not.to.include('min-w-[600px]');`
- 意图（一句话）：统计页不再用 600px 最小宽度把图表撑出视口。
- 后续阶段应如何表达：页面迁移后，统计页不得带 `min-w-[600px]`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('grid-cols-12');`
- 意图（一句话）：统计仪表盘使用 12 列网格。
- 后续阶段应如何表达：页面迁移后，仪表盘带 `grid-cols-12`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('lg:grid-cols-12');`
- 意图（一句话）：大屏也保持 12 列，而不是换成别的列模板。
- 后续阶段应如何表达：页面迁移后，大屏仪表盘带 `lg:grid-cols-12`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('lg:col-span-8');`
- 意图（一句话）：主图表在大屏占 8 列。
- 后续阶段应如何表达：页面迁移后，主图表带 `lg:col-span-8`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('lg:col-span-4');`
- 意图（一句话）：侧栏图表在大屏占 4 列。
- 后续阶段应如何表达：页面迁移后，侧栏图表带 `lg:col-span-4`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('shadow-none');`
- 意图（一句话）：统计卡片不额外加阴影。
- 后续阶段应如何表达：页面迁移后，统计卡片带 `shadow-none`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).to.include('w-full min-w-0');`
- 意图（一句话）：统计卡片全宽且可以在网格里收缩。
- 后续阶段应如何表达：页面迁移后，统计卡片带 `w-full min-w-0`。

## test/admin-stats-echarts.spec.ts::keeps the scanned labels, 12-col dashboard layout, and admin gate
- 源文件：src/pages/admin-stats.tsx
- 删除的断言：`expect(page).not.to.include('xl:grid-cols-[minmax(0,1fr)_320px]');`
- 意图（一句话）：统计页不得退回右侧固定 320px 的旧分栏。
- 后续阶段应如何表达：页面迁移后，统计页不得带 `xl:grid-cols-[minmax(0,1fr)_320px]`。

## test/structured-code-ui.spec.ts::keeps consecutive authoring actions close without shrinking the active workspace
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(editor).to.include('min-h-[min(32rem,calc(100dvh-12rem))]');`
- 意图（一句话）：作答阶段面板至少撑开，但不超过视口减去顶栏后的高度。
- 后续阶段应如何表达：页面迁移后，阶段面板带 `min-h-[min(32rem,calc(100dvh-12rem))]`。

## test/structured-code-ui.spec.ts::keeps consecutive authoring actions close without shrinking the active workspace
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(editor).not.to.include('min-h-[32rem]');`
- 意图（一句话）：阶段面板不得用固定 32rem 最小高度把矮屏撑出视口。
- 后续阶段应如何表达：页面迁移后，阶段面板不得带 `min-h-[32rem]`。

## test/structured-code-ui.spec.ts::keeps consecutive authoring actions close without shrinking the active workspace
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(editor).to.include('sticky bottom-0');`
- 意图（一句话）：上一步与下一步操作条贴在工作区底部。
- 后续阶段应如何表达：页面迁移后，操作条带 `sticky bottom-0`。

## test/structured-code-ui.spec.ts::keeps consecutive authoring actions close without shrinking the active workspace
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(editor).to.include('pb-safe');`
- 意图（一句话）：底部操作条为安全区留出内边距。
- 后续阶段应如何表达：页面迁移后，操作条带 `pb-safe`。

## test/structured-code-ui.spec.ts::keeps consecutive authoring actions close without shrinking the active workspace
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(editor).to.include('pb-[max(0.5rem,env(safe-area-inset-bottom))]');`
- 意图（一句话）：底部内边距至少 0.5rem，并吃掉系统安全区。
- 后续阶段应如何表达：页面迁移后，操作条带 `pb-[max(0.5rem,env(safe-area-inset-bottom))]`。

## test/structured-code-ui.spec.ts::uses a full-height whole-line CodeMirror selector with accessible source states
- 源文件：src/components/structured-region-author-editor.tsx
- 删除的断言：`expect(editor).to.include('h-[min(32rem,calc(100dvh-12rem))]');`
- 意图（一句话）：作者端整行选择器的高度随视口收缩，上限约 32rem。
- 后续阶段应如何表达：页面迁移后，选择器带 `h-[min(32rem,calc(100dvh-12rem))]`。

## test/structured-code-ui.spec.ts::uses a full-height whole-line CodeMirror selector with accessible source states
- 源文件：src/components/structured-region-author-editor.tsx
- 删除的断言：`expect(editor).not.to.include('min-h-[32rem]');`
- 意图（一句话）：选择器不得改回固定 32rem 最小高度。
- 后续阶段应如何表达：页面迁移后，选择器不得带 `min-h-[32rem]`。

## test/structured-code-ui.spec.ts::renders the server-safe continuous surface through the shared student component
- 源文件：src/components/structured-region-inputs.tsx
- 删除的断言：`expect(inputs).to.include('overflow-x-auto');`
- 意图（一句话）：学生看到的连续代码行可以横向滚动，而不是被裁切。
- 后续阶段应如何表达：页面迁移后，连续代码行带 `overflow-x-auto`。

## test/structured-code-ui.spec.ts::keeps inline blanks single-line, source-ordered, keyboard reachable, and narrow-screen scrollable
- 源文件：src/components/structured-region-inputs.tsx
- 删除的断言：`expect(inputs).to.include('className="h-9 min-h-9 min-w-0 w-full font-mono"');`
- 意图（一句话）：行内填空是 36px 高的等宽输入，全宽且允许在窄屏收缩。
- 后续阶段应如何表达：页面迁移后，行内填空带 `h-9 min-h-9 min-w-0 w-full font-mono`。

## test/structured-code-ui.spec.ts::keeps inline blanks single-line, source-ordered, keyboard reachable, and narrow-screen scrollable
- 源文件：src/components/structured-region-inputs.tsx
- 删除的断言：`expect(inputs).to.include('overflow-x-auto whitespace-pre');`
- 意图（一句话）：行内代码保持预格式空白，超长时横向滚动。
- 后续阶段应如何表达：页面迁移后，行内代码带 `overflow-x-auto whitespace-pre`。

## test/structured-code-ui.spec.ts::keeps inline blanks single-line, source-ordered, keyboard reachable, and narrow-screen scrollable
- 源文件：src/components/structured-region-inputs.tsx
- 删除的断言：`expect(inputs).not.to.include('min-w-[18rem]');`
- 意图（一句话）：行内填空不得再强制 18rem 最小宽度。
- 后续阶段应如何表达：页面迁移后，行内填空不得带 `min-w-[18rem]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(adminPage).to.include('h-[calc(100dvh-4.5rem)]');`
- 意图（一句话）：分栏滚动区的高度扣掉默认路由内边距。
- 后续阶段应如何表达：页面迁移后，管理页滚动区带 `h-[calc(100dvh-4.5rem)]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(adminPage).to.include('sm:h-[calc(100dvh-6rem)]');`
- 意图（一句话）：sm 起按更大的路由内边距重算滚动区高度。
- 后续阶段应如何表达：页面迁移后，管理页滚动区带 `sm:h-[calc(100dvh-6rem)]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(adminPage).to.include('xl:h-[calc(100dvh-7rem)]');`
- 意图（一句话）：xl 起继续按更厚的顶栏内边距重算高度。
- 后续阶段应如何表达：页面迁移后，管理页滚动区带 `xl:h-[calc(100dvh-7rem)]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(adminPage).to.include('[&>div]:min-w-0 [&>div]:w-full');`
- 意图（一句话）：滚动视口的直接子元素全宽且允许收缩，避免表格把页面撑开。
- 后续阶段应如何表达：页面迁移后，滚动视口带 `[&>div]:min-w-0 [&>div]:w-full`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`const heightAt = adminPage.indexOf('h-[calc(100dvh-4.5rem)]');`
- 意图（一句话）：用高度类名定位分栏滚动实现，以便确认它出现在 hideSidebar 分支之后。
- 后续阶段应如何表达：页面迁移后，hideSidebar 分支不得带 `h-[calc(100dvh-4.5rem)]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(hideSidebarAt).to.be.lessThan(heightAt);`
- 意图（一句话）：hideSidebar 提前返回，因此不套用分栏滚动高度。
- 后续阶段应如何表达：页面迁移后，hideSidebar 分支不得带 `h-[calc(100dvh-4.5rem)]`。

## test/admin-pages.spec.tsx::pins split-scroll height to router padding and does not lock hideSidebar pages
- 源文件：src/components/admin/admin-page.tsx
- 删除的断言：`expect(adminPage).to.include('return <div className="w-full min-w-0">{body}</div>');`
- 意图（一句话）：隐藏侧栏时根节点全宽且允许收缩，不再锁死视口高度。
- 后续阶段应如何表达：页面迁移后，hideSidebar 根节点带 `w-full min-w-0`。

## test/admin-pages.spec.tsx::wraps long forbidden messages and lets the action row wrap
- 源文件：src/components/admin/forbidden.tsx
- 删除的断言：`expect(message.className).to.match(/break-words/);`
- 意图（一句话）：无权访问的长说明在卡片内换行，而不是撑破布局。
- 后续阶段应如何表达：页面迁移后，无权说明带 `break-words`。

## test/admin-pages.spec.tsx::wraps long forbidden messages and lets the action row wrap
- 源文件：src/components/admin/forbidden.tsx
- 删除的断言：`expect(actions?.className).to.match(/flex-wrap/);`
- 意图（一句话）：无权面板的操作按钮在窄屏换行。
- 后续阶段应如何表达：页面迁移后，操作行带 `flex-wrap`。

## test/admin-pages.spec.tsx::lets unsaved-changes copy be injected and defaults to the current page
- 源文件：src/components/unsaved-changes-guard.tsx
- 删除的断言：`expect(guard).to.include('min-h-11 w-full sm:w-auto');`
- 意图（一句话）：放弃更改对话框的按钮在手机上全宽、至少 44px，sm 起恢复自动宽度。
- 后续阶段应如何表达：页面迁移后，对话框按钮带 `min-h-11 w-full sm:w-auto`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="mt-1 max-w-prose text-sm text-muted-foreground"');`
- 意图（一句话）：重测说明使用小号次要文字，并限制在 prose 宽度。
- 后续阶段应如何表达：页面迁移后，重测说明带 `mt-1 max-w-prose text-sm text-muted-foreground`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="flex flex-wrap items-center gap-2"');`
- 意图（一句话）：入口操作在窄屏换行排列。
- 后续阶段应如何表达：页面迁移后，入口操作行带 `flex flex-wrap items-center gap-2`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="h-auto whitespace-normal"');`
- 意图（一句话）：入口按钮允许文字换行，而不是保持单行固定高度。
- 后续阶段应如何表达：页面迁移后，入口按钮带 `h-auto whitespace-normal`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="flex flex-wrap items-center gap-2 text-base"');`
- 意图（一句话）：剩余时间标题与旁边的状态可以换行，字号为 text-base。
- 后续阶段应如何表达：页面迁移后，剩余时间标题带 `flex flex-wrap items-center gap-2 text-base`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="min-w-0 truncate"');`
- 意图（一句话）：题目标题在剩余空间里截断，不把一行撑开。
- 后续阶段应如何表达：页面迁移后，题目标题带 `min-w-0 truncate`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('className="shrink-0"');`
- 意图（一句话）：题目标题旁的徽章不被压缩。
- 后续阶段应如何表达：页面迁移后，该徽章带 `shrink-0`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('<div className="min-w-0 space-y-4">');`
- 意图（一句话）：虚拟参赛正文列允许收缩，区块间距为 space-y-4。
- 后续阶段应如何表达：页面迁移后，正文列带 `min-w-0 space-y-4`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('<Card className="min-w-0">');`
- 意图（一句话）：榜单卡片允许在窄屏收缩。
- 后续阶段应如何表达：页面迁移后，榜单卡片带 `min-w-0`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('<ScrollArea className="w-full" orientation="both">');`
- 意图（一句话）：榜单在全宽区域内双向滚动；改写后仍断言 `orientation="both"`。
- 后续阶段应如何表达：页面迁移后，榜单 ScrollArea 带 `w-full`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('krypton-table min-w-max');`
- 意图（一句话）：榜单表格按内容撑开最小宽度，以便横向滚动而不是挤压列。
- 后续阶段应如何表达：页面迁移后，榜单表格带 `krypton-table min-w-max`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('min-w-20 whitespace-nowrap');`
- 意图（一句话）：表头单元格至少 5rem 宽且不换行。
- 后续阶段应如何表达：页面迁移后，表头单元格带 `min-w-20 whitespace-nowrap`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('min-w-20 whitespace-pre-line');`
- 意图（一句话）：另一类表头保留换行，同时至少 5rem 宽。
- 后续阶段应如何表达：页面迁移后，该类表头带 `min-w-20 whitespace-pre-line`。

## test/virtual-contest-ui.spec.ts::wraps entry actions, remaining label, problem titles, and scoreboard columns without a live timer protocol
- 源文件：src/pages/virtual-contest.tsx
- 删除的断言：`expect(page).to.include('min-w-24 whitespace-nowrap');`
- 意图（一句话）：成绩列至少 6rem 宽且不换行。
- 后续阶段应如何表达：页面迁移后，成绩列带 `min-w-24 whitespace-nowrap`。

## test/programming-editor-workspace.spec.ts::uses real routes for one ordered five-part workspace
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).to.include('lg:grid-cols-[15rem_minmax(0,1fr)]');`
- 意图（一句话）：编程题工作区在 lg 起使用 15rem 导航轨和剩余内容列。
- 后续阶段应如何表达：页面迁移后，工作区带 `lg:grid-cols-[15rem_minmax(0,1fr)]`。

## test/programming-editor-workspace.spec.ts::uses real routes for one ordered five-part workspace
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).to.include('lg:hidden');`
- 意图（一句话）：窄屏导航从 lg 起隐藏。
- 后续阶段应如何表达：页面迁移后，窄屏导航带 `lg:hidden`。

## test/programming-editor-workspace.spec.ts::merges metadata, managed source, visibility, and statement into one content form without sticky overlay
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).not.to.include('sticky top-12');`
- 意图（一句话）：工作区导航不得再用 top-12 的粘性叠层。
- 后续阶段应如何表达：页面迁移后，工作区导航不得带 `sticky top-12`。

## test/programming-editor-workspace.spec.ts::merges metadata, managed source, visibility, and statement into one content form without sticky overlay
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).not.to.include('backdrop-blur');`
- 意图（一句话）：工作区不得使用磨砂玻璃叠层。
- 后续阶段应如何表达：页面迁移后，工作区不得带 `backdrop-blur`。

## test/programming-editor-workspace.spec.ts::merges metadata, managed source, visibility, and statement into one content form without sticky overlay
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).not.to.include('overflow-x-clip');`
- 意图（一句话）：工作区不得裁剪横向溢出。
- 后续阶段应如何表达：页面迁移后，工作区不得带 `overflow-x-clip`。

## test/programming-editor-workspace.spec.ts::merges metadata, managed source, visibility, and statement into one content form without sticky overlay
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(shell).to.include('sticky top-2');`
- 意图（一句话）：导航改为贴在 top-2，而不是盖住内容的顶栏叠层。
- 后续阶段应如何表达：页面迁移后，导航带 `sticky top-2`。

## test/programming-editor-workspace.spec.ts::creates a managed shell first and starts structured statement editing only after a stable PID exists
- 源文件：src/pages/problem-edit.tsx
- 删除的断言：`expect(edit).to.match(/\{!isCreate\s*\?\s*\(\s*<div className="p-5">/);`
- 意图（一句话）：题面编辑区只在创建壳之后出现，并带 p-5 内边距；改写后仍断言非创建分支紧接着渲染 div。
- 后续阶段应如何表达：页面迁移后，题面编辑区带 `p-5`。

## test/programming-editor-workspace.spec.ts::makes save errors, unsaved changes, and upload progress observable
- 源文件：src/pages/problem-config-editor.tsx
- 删除的断言：`expect(config).to.include('flex shrink-0 flex-col gap-3 sm:flex-row');`
- 意图（一句话）：配置页保存区在窄屏纵向排列，sm 起改为横向且不被压缩。
- 后续阶段应如何表达：页面迁移后，保存区带 `flex shrink-0 flex-col gap-3 sm:flex-row`。

## test/programming-editor-workspace.spec.ts::makes save errors, unsaved changes, and upload progress observable
- 源文件：src/pages/problem-config-editor.tsx
- 删除的断言：`expect(config).to.include('flex flex-wrap items-center gap-2 sm:ml-auto');`
- 意图（一句话）：保存按钮组可换行，sm 起靠右。
- 后续阶段应如何表达：页面迁移后，保存按钮组带 `flex flex-wrap items-center gap-2 sm:ml-auto`。
