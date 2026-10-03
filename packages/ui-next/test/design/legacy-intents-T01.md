## test/collect-pages.spec.ts::binds edit/stats/list pages to request, canEdit, hasFiles, and prefillSchoolId
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(saveForm).not.to.include('value="delete"');`
- 意图（一句话）：管理端保存表单本身不得提交 value="delete"，原先靠带 space-y-4 的 form className 把范围切出来。
- 后续阶段应如何表达：页面迁移后，管理端保存表单不带 `value="delete"`，并用非类名锚点定位该表单。

## test/collect-pages.spec.ts::binds edit/stats/list pages to request, canEdit, hasFiles, and prefillSchoolId
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(saveForm).not.to.include('value="archive"');`
- 意图（一句话）：管理端保存表单本身不得提交 value="archive"，原先靠带 space-y-4 的 form className 把范围切出来。
- 后续阶段应如何表达：页面迁移后，管理端保存表单不带 `value="archive"`，并用非类名锚点定位该表单。

## test/collect-pages.spec.ts::binds edit/stats/list pages to request, canEdit, hasFiles, and prefillSchoolId
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(saveForm).not.to.include('value="close"');`
- 意图（一句话）：管理端保存表单本身不得提交 value="close"，原先靠带 space-y-4 的 form className 把范围切出来。
- 后续阶段应如何表达：页面迁移后，管理端保存表单不带 `value="close"`，并用非类名锚点定位该表单。

## test/collect-pages.spec.ts::binds edit/stats/list pages to request, canEdit, hasFiles, and prefillSchoolId
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(saveForm).not.to.include('value="reopen"');`
- 意图（一句话）：管理端保存表单本身不得提交 value="reopen"，原先靠带 space-y-4 的 form className 把范围切出来。
- 后续阶段应如何表达：页面迁移后，管理端保存表单不带 `value="reopen"`，并用非类名锚点定位该表单。

## test/collect-pages.spec.ts::binds file-name template, pack layout, assigned names, duplicates, and submitted CSV
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('CardTitle className="text-sm">文件名');`
- 意图（一句话）：文件名设置区的标题必须是 CardTitle 下的「文件名」；text-sm 只是当时的字号。
- 后续阶段应如何表达：页面迁移后，管理端文件名卡片标题 带 `text-sm`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-6 shadow-sm"');`
- 意图（一句话）：学生收集页顶栏在窄屏下换行，并且可以收缩到不把页面撑出视口。
- 后续阶段应如何表达：页面迁移后，学生收集页顶栏 带 `flex min-w-0 flex-wrap items-center justify-between gap-3`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('min-w-0 break-words text-xl font-semibold');`
- 意图（一句话）：收集标题在窄屏下换行，不能单行撑破顶栏。
- 后续阶段应如何表达：页面迁移后，学生收集页标题 带 `min-w-0 break-words`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('flex min-h-10 min-w-0 items-start justify-between gap-2');`
- 意图（一句话）：槽位标题行允许折行，并保持可点的最小高度。
- 后续阶段应如何表达：页面迁移后，学生收集页槽位标题行 带 `min-h-10 min-w-0`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('min-w-0 flex-1 break-words font-semibold line-clamp-2');`
- 意图（一句话）：槽位名称最多两行，并占据标题行里可收缩的空间。
- 后续阶段应如何表达：页面迁移后，学生收集页槽位名称 带 `min-w-0 flex-1 line-clamp-2`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('flex min-w-0 flex-wrap items-start justify-between gap-3');`
- 意图（一句话）：槽位操作行在窄屏下换行，而不是把按钮挤出屏幕。
- 后续阶段应如何表达：页面迁移后，学生收集页槽位操作行 带 `flex min-w-0 flex-wrap`。

## test/collect-pages.spec.ts::wraps student top bar and card titles with min-w-0
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('min-w-0 break-words text-base');`
- 意图（一句话）：槽位说明文字可以换行，不能横向溢出。
- 后续阶段应如何表达：页面迁移后，学生收集页槽位说明 带 `min-w-0 break-words`。

## test/collect-pages.spec.ts::splits slot file rows into a wrapping name block and action block
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(slotFiles).to.include('flex flex-wrap items-start gap-2');`
- 意图（一句话）：已交文件行在窄屏下把文件名和操作分成可换行的两块。
- 后续阶段应如何表达：页面迁移后，学生收集页已交文件行 带 `flex flex-wrap items-start gap-2`。

## test/collect-pages.spec.ts::splits slot file rows into a wrapping name block and action block
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(slotFiles).to.include('min-w-0 flex-1');`
- 意图（一句话）：文件名块占据剩余宽度并允许收缩。
- 后续阶段应如何表达：页面迁移后，学生收集页已交文件名块 带 `min-w-0 flex-1`。

## test/collect-pages.spec.ts::splits slot file rows into a wrapping name block and action block
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(slotFiles).to.include('block break-all font-medium');`
- 意图（一句话）：已交文件名按任意字符断行，长文件名不能撑破行。
- 后续阶段应如何表达：页面迁移后，学生收集页已交文件名 带 `break-all`。

## test/collect-pages.spec.ts::splits slot file rows into a wrapping name block and action block
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(slotFiles).to.include('flex shrink-0 flex-wrap items-center gap-1');`
- 意图（一句话）：文件操作按钮不收缩，空间不够时自己换行。
- 后续阶段应如何表达：页面迁移后，学生收集页已交文件操作 带 `shrink-0 flex-wrap`。

## test/collect-pages.spec.ts::splits slot file rows into a wrapping name block and action block
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(slotFiles).not.to.include('truncate');`
- 意图（一句话）：已交文件名不得用截断代替断行。
- 后续阶段应如何表达：页面迁移后，学生收集页已交文件名 不带 `truncate`。

## test/collect-pages.spec.ts::keeps assignedName break-all and confirm submit at min-h-11
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('block break-all font-medium}>{assignedName}');`
- 意图（一句话）：分配后的文件名必须出现在页面上，并且按任意字符断行。
- 后续阶段应如何表达：页面迁移后，学生收集页分配文件名 带 `break-all`。

## test/collect-pages.spec.ts::keeps assignedName break-all and confirm submit at min-h-11
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('break-all text-xs text-muted-foreground');`
- 意图（一句话）：分配文件名的辅助说明同样断行，不能单行溢出。
- 后续阶段应如何表达：页面迁移后，学生收集页分配文件名说明 带 `break-all`。

## test/collect-pages.spec.ts::keeps assignedName break-all and confirm submit at min-h-11
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student.match(/className="min-h-11"/g) || []).to.have.lengthOf(2);`
- 意图（一句话）：学生收集页恰好有两处 44px 高的主操作，用来保证窄屏可点。
- 后续阶段应如何表达：页面迁移后，学生收集页主操作 带 `min-h-11`。

## test/collect-pages.spec.ts::keeps assignedName break-all and confirm submit at min-h-11
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.match(/className="min-h-11"[\s\S]{0,200}确认提交/);`
- 意图（一句话）：「确认提交」按钮本身必须达到 44px 点击高度。
- 后续阶段应如何表达：页面迁移后，学生收集页确认提交按钮 带 `min-h-11`。

## test/collect-pages.spec.ts::scrolls MiniTabs horizontally instead of clipping labels
- 源文件：src/pages/collect/index.tsx
- 删除的断言：`expect(student).to.include('className="max-w-full overflow-x-auto"');`
- 意图（一句话）：学生收集页页签在窄屏下横向滚动，而不是裁切标签。
- 后续阶段应如何表达：页面迁移后，学生收集页页签 带 `max-w-full overflow-x-auto`。

## test/collect-pages.spec.ts::scrolls MiniTabs horizontally instead of clipping labels
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('className="max-w-full overflow-x-auto"');`
- 意图（一句话）：管理端收集页页签在窄屏下横向滚动，而不是裁切标签。
- 后续阶段应如何表达：页面迁移后，管理端收集页页签 带 `max-w-full overflow-x-auto`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).not.to.include('min-w-[56rem]');`
- 意图（一句话）：管理端文件表不得用 56rem 的最小宽度把 320px 视口撑出横向页面滚动。
- 后续阶段应如何表达：页面迁移后，管理端收集文件表 不带 `min-w-[56rem]`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).not.to.include('className="w-80"');`
- 意图（一句话）：管理端不得用固定 20rem 侧栏宽度挤占窄屏上的操作区。
- 后续阶段应如何表达：页面迁移后，管理端收集页侧栏 不带 `w-80`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('Table className="min-w-0"');`
- 意图（一句话）：文件表必须能收缩到容器宽度以内。
- 后续阶段应如何表达：页面迁移后，管理端收集文件表 带 `min-w-0`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('max-w-[16rem] min-w-0');`
- 意图（一句话）：文件名列有上限宽度，同时允许在更窄的格子里收缩。
- 后续阶段应如何表达：页面迁移后，管理端收集文件名列 带 `max-w-[16rem] min-w-0`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('max-w-[16rem] min-w-0 break-all');`
- 意图（一句话）：超长文件名在列宽内断行，而不是把表格撑开。
- 后续阶段应如何表达：页面迁移后，管理端收集文件名 带 `max-w-[16rem] min-w-0 break-all`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('break-all text-xs');`
- 意图（一句话）：文件名辅助信息按任意字符断行。
- 后续阶段应如何表达：页面迁移后，管理端收集文件名辅助信息 带 `break-all`。

## test/collect-pages.spec.ts::keeps admin file names breakable and operations reachable at 320
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(admin).to.include('TableActions className="flex-wrap"');`
- 意图（一句话）：行内操作在窄屏下换行，仍然点得到。
- 后续阶段应如何表达：页面迁移后，管理端收集行内操作 带 `flex-wrap`。

## test/collect-pages.spec.ts::puts a wrapping sticky pack bar inside stats content
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(stats).to.include('sticky top-0');`
- 意图（一句话）：统计页打包条钉在内容区顶部，滚动时仍然能打包和催交。
- 后续阶段应如何表达：页面迁移后，管理端收集统计打包条 带 `sticky top-0`。

## test/collect-pages.spec.ts::puts a wrapping sticky pack bar inside stats content
- 源文件：src/pages/admin-collect/index.tsx
- 删除的断言：`expect(stats).to.include('flex max-w-full flex-wrap items-center gap-2');`
- 意图（一句话）：打包条按钮在窄屏下换行，并且不超过内容宽度。
- 后续阶段应如何表达：页面迁移后，管理端收集统计打包条 带 `max-w-full flex-wrap`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.match(/<header className="[^"]*\bmin-w-0\b/);`
- 意图（一句话）：应用壳顶栏必须能收缩，320px 视口下不能把域名和按钮挤出屏幕。
- 后续阶段应如何表达：页面迁移后，应用壳顶栏 带 `min-w-0`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.match(/<span className="[^"]*\btruncate\b[^"]*">{bs\.domain\.name}<\/span>/);`
- 意图（一句话）：顶栏里的域名称必须截断，而不是把顶栏撑宽。
- 后续阶段应如何表达：页面迁移后，应用壳顶栏域名 带 `truncate`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.match(/<div className="flex min-w-0 items-center gap-1\.5">/);`
- 意图（一句话）：顶栏右侧用户区横向排列并允许收缩。
- 后续阶段应如何表达：页面迁移后，应用壳顶栏用户区 带 `flex min-w-0 items-center`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('relative hidden size-8 sm:inline-flex');`
- 意图（一句话）：消息入口在手机上隐藏，sm 以上才以 32px 图标按钮出现。
- 后续阶段应如何表达：页面迁移后，应用壳消息入口 带 `hidden size-8 sm:inline-flex`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('hidden size-8 sm:inline-flex');`
- 意图（一句话）：桌面才显示的顶栏图标按钮在手机上隐藏。
- 后续阶段应如何表达：页面迁移后，应用壳桌面顶栏图标按钮 带 `hidden size-8 sm:inline-flex`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('px-3 py-2.5 text-sm hover:bg-accent sm:py-1.5');`
- 意图（一句话）：用户菜单项在手机上有更高的点击区，sm 以上收紧。
- 后续阶段应如何表达：页面迁移后，应用壳用户菜单项 带 `px-3 py-2.5 sm:py-1.5`。

## test/viewport-layout.spec.ts::keeps the app shell header from overflowing a 320px viewport
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 sm:py-1.5');`
- 意图（一句话）：退出菜单项同样在手机上加高点击区。
- 后续阶段应如何表达：页面迁移后，应用壳退出菜单项 带 `px-3 py-2.5 sm:py-1.5`。

## test/viewport-layout.spec.ts::pins the announcement popover to the viewport instead of a 360px absolute box
- 源文件：src/components/announcement-popover.tsx
- 删除的断言：`expect(popover).not.to.include('w-[360px]');`
- 意图（一句话）：公告浮层不得再是脱离视口的固定 360px 宽。
- 后续阶段应如何表达：页面迁移后，公告浮层 不带 `w-[360px]`。

## test/viewport-layout.spec.ts::pins the announcement popover to the viewport instead of a 360px absolute box
- 源文件：src/components/announcement-popover.tsx
- 删除的断言：`expect(popover).not.to.match(/className="absolute right-0 top-full/);`
- 意图（一句话）：公告浮层不得相对触发器绝对定位，否则窄屏会超出视口。
- 后续阶段应如何表达：页面迁移后，公告浮层 不带 `absolute right-0 top-full`。

## test/viewport-layout.spec.ts::pins the announcement popover to the viewport instead of a 360px absolute box
- 源文件：src/components/announcement-popover.tsx
- 删除的断言：`expect(popover).to.include('fixed right-3');`
- 意图（一句话）：公告浮层固定在视口右侧，并留出边距。
- 后续阶段应如何表达：页面迁移后，公告浮层 带 `fixed right-3`。

## test/viewport-layout.spec.ts::pins the announcement popover to the viewport instead of a 360px absolute box
- 源文件：src/components/announcement-popover.tsx
- 删除的断言：`expect(popover).to.include('w-[min(360px,calc(100vw-1.5rem))]');`
- 意图（一句话）：公告浮层宽度取 360px 与视口剩余宽度的较小值。
- 后续阶段应如何表达：页面迁移后，公告浮层 带 `w-[min(360px,calc(100vw-1.5rem))]`。

## test/viewport-layout.spec.ts::pins the announcement popover to the viewport instead of a 360px absolute box
- 源文件：src/components/announcement-popover.tsx
- 删除的断言：`expect(popover).to.include('max-h-[min(28rem,calc(100dvh-4.5rem))]');`
- 意图（一句话）：公告浮层高度不得超过矮屏剩余可视高度。
- 后续阶段应如何表达：页面迁移后，公告浮层 带 `max-h-[min(28rem,calc(100dvh-4.5rem))]`。

## test/viewport-layout.spec.ts::uses a 44px mobile drawer close target and auto scrollbars
- 源文件：src/components/layout/sidebar.tsx
- 删除的断言：`expect(sidebar).to.include('size-8 min-h-11 min-w-11 md:hidden');`
- 意图（一句话）：手机抽屉的关闭按钮可见尺寸可以是 32px，但点击目标至少 44px，并且只在 md 以下出现。
- 后续阶段应如何表达：页面迁移后，手机侧栏关闭按钮 带 `min-h-11 min-w-11 md:hidden`。

## test/viewport-layout.spec.ts::lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding
- 源文件：src/styles.css
- 删除的断言：`expect(css).to.include('overflow: hidden');`
- 意图（一句话）：html/body/#root 锁住滚动，避免 iOS 在页面根上橡皮筋回弹。
- 后续阶段应如何表达：页面迁移后，页面根 带 `overflow: hidden`。

## test/viewport-layout.spec.ts::lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding
- 源文件：src/styles.css
- 删除的断言：`expect(css).not.to.match(/html\s*\{[^}]*overflow-x:\s*hidden/);`
- 意图（一句话）：不得只在 html 上单独写 overflow-x:hidden 来裁切横向溢出。
- 后续阶段应如何表达：页面迁移后，html 不带 `overflow-x: hidden`。

## test/viewport-layout.spec.ts::lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('flex h-full min-h-0 min-w-0 overflow-hidden bg-background');`
- 意图（一句话）：应用壳根填满视口并自己裁切溢出，把滚动交给内部 ScrollArea。
- 后续阶段应如何表达：页面迁移后，应用壳根 带 `h-full min-h-0 min-w-0 overflow-hidden`。

## test/viewport-layout.spec.ts::lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('className="min-h-0 min-w-0 flex-1"');`
- 意图（一句话）：页面滚动区必须是可收缩的 flex 子项，才能形成独立滚动。
- 后续阶段应如何表达：页面迁移后，应用壳页面滚动区 带 `min-h-0 min-w-0 flex-1`。

## test/viewport-layout.spec.ts::lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding
- 源文件：src/router.tsx
- 删除的断言：`expect(router).to.include('pb-[env(safe-area-inset-bottom)]');`
- 意图（一句话）：页面滚动区底部留出 iOS 安全区，内容不被系统条挡住。
- 后续阶段应如何表达：页面迁移后，应用壳页面滚动区 带 `pb-[env(safe-area-inset-bottom)]`。

## test/viewport-layout.spec.ts::uses 16px redeem input text on iOS and wrapping footer beian links
- 源文件：src/components/redeem-dialog.tsx
- 删除的断言：`expect(redeem).to.include('className="text-base md:text-sm"');`
- 意图（一句话）：兑换输入在手机上使用 16px，避免 iOS 聚焦时自动放大。
- 后续阶段应如何表达：页面迁移后，兑换码输入 带 `text-base md:text-sm`。

## test/viewport-layout.spec.ts::uses 16px redeem input text on iOS and wrapping footer beian links
- 源文件：src/components/layout/footer.tsx
- 删除的断言：`expect(footer).to.include('min-w-0 space-y-1 break-words');`
- 意图（一句话）：页脚备案文字在窄屏下换行，不把页脚撑出视口。
- 后续阶段应如何表达：页面迁移后，页脚备案文字 带 `min-w-0 break-words`。

## test/viewport-layout.spec.ts::uses 16px redeem input text on iOS and wrapping footer beian links
- 源文件：src/components/layout/footer.tsx
- 删除的断言：`expect(footer).to.include('inline-flex min-h-11 items-center hover:text-foreground sm:min-h-0');`
- 意图（一句话）：页脚链接在手机上至少 44px 高，sm 以上恢复紧凑高度。
- 后续阶段应如何表达：页面迁移后，页脚链接 带 `min-h-11 sm:min-h-0`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('className="mx-auto w-full max-w-[90rem] space-y-6"');`
- 意图（一句话）：首页是居中的超宽阅读壳，最大约 90rem，而不是无界铺满。
- 后续阶段应如何表达：页面迁移后，学生首页外壳 带 `mx-auto w-full max-w-[90rem]`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('grid min-w-0 gap-6 p-6 lg:grid-cols-[1fr_340px]');`
- 意图（一句话）：首页主栅格在大屏分成可收缩主列和 340px 侧列。
- 后续阶段应如何表达：页面迁移后，学生首页主栅格 带 `min-w-0 lg:grid-cols-[1fr_340px]`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('flex min-w-0 flex-col justify-center gap-4');`
- 意图（一句话）：个人卡片内容纵向排列并允许收缩。
- 后续阶段应如何表达：页面迁移后，学生首页个人卡片 带 `min-w-0 flex-col`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('grid min-w-0 gap-6 lg:grid-cols-[1fr_320px]');`
- 意图（一句话）：首页第二块栅格在大屏分成可收缩主列和 320px 侧列。
- 后续阶段应如何表达：页面迁移后，学生首页次级栅格 带 `min-w-0 lg:grid-cols-[1fr_320px]`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('<div className="min-w-0 space-y-6">');`
- 意图（一句话）：首页主列必须能收缩，避免 1fr 列被内容撑出视口。
- 后续阶段应如何表达：页面迁移后，学生首页主列 带 `min-w-0`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('<motion.a href={href} className="min-w-0"');`
- 意图（一句话）：首页入口链接本身可收缩，长标题不能撑开栅格。
- 后续阶段应如何表达：页面迁移后，学生首页入口链接 带 `min-w-0`。

## test/home-training-progress.spec.ts::keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('className="group min-w-0 rounded-lg border p-3 transition-colors hover:bg-accent/50"');`
- 意图（一句话）：首页卡片可收缩，并在悬停时用中性底色反馈。
- 后续阶段应如何表达：页面迁移后，学生首页卡片 带 `min-w-0 rounded-lg border`。

## test/home-training-progress.spec.ts::lets the search form wrap at 320px without clipping the submit control
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('className="flex min-w-0 flex-wrap gap-2"');`
- 意图（一句话）：首页搜索行在 320px 下换行，输入框和按钮都留在视口里。
- 后续阶段应如何表达：页面迁移后，学生首页搜索行 带 `flex min-w-0 flex-wrap`。

## test/home-training-progress.spec.ts::lets the search form wrap at 320px without clipping the submit control
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('className="relative min-w-0 flex-1"');`
- 意图（一句话）：搜索输入占据剩余宽度并允许收缩。
- 后续阶段应如何表达：页面迁移后，学生首页搜索输入槽 带 `min-w-0 flex-1`。

## test/home-training-progress.spec.ts::lets the search form wrap at 320px without clipping the submit control
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('className="min-w-0 pl-8 text-base sm:text-sm"');`
- 意图（一句话）：搜索框在手机上使用 16px，避免 iOS 聚焦放大，同时可以收缩。
- 后续阶段应如何表达：页面迁移后，学生首页搜索输入 带 `min-w-0 text-base sm:text-sm`。

## test/home-training-progress.spec.ts::lets the search form wrap at 320px without clipping the submit control
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home).to.include('size="sm" className="shrink-0"');`
- 意图（一句话）：搜索提交按钮不随输入框一起被压扁。
- 后续阶段应如何表达：页面迁移后，学生首页搜索提交按钮 带 `shrink-0`。

## test/home-training-progress.spec.ts::truncates search, starred, and recent titles outside trailing icons
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(home.split('className="min-w-0 flex-1 truncate"').length - 1).to.equal(3);`
- 意图（一句话）：搜索、收藏和最近题目的标题各有一处可收缩截断，截断发生在尾部图标之外。
- 后续阶段应如何表达：页面迁移后，学生首页题目标题 带 `min-w-0 flex-1 truncate`。

## test/home-training-progress.spec.ts::keeps the hidden contest badge outside the truncated title
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(contests).to.include('className="min-w-0 flex-1 truncate text-sm font-medium">{c.title || '未命名比赛'}');`
- 意图（一句话）：比赛标题单独截断，隐藏标记不能被截进标题字符串里。
- 后续阶段应如何表达：页面迁移后，学生首页比赛标题 带 `min-w-0 flex-1 truncate`。

## test/home-training-progress.spec.ts::keeps the hidden contest badge outside the truncated title
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(contests).not.to.match(/truncate text-sm font-medium">\s*\{c\.title \|\| '未命名比赛'\}\s*\{c\.hidden === true/);`
- 意图（一句话）：「已隐藏」不得紧跟在被截断的标题文本节点后面。
- 后续阶段应如何表达：页面迁移后，学生首页比赛标题 不带 `truncate`。

## test/home-training-progress.spec.ts::keeps the hidden contest badge outside the truncated title
- 源文件：src/pages/home.tsx
- 删除的断言：`expect(contests).to.include('className="shrink-0 text-[10px]"');`
- 意图（一句话）：隐藏标记固定在标题外侧，不参与标题截断。
- 后续阶段应如何表达：页面迁移后，学生首页比赛隐藏标记 带 `shrink-0`。

## test/home-training-progress.spec.ts::truncates announcement categories on a min-height row
- 源文件：src/components/announcement-home-block.tsx
- 删除的断言：`expect(announce).to.include('flex min-h-11 min-w-0 items-center gap-3');`
- 意图（一句话）：首页公告行至少 44px 高，并且整行可收缩。
- 后续阶段应如何表达：页面迁移后，首页公告行 带 `min-h-11 min-w-0`。

## test/home-training-progress.spec.ts::truncates announcement categories on a min-height row
- 源文件：src/components/announcement-home-block.tsx
- 删除的断言：`expect(announce).to.include('max-w-[6rem] min-w-0 shrink-0 truncate');`
- 意图（一句话）：公告分类名限制在约 6rem 内截断，不挤压标题。
- 后续阶段应如何表达：页面迁移后，首页公告分类 带 `max-w-[6rem] min-w-0 shrink-0 truncate`。

## test/home-training-progress.spec.ts::truncates announcement categories on a min-height row
- 源文件：src/components/announcement-home-block.tsx
- 删除的断言：`expect(announce).to.include('min-w-0 flex-1 truncate text-sm font-medium');`
- 意图（一句话）：公告标题占据剩余宽度并截断。
- 后续阶段应如何表达：页面迁移后，首页公告标题 带 `min-w-0 flex-1 truncate`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/index.tsx
- 删除的断言：`expect(publicPage).not.to.include('min-h-[34rem]');`
- 意图（一句话）：公开导图不得再用固定 34rem 最小高度，矮屏必须跟着动态视口走。
- 后续阶段应如何表达：页面迁移后，公开知识导图工作区 不带 `min-h-[34rem]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/index.tsx
- 删除的断言：`expect(publicPage).not.to.include('top-[42%]');`
- 意图（一句话）：公开导图不得用 top 42% 把画布锚在一个会溢出矮屏的位置。
- 后续阶段应如何表达：页面迁移后，公开知识导图画布 不带 `top-[42%]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/index.tsx
- 删除的断言：`expect(publicWorkspaceMatch, 'mindmap public workspace root').not.to.equal(null);`
- 意图（一句话）：公开导图在 ReactFlowProvider 下有一个静态 className 的工作区根。
- 后续阶段应如何表达：页面迁移后，公开知识导图工作区根 带 `flex w-full min-w-0 overflow-hidden`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/index.tsx
- 删除的断言：`expect(publicWorkspaceClasses).to.include.members(['flex', 'w-full', 'min-w-0', 'overflow-hidden', 'h-[calc(100dvh-4.5rem)]', 'min-h-[min(34rem,calc(100dvh-4.5rem))]', 'sm:h-[calc(100dvh-6rem)]', 'sm:min-h-[min(34rem,calc(100dvh-6rem))]', 'xl:h-[calc(100dvh-7rem)]', 'xl:min-h-[min(34rem,calc(100dvh-7rem))]']);`
- 意图（一句话）：公开导图工作区按断点填满扣除顶栏后的动态视口，并保持可收缩。
- 后续阶段应如何表达：页面迁移后，公开知识导图工作区 带 `h-[calc(100dvh-4.5rem)] min-h-[min(34rem,calc(100dvh-4.5rem))]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceMatch, 'mindmap admin workspace root').not.to.equal(null);`
- 意图（一句话）：管理导图在 ReactFlowProvider 下有一个静态 className 的工作区根。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区根 带 `flex w-full min-w-0 flex-col`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses.some((value) => utilityName(value).startsWith('rounded'))).to.equal(false);`
- 意图（一句话）：管理导图工作区根不是卡片，不得带圆角。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区根 不带 `rounded`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses.some((value) => utilityName(value).startsWith('border'))).to.equal(false);`
- 意图（一句话）：管理导图工作区根不得带边框。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区根 不带 `border`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses.some((value) => utilityName(value).startsWith('shadow'))).to.equal(false);`
- 意图（一句话）：管理导图工作区根不得带阴影。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区根 不带 `shadow`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses).to.include.members(['flex', 'w-full', 'min-w-0', 'flex-col', 'h-[calc(100dvh-4.5rem)]', 'min-h-[min(42rem,calc(100dvh-4.5rem))]', 'sm:h-[calc(100dvh-6rem)]', 'sm:min-h-[min(42rem,calc(100dvh-6rem))]', 'xl:h-[calc(100dvh-7rem)]', 'xl:min-h-[min(42rem,calc(100dvh-7rem))]', 'xl:overflow-hidden']);`
- 意图（一句话）：管理导图工作区纵向撑满扣除顶栏后的动态视口，xl 才裁切溢出。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区 带 `flex-col h-[calc(100dvh-4.5rem)] xl:overflow-hidden`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses).not.to.include('overflow-hidden');`
- 意图（一句话）：管理导图工作区根在小于 xl 时不得无条件 overflow-hidden，否则手机面板无法滚动。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区根 不带 `overflow-hidden`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(workspaceClasses).not.to.include('min-h-[42rem]');`
- 意图（一句话）：管理导图不得使用不随视口缩小的 42rem 最小高度。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区 不带 `min-h-[42rem]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).not.to.include('min-h-[42rem]');`
- 意图（一句话）：管理导图页面任何地方都不得写死 42rem 最小高度。
- 后续阶段应如何表达：页面迁移后，管理知识导图页 不带 `min-h-[42rem]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).not.to.include('md:grid-cols-3');`
- 意图（一句话）：管理导图不得在 md 就切成三列，三列只属于更宽的断点。
- 后续阶段应如何表达：页面迁移后，管理知识导图页 不带 `md:grid-cols-3`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.match(new RegExp('data-mindmap-panel="${panel}"[\\s\\S]*?rounded-[^\\s'"]+[\\s\\S]*?bg-card[\\s\\S]*?shadow-sm'));`
- 意图（一句话）：大纲、预览、检查器三个面板都是带圆角、卡片底和轻阴影的卡片。
- 后续阶段应如何表达：页面迁移后，管理知识导图面板 带 `rounded bg-card shadow-sm`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.include('sticky top-0');`
- 意图（一句话）：窄屏下面板切换条钉在工作区顶部。
- 后续阶段应如何表达：页面迁移后，管理知识导图面板切换条 带 `sticky top-0`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.include('xl:hidden');`
- 意图（一句话）：移动面板切换只在小于 xl 时出现。
- 后续阶段应如何表达：页面迁移后，管理知识导图移动切换条 带 `xl:hidden`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.include("'hidden xl:flex xl:flex-col'");`
- 意图（一句话）：侧栏面板在小于 xl 时隐藏，xl 以上才纵向展开。
- 后续阶段应如何表达：页面迁移后，管理知识导图侧栏面板 带 `hidden xl:flex xl:flex-col`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.include('xl:grid-cols-');`
- 意图（一句话）：三栏工作区只在 xl 及以上变成多列网格。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区 带 `xl:grid-cols-`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).not.to.match(/\blg:(?:grid|flex|hidden)/);`
- 意图（一句话）：布局切换不得发生在 lg，避免 1024px 到 xl 之间提前变成桌面三栏。
- 后续阶段应如何表达：页面迁移后，管理知识导图工作区 不带 `lg:grid lg:flex lg:hidden`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/outline.tsx
- 删除的断言：`expect(outline).to.include('flex h-full min-h-0 flex-col');`
- 意图（一句话）：大纲列填满所在栏，并形成自己的纵向滚动上下文。
- 后续阶段应如何表达：页面迁移后，知识导图大纲 带 `h-full min-h-0 flex-col`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/inspector.tsx
- 删除的断言：`expect(inspector.match(/h-full min-h-0/g) || []).to.have.lengthOf.at.least(2);`
- 意图（一句话）：检查器至少两层填满父级并可收缩，内部才能独立滚动。
- 后续阶段应如何表达：页面迁移后，知识导图检查器 带 `h-full min-h-0`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/inspector.tsx
- 删除的断言：`expect(inspector).not.to.include('absolute inset-x-0 top-[calc(100%+4px)]');`
- 意图（一句话）：题目搜索结果不得再绝对定位到输入框下方，以免被工作区裁切。
- 后续阶段应如何表达：页面迁移后，知识导图题目搜索结果 不带 `absolute inset-x-0 top-[calc(100%+4px)]`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(adminPage).to.match(/sticky top-0[\s\S]*?<MiniTabs[\s\S]*?className="h-11"/);`
- 意图（一句话）：钉住的移动切换条里的 MiniTabs 高 44px。
- 后续阶段应如何表达：页面迁移后，管理知识导图 MiniTabs 带 `h-11`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/canvas.tsx
- 删除的断言：`expect(canvas).to.match(/className="[^"]*size-10[^"]*"[\s\S]*?aria-label=\{data\.collapsed/);`
- 意图（一句话）：展开或收起子节点的按钮点击目标为 40px。
- 后续阶段应如何表达：页面迁移后，知识导图节点折叠按钮 带 `size-10`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(createDialog).to.include('className="mt-1.5 h-10"');`
- 意图（一句话）：新建节点对话框里的控件高 40px，和对话框内边距对齐。
- 后续阶段应如何表达：页面迁移后，新建节点对话框控件 带 `h-10`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(createDialog).to.include('contentClassName="[&_[role=option]]:min-h-10"');`
- 意图（一句话）：新建节点对话框的选项至少 40px 高，方便点选。
- 后续阶段应如何表达：页面迁移后，新建节点对话框选项 带 `min-h-10`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(createDialog.match(/className="min-h-10"/g) || []).to.have.lengthOf(2);`
- 意图（一句话）：新建节点对话框恰好两处主按钮至少 40px 高。
- 后续阶段应如何表达：页面迁移后，新建节点对话框按钮 带 `min-h-10`。

## test/mindmap-workspace.spec.ts::keeps the public page read-only and registers a separate administrator template
- 源文件：src/pages/mindmap/admin.tsx
- 删除的断言：`expect(deleteDialog.match(/className="min-h-10"/g) || []).to.have.lengthOf(2);`
- 意图（一句话）：删除节点对话框恰好两处主按钮至少 40px 高。
- 后续阶段应如何表达：页面迁移后，删除节点对话框按钮 带 `min-h-10`。

## test/collect-home-block.spec.ts::enlarges 去交文件 without making the pending row a link
- 源文件：src/components/collect-home-block.tsx
- 删除的断言：`expect(row).to.include('inline-flex min-h-11 shrink-0 items-center px-2');`
- 意图（一句话）：首页「去交文件」是行内的 44px 高链接，整行本身不是链接。
- 后续阶段应如何表达：页面迁移后，首页待交「去交文件」 带 `inline-flex min-h-11 shrink-0`。

## test/collect-home-block.spec.ts::enlarges 去交文件 without making the pending row a link
- 源文件：src/components/collect-home-block.tsx
- 删除的断言：`expect(row).to.include('<p className="truncate text-sm font-medium">{doc.title}</p>');`
- 意图（一句话）：待交标题在段落里截断，标题本身不承担链接。
- 后续阶段应如何表达：页面迁移后，首页待交标题 带 `truncate`。

## test/collect-home-block.spec.ts::links pending items to ordinary /collect routes
- 源文件：src/components/collect-home-block.tsx
- 删除的断言：`expect(screen.getByRole('link', { name: '去交文件' }).className).to.match(/(?:^|\s)min-h-11(?:\s|$)/);`
- 意图（一句话）：渲染出来的「去交文件」链接至少 44px 高。
- 后续阶段应如何表达：页面迁移后，首页待交「去交文件」链接 带 `min-h-11`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static main root class').not.to.equal(null);`
- 意图（一句话）：list.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，list.tsx 的 main 根 带 `w-full min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：list.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，list.tsx 的 main 根 带 `w-full`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(classes).to.include('min-w-0');`
- 意图（一句话）：list.tsx 的根可以收缩，网格子项不会被内容撑出壳。
- 后续阶段应如何表达：页面迁移后，list.tsx 的 main 根 带 `min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：list.tsx 的根不再自己水平居中，宽度由应用壳决定。
- 后续阶段应如何表达：页面迁移后，list.tsx 的 main 根 不带 `mx-auto`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：list.tsx 的根不再设置 max-w，避免在应用壳里再缩一圈。
- 后续阶段应如何表达：页面迁移后，list.tsx 的 main 根 不带 `max-w-`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static main root class').not.to.equal(null);`
- 意图（一句话）：detail.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，detail.tsx 的 main 根 带 `w-full min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：detail.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，detail.tsx 的 main 根 带 `w-full`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(classes).to.include('min-w-0');`
- 意图（一句话）：detail.tsx 的根可以收缩，网格子项不会被内容撑出壳。
- 后续阶段应如何表达：页面迁移后，detail.tsx 的 main 根 带 `min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：detail.tsx 的根不再自己水平居中，宽度由应用壳决定。
- 后续阶段应如何表达：页面迁移后，detail.tsx 的 main 根 不带 `mx-auto`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：detail.tsx 的根不再设置 max-w，避免在应用壳里再缩一圈。
- 后续阶段应如何表达：页面迁移后，detail.tsx 的 main 根 不带 `max-w-`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static main root class').not.to.equal(null);`
- 意图（一句话）：editor.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，editor.tsx 的 main 根 带 `w-full min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：editor.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，editor.tsx 的 main 根 带 `w-full`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(classes).to.include('min-w-0');`
- 意图（一句话）：editor.tsx 的根可以收缩，网格子项不会被内容撑出壳。
- 后续阶段应如何表达：页面迁移后，editor.tsx 的 main 根 带 `min-w-0`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：editor.tsx 的根不再自己水平居中，宽度由应用壳决定。
- 后续阶段应如何表达：页面迁移后，editor.tsx 的 main 根 不带 `mx-auto`。

## test/course-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：editor.tsx 的根不再设置 max-w，避免在应用壳里再缩一圈。
- 后续阶段应如何表达：页面迁移后，editor.tsx 的 main 根 不带 `max-w-`。

## test/course-workspace.spec.ts::keeps list, detail, and editor in focused files with explicit extension slots
- 源文件：src/pages/course/list.tsx
- 删除的断言：`expect(list).not.to.include('max-w-[76rem]');`
- 意图（一句话）：课程列表不再用 76rem 的最大宽度把页面收成一条居中阅读栏。
- 后续阶段应如何表达：页面迁移后，课程列表 不带 `max-w-[76rem]`。

## test/course-workspace.spec.ts::keeps list, detail, and editor in focused files with explicit extension slots
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(detail).not.to.include('max-w-[76rem]');`
- 意图（一句话）：课程详情不再用 76rem 的最大宽度限制工作区。
- 后续阶段应如何表达：页面迁移后，课程详情 不带 `max-w-[76rem]`。

## test/course-workspace.spec.ts::keeps list, detail, and editor in focused files with explicit extension slots
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(editor).not.to.include('col-span-full');`
- 意图（一句话）：课程简介不再横跨整行沉到页面底部。
- 后续阶段应如何表达：页面迁移后，课程编辑器简介 不带 `col-span-full`。

## test/course-workspace.spec.ts::keeps list, detail, and editor in focused files with explicit extension slots
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(editor).to.match(/<section className="min-w-0 space-y-5"[\s\S]*course-description-title[\s\S]*章节内容/);`
- 意图（一句话）：课程简介和章节内容放在同一块可收缩的编辑区里。
- 后续阶段应如何表达：页面迁移后，课程编辑区 带 `min-w-0 space-y-5`。

## test/course-workspace.spec.ts::uses server capabilities, true totals, enrollment status, and one active chapter
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(detail).to.include('grid min-w-0 w-full gap-6');`
- 意图（一句话）：课程详情主体是可收缩的全宽网格。
- 后续阶段应如何表达：页面迁移后，课程详情主体 带 `grid min-w-0 w-full`。

## test/course-workspace.spec.ts::binds one public mindmap and keeps ordinary chapter requests lazy
- 源文件：src/pages/course/video-stats.tsx
- 删除的断言：`expect(videoStats).not.to.include('min-w-[48rem]');`
- 意图（一句话）：观看名单不得用 48rem 最小宽度把窄屏表格撑出页面。
- 后续阶段应如何表达：页面迁移后，课程观看名单 不带 `min-w-[48rem]`。

## test/course-workspace.spec.ts::keeps mobile outline drawers on shared Sheet with the same titles
- 源文件：src/pages/course/detail.tsx
- 删除的断言：`expect(detail).not.to.match(/<SheetContent[^>]*overflow-y-auto/);`
- 意图（一句话）：课程目录抽屉的滚动交给 SheetBody，SheetContent 自己不再纵向滚动。
- 后续阶段应如何表达：页面迁移后，课程详情目录 SheetContent 不带 `overflow-y-auto`。

## test/course-workspace.spec.ts::keeps mobile outline drawers on shared Sheet with the same titles
- 源文件：src/pages/course/editor.tsx
- 删除的断言：`expect(editor).not.to.match(/<SheetContent[^>]*overflow-y-auto/);`
- 意图（一句话）：章节目录抽屉的滚动交给 SheetBody，SheetContent 自己不再纵向滚动。
- 后续阶段应如何表达：页面迁移后，课程编辑器目录 SheetContent 不带 `overflow-y-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problems.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：problems.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，problems.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problems.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：problems.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，problems.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problems.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：problems.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，problems.tsx 的 main 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problems.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：problems.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，problems.tsx 的 main 根 不带 `max-w-`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problem-create-hub.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：problem-create-hub.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，problem-create-hub.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problem-create-hub.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：problem-create-hub.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，problem-create-hub.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problem-create-hub.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：problem-create-hub.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，problem-create-hub.tsx 的 main 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/problem-create-hub.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：problem-create-hub.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，problem-create-hub.tsx 的 main 根 不带 `max-w-`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：problem-editor-workspace.tsx 的 section 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，problem-editor-workspace.tsx 的 section 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：problem-editor-workspace.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，problem-editor-workspace.tsx 的 section 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：problem-editor-workspace.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，problem-editor-workspace.tsx 的 section 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/components/problem-editor-workspace.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：problem-editor-workspace.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，problem-editor-workspace.tsx 的 section 根 不带 `max-w-`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/basic-objective-editors.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：basic-objective-editors.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，basic-objective-editors.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/basic-objective-editors.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：basic-objective-editors.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，basic-objective-editors.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/basic-objective-editors.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：basic-objective-editors.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，basic-objective-editors.tsx 的 main 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/basic-objective-editors.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：basic-objective-editors.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，basic-objective-editors.tsx 的 main 根 不带 `max-w-`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/subjective-editor.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：subjective-editor.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，subjective-editor.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/subjective-editor.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：subjective-editor.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，subjective-editor.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/subjective-editor.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：subjective-editor.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，subjective-editor.tsx 的 main 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/subjective-editor.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：subjective-editor.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，subjective-editor.tsx 的 main 根 不带 `max-w-`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(match, '${relativePath} should expose a static ${tag} root class').not.to.equal(null);`
- 意图（一句话）：structured-code-editors.tsx 的 main 根有一段静态 className，用来铺满应用壳内容区。
- 后续阶段应如何表达：页面迁移后，structured-code-editors.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(classes).to.include('w-full');`
- 意图（一句话）：structured-code-editors.tsx 的根占满应用壳给出的内容宽度。
- 后续阶段应如何表达：页面迁移后，structured-code-editors.tsx 的 main 根 带 `w-full`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);`
- 意图（一句话）：structured-code-editors.tsx 的根不再自己水平居中。
- 后续阶段应如何表达：页面迁移后，structured-code-editors.tsx 的 main 根 不带 `mx-auto`。

## test/problem-full-width-layout.spec.ts::${label} fills the shared AppShell content width
- 源文件：src/pages/structured-code-editors.tsx
- 删除的断言：`expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);`
- 意图（一句话）：structured-code-editors.tsx 的根不再设置 max-w。
- 后续阶段应如何表达：页面迁移后，structured-code-editors.tsx 的 main 根 不带 `max-w-`。
