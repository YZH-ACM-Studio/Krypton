# 客户端强制比赛与反作弊集成设计

> 状态：设计已确认，等待实现
> 目的：记录本轮关于 OJ 比赛、ui-next 比赛编辑、Krypton UserBind、Vigil 反作弊系统之间集成的完整决策，避免实现时语义漂移。

本文只描述产品与工程语义，不包含实现代码。

## 1. 背景

Krypton 当前已经具备几块基础能力：

- HydroOJ 原有比赛模型、比赛编辑 handler、提交与记录链路。
- ui-next 已覆盖大量页面，但比赛编辑页仍未完整覆盖老 UI 的全部配置，也缺少 Krypton/Vigil 的比赛级配置。
- krypton-userbind 已有学校、用户组、学生档案、绑定、申请、临时账号认领等模型。
- Vigil 已有 Qt Client 登录请求、Vigil Server 审批、OJ lookup-student、临时账号、webview session 启动等链路雏形。

本轮目标是把这些能力收拢成一个一致的“客户端强制比赛”体系：

- 所有比赛赛制都可以启用客户端强制进入，不只限于试卷型 exam 赛制。
- 线下 XCPC/ACM 测试赛也可以使用 Qt Client、Vigil 审批、截图和锁屏。
- 客户端进入后使用一个纯比赛工作台 UI，不暴露普通 OJ 全站导航和无关功能。
- 普通网页登录与已有普通 session 在管控窗口内会被限制，防止学生绕过客户端。
- 学校/用户组参赛范围来自 krypton-userbind，并与老 Hydro 访问控制兼容。

## 2. 设计目标

1. 完整补齐 ui-next 比赛编辑页。
   该页面需要支持老 UI 已有的全部比赛配置，包括赛制、标题、时间、题目、说明、维护者、公开/邀请码/旧 assign、语言限制、Rating、自动隐藏、代码可见、打印、封榜、弹性时长、榜单隐藏等。

2. 在比赛编辑页加入 Krypton/Vigil 配置。
   包括是否接入 Vigil、是否强制客户端、审批模式、锁屏、截图间隔、断线策略、客户端工作台独占、登录封锁窗口、学校/用户组参赛范围。

3. 让客户端强制进入适用于所有比赛赛制。
   例如 rule 为 acm 的 XCPC 测试赛也可以强制通过 Qt Client 进入，但仍保留 ACM 赛制的提交、榜单、罚时、澄清等行为。

4. 将 /exam-mode/:tid 从“试卷页面”升级为“客户端比赛工作台”。
   对 exam 赛制显示试卷/答题卡；对 acm、oi、ioi 等赛制显示比赛必要功能。

5. 登录封锁只影响命中该比赛参赛范围的学生。
   不能因为一场线下考试把全站其他学生、访客、老师、管理员锁在外面。

6. 保留临时账号应急流程。
   未绑定或未知学生可以进入老师审批队列，老师可创建临时账号放行，赛后由真实账号认领。

7. 不重写 judge、record、submit 核心链路。
   工作台复用现有提交与记录模型，后端增加统一访问控制，避免 UI 绕过。

## 3. 非目标

本轮不做以下事项：

- 不重写 HydroOJ 的判题、提交、记录存储逻辑。
- 不做机器级、考场级的反作弊策略覆盖。V1 只做比赛级策略。
- 不做每个 OJ 请求实时回查 Vigil 的强机器证明。
- 不把临时账号永久加入学校或用户组。
- 不删除或替代老 Hydro 的公开、邀请码、assign 访问控制。
- 不迁移 /exam-mode URL。URL 暂时保留，产品语义改成客户端比赛工作台。

## 4. 核心术语

客户端比赛工作台：
学生从 Qt Client 进入 OJ 后看到的纯比赛界面。内部 URL 暂时仍使用 /exam-mode/:tid。它不显示普通 OJ 的全站侧边栏、主页、训练、讨论总入口等无关功能。

普通 session：
用户通过浏览器网页登录得到的 OJ session。该 session 没有 Vigil 会话字段，不能证明来自 Qt Client。

客户端 session：
通过 Vigil 审批或自动通过后，由 /vigil-launch 创建的 OJ session。该 session 绑定到一个具体比赛，并携带 Vigil 会话信息。

管控窗口：
某场 client_required 比赛禁止普通网页登录/访问的时间范围。默认从比赛开始前 60 分钟到比赛结束后 30 分钟。比赛编辑表单允许覆盖这两个分钟数。

eligible 比赛：
对某个学生而言，在指定时间语义下可被客户端选择或可触发网页登录封锁的比赛。eligible 需要同时满足老 Hydro 访问控制、Krypton 参赛范围、Vigil/客户端设置、时间窗口等规则。

临时账号：
老师在 Vigil 审批中为现场异常学生创建的临时 OJ 用户。它用于完成本场比赛，赛后由真实学生账号发起认领，将临时账号记录迁移到真实账号。

## 5. 比赛字段语义

### 5.1 客户端与反作弊字段

比赛文档需要表达以下概念：

- vigilEnabled：该比赛是否接入 Vigil。
- entryMode：进入模式。open 表示普通网页登录可进入；client_required 表示必须通过 Qt Client。
- approvalMode：审批模式。auto 表示正常已绑定且命中范围的学生自动通过；strict 表示即使正常学生也需要老师审批。
- lockdownMode：客户端进入后是否启用锁屏/热键限制。
- screenshotIntervalMs：截图采集间隔。
- pauseOnDisconnect：断线时是否暂停或进入特殊处理。V1 只作为比赛级策略下发，不扩展复杂计时逻辑。
- exclusive：保留现有字段名，用作客户端工作台独占配置。产品文案称为“锁定当前比赛工作台”。
- clientLoginBlockBeforeMinutes：普通网页登录封锁提前分钟数，默认 60。
- clientLoginBlockAfterMinutes：普通网页登录封锁延后分钟数，默认 30。

entryMode 和 vigilEnabled 的关系：

- entryMode 为 open 时，vigilEnabled 可以为 false，也可以为 true。
- entryMode 为 client_required 时，vigilEnabled 必须为 true。
- open + vigilEnabled false 是普通比赛。
- open + vigilEnabled true 是可选客户端监考比赛。
- client_required + vigilEnabled true 是强制客户端比赛。

approvalMode 的安全边界：

- auto 只对已绑定、命中参赛范围、命中旧 Hydro 访问控制的学生自动通过。
- strict 对正常学生也进入老师审批。
- 未绑定、未知、不在范围的学生永远不能 auto。
- 临时账号永远来自人工审批，不属于 auto。

### 5.2 参赛范围字段

Krypton 参赛范围独立于旧 Hydro assign，不复用旧 assign 字段。

参赛范围用互斥模式表达：

- participantScopeMode 为 none：不按 krypton-userbind 学校/用户组限制。
- participantScopeMode 为 schools：按学校限制，可选择多个学校。
- participantScopeMode 为 groups：按用户组限制，可选择多个用户组。

对应列表：

- participantSchoolIds：学校模式下读取，可多选。
- participantGroupIds：用户组模式下读取，可多选。

学校和用户组互斥：

- 表单必须让老师在“不限 / 按学校 / 按用户组”之间选择一种。
- 选择学校模式时，用户组列表应清空或被后端忽略。
- 选择用户组模式时，学校列表应清空或被后端忽略。
- 用户组本身已有所属学校，不需要同时选择学校作为父筛选。

## 6. 访问控制模型

### 6.1 老 Hydro 控制与 Krypton 范围的关系

当 participantScopeMode 不是 none 时，最终访问条件是：

老 Hydro 访问控制通过，并且 Krypton 学校/用户组范围通过。

含义：

- 公开比赛 + 学校 A：学校 A 的绑定学生可以参加。
- 邀请码比赛 + 学校 A：学校 A 的绑定学生仍需要邀请码。
- 旧 assign + 用户组 X：必须同时满足旧 assign 与 Krypton 用户组 X。
- participantScopeMode 为 none：完全回退老 Hydro 访问语义。

这样设计可以兼容旧功能，避免把 Krypton 学校/用户组当作邀请码或旧 assign 的替代品。

### 6.2 范围校验作用面

Krypton 参赛范围不只控制页面可见性，还必须作用于：

- 比赛详情与比赛工作台访问。
- attend 参加比赛。
- 题目详情。
- 提交。
- 草稿、试卷、finalize。
- 比赛附件、打印、澄清等需要参赛身份的功能。

如果用户已 attend，之后老师修改范围把该用户移出：

- 不自动删除已有 tsdoc。
- 新请求按新范围拦截。
- 管理员、比赛 owner、maintainer 可绕过用于排障。

### 6.3 未绑定学生

普通网页中，未绑定学生遇到 participantScopeMode 非 none 的比赛时：

- 不能直接参赛。
- 页面应提示“该比赛限定学校/用户组参赛，请先绑定学生身份”。
- 提供绑定入口和认领入口。

客户端中，未绑定或未知学生：

- 进入 Vigil 审批队列。
- 老师可以拒绝。
- 老师也可以创建临时账号放行。
- 临时账号放行必须记录审计信息。

## 7. 普通网页登录封锁

### 7.1 生效对象

普通网页登录封锁只对命中该比赛参赛范围的学生生效。

不会封锁：

- 管理员。
- 比赛 owner。
- 比赛 maintainer。
- 系统/评测相关特权用户。
- 不在该比赛参赛范围内的其他学生。
- 普通访客，除非他们尝试访问受限比赛功能。

未绑定用户如果没有可判定的学生身份，不会因为某场学校/用户组限定比赛触发全站封锁；但访问该比赛时会被参赛范围拦截。

### 7.2 时间窗口

每场 client_required 比赛都有普通网页登录封锁窗口。

默认：

- 开始前 60 分钟开始封锁。
- 结束后 30 分钟解除封锁。

表单允许覆盖这两个值。

多个比赛窗口对同一学生取并集：

- 只计算该学生实际 eligible 的 client_required 比赛。
- 窗口重叠时自然合并。
- 中间没有覆盖的时间段不封锁。
- 说明页展示当前触发封锁的比赛和预计解除时间。

### 7.3 已有普通 session

已有普通网页登录 session 不做批量删除，而是在请求时懒惰失效。

命中封锁窗口时：

- 如果当前 session 不是客户端 session，则清掉当前 sid 或降为 guest。
- 重定向到客户端强制说明页。
- 不调用按用户删除所有 session 的操作，以免误杀合法客户端 session。

保留白名单：

- 登录页，用于展示说明。
- 退出登录。
- 绑定学生身份相关页面。
- 临时账号认领相关页面。
- 客户端强制说明页。
- 静态资源。

其他登录态页面应被封锁，包括首页个人态、题库、比赛、提交、讨论、训练、用户中心等。

## 8. 客户端 session 语义

### 8.1 单比赛绑定

所有 Vigil 创建的客户端 session 都绑定到一个具体比赛。

客户端 session 必须记录：

- Vigil 会话 ID。
- OJ 比赛 ID。
- 机器 ID。
- 是否临时账号。
- 是否范围覆盖。
- 创建时间。

访问 client_required 比赛时，客户端 session 必须匹配当前比赛。

如果学生从客户端进入 A 比赛后访问 B 比赛：

- 如果 B 也需要客户端或接入 Vigil，应重新选择 B 并创建新的 Vigil 会话。
- A 的客户端 session 不能直接复用为 B 的有效凭证。

### 8.2 机器绑定边界

V1 做轻量机器记录与审计，不做每请求强机器证明。

原因：

- OJ 请求路径不应依赖 Vigil 每次实时可用。
- Qt WebView 的普通表单和页面跳转难以稳定携带额外机器证明 header。
- 防复制 cookie 的强方案会显著增加复杂度。

V1 要求：

- Vigil access token 验证结果返回 machineId。
- OJ session 写入 machineId。
- 日志与 Oplog 记录 session、machine、contest、user 的关系。
- 是否仍在线、是否异常切换机器，由 Vigil 事件与 dashboard 处理。

## 9. 临时账号与人工覆盖

老师在 Vigil 审批中可以为未绑定、未知、或不在范围内的学生创建临时账号并放行。

临时账号人工审批可以覆盖参赛范围，但必须留下审计痕迹：

- 是否临时用户。
- 原始学号输入。
- 原始姓名输入。
- 审批老师 UID。
- 目标比赛 ID。
- 审批时间。
- 覆盖原因或备注。

临时账号不写入永久学校/用户组身份：

- 不加入 parentSchoolId。
- 不加入 parentUserGroupId。
- 不污染 userbind 学生档案。

范围覆盖只存在于该 Vigil/OJ session 内，并且只对当前比赛有效。

赛后流程：

- 临时账号产生的记录归临时 UID。
- 真实学生登录后进入认领流程。
- 管理员审核后，将临时 UID 的记录迁移到真实 UID。
- 临时账号保留审计状态，不直接删除。

## 10. Vigil 登录与比赛选择流程

### 10.1 两步选择

客户端登录表单负责比赛选择，Vigil Server 提供 probe 和登录请求能力。

推荐流程：

1. Qt Client 收集学号、姓名、域。
2. Qt Client 发起探测。
3. Vigil 调 OJ 查询 eligible 比赛列表。
4. 如果只有一场当前窗口比赛，可以自动选择。
5. 如果多场 eligible，Qt Client 必须显示比赛列表让学生选择。
6. Qt Client 带目标比赛发起正式登录请求。
7. Vigil 根据 approvalMode 进入自动通过或老师审批。
8. 通过后创建 Vigil 会话和 OJ 客户端 session。
9. /vigil-launch 直接跳转到 /exam-mode/:tid。

正常客户端流程不再使用 /exam-mode 首页选比赛。

/exam-mode 首页仅保留：

- 管理员预览入口。
- 老版本或异常 fallback。
- session 有效但缺少比赛 ID 时的兜底说明。
- 普通访问时的说明或引导。

### 10.2 时间过滤

OJ lookup-student 返回 eligible 比赛时需要按时间过滤。

普通网页登录封锁：

- 只看当前管控窗口内的 eligible client_required 比赛。

客户端探测：

- 优先返回当前管控窗口内的 eligible 比赛。
- 如果没有当前窗口比赛，可返回未来 24 小时内 eligible 比赛，用于候考或测试。

客户端指定目标比赛：

- 只校验该目标比赛。
- 如果太早，返回 too early 状态和可进入时间。
- 如果在管控窗口内但未到比赛开始，可以创建会话并进入候考工作台。
- 如果比赛已结束，默认不新建答题会话。

### 10.3 auto 与 strict

auto：

- 仅对已绑定、命中参赛范围、通过旧 Hydro 访问控制、处于可进入窗口的学生自动通过。

strict：

- 即使正常学生也需要老师审批。

未知、未绑定、不在范围：

- 不自动通过。
- 只能进入审批或被拒绝。
- 老师可以手动创建临时账号覆盖。

## 11. 客户端比赛工作台

### 11.1 URL 与命名

内部 URL 暂时保留 /exam-mode/:tid。

产品语义改为客户端比赛工作台，英文可称 Contest Workspace。

代码可以逐步从 ExamMode / ExamPaper 语义过渡到 ContestWorkspace 语义，但不要求一次性修改 URL。

### 11.2 工作台内容

工作台不展示普通 OJ 全站框架，只展示比赛必要功能。

对 exam 赛制：

- 显示试卷/答题卡。
- 支持草稿、分题/分类型提交、finalize。
- 保留考试倒计时、锁屏提示、审批状态提示等。

对 acm、oi、ioi、strictioi、ledo、homework 等赛制：

- 显示比赛说明。
- 显示题目列表。
- 显示题面。
- 支持提交。
- 显示我的提交或本场记录。
- 榜单按原赛制规则显示。
- 澄清按原比赛规则保留。
- 打印按 allowPrint 保留。
- 附件按原比赛附件权限保留。

不显示：

- 普通 OJ 主页入口。
- 全站题库自由浏览。
- 全站记录列表。
- 全站讨论与训练入口。
- 与当前比赛无关的账户功能。

### 11.3 管理员预览

管理员、比赛 owner、maintainer 可通过 preview 模式预览工作台。

预览模式：

- 不要求客户端 session。
- 显示明显的预览标记。
- 不写入 Vigil 会话。
- 不算有效客户端凭证。

学生在管控窗口内不能用普通浏览器预览或提交。

## 12. OJ 与 Vigil 同步

采用双保险：

- 保存比赛时主动 push 到 Vigil。
- 客户端登录时通过 lookup-student 返回完整比赛 payload，Vigil lazy upsert 校正。

主动 push：

- contest add 后，如果 vigilEnabled 为 true，则 push 到 Vigil。
- contest edit 后，如果 vigilEnabled 为 true，则 update 到 Vigil。
- 如果从 true 改为 false，则从 Vigil 删除 mirror。
- contest delete 后，从 Vigil 删除 mirror。

push 失败：

- 不阻断 OJ 保存。
- 写日志。
- 可在后续 UI 或运维日志中提示。
- 登录时 lazy upsert 仍可兜底。

同步字段：

- 比赛 ID。
- 域 ID。
- 标题。
- 开始时间。
- 结束时间。
- entryMode。
- approvalMode。
- lockdownMode。
- pauseOnDisconnect。
- screenshotIntervalMs。
- exclusive。
- 管控窗口 before/after。
- 参赛范围摘要或由 lookup-student 动态计算。

已有 active Vigil 会话：

- 比赛时间或参赛范围修改后，不自动踢出已有会话。
- 新配置只影响新登录、新请求和普通网页登录封锁。
- 如需让已进入学生退出，由管理员在 Vigil dashboard 手动 force close 或 force finalize。
- OJ 保存配置时可以提示已有活跃会话不会自动关闭。

## 13. ui-next 比赛编辑页

### 13.1 页面分区

比赛编辑页建议按以下区域组织：

1. 基本信息。
   包含标题、赛制、时间、题目、说明。

2. 访问控制。
   保留老 Hydro 的公开、邀请码、指定 UID/旧用户组、维护者。

3. Krypton 参赛范围。
   使用分段控件或单选控件：不限、按学校、按用户组。学校和用户组都支持多选，但二者互斥。

4. 客户端与反作弊。
   包含 vigilEnabled、entryMode、管控窗口、approvalMode、lockdownMode、screenshotIntervalMs、pauseOnDisconnect、exclusive。

5. 比赛设置。
   包含语言限制、Rated、自动隐藏、允许查看代码、允许打印、封榜、弹性时长、榜单隐藏等。

6. 文件与辅助管理。
   保留公开/私有文件、验比赛人等已有管理能力。

### 13.2 展开逻辑

客户端与反作弊分区默认折叠或轻量展示。

当 vigilEnabled 为 false：

- 隐藏或弱化详细反作弊配置。
- entryMode 必须为 open。

当 vigilEnabled 为 true：

- 展开详细配置。
- 允许 open 或 client_required。

当 entryMode 为 client_required：

- vigilEnabled 自动为 true。
- 不允许关闭 vigilEnabled。
- 管控窗口字段可编辑。

### 13.3 设计风格

页面应符合 ui-next 已有管理界面：

- 使用现有 Button、Input、Select、MultiSelect、Checkbox、Dialog、Table 等组件。
- 不做营销式 hero。
- 信息密度适合老师反复配置。
- 字段文案直接说明后果，避免含糊。
- 长表单分区清晰，避免把所有配置堆在一个卡片里。

## 14. 后端实现边界

后端需要形成几个可复用判断：

- 是否启用 Vigil。
- 是否强制客户端。
- 当前请求是否有效客户端 session。
- 当前用户是否命中 Krypton 参赛范围。
- 当前用户是否通过老 Hydro 访问控制。
- 当前用户是否在 client_required 当前窗口内应被封锁。
- 当前比赛是否允许管理员预览。
- 当前临时 session 是否允许覆盖范围。

这些判断应该尽量集中，避免散落在各 handler 中造成不一致。

必须覆盖的后端入口：

- 登录 post。
- request layer 或 user layer 的普通 session 懒惰失效。
- contest prepare。
- attend。
- problem detail with contest。
- submit。
- paper draft/finalize。
- contest files。
- print。
- clarification。
- scoreboard 与记录视图中涉及参赛身份的入口。

## 15. 测试与验证

### 15.1 单元测试

建议覆盖：

- participantScopeMode 三种模式。
- 学校多选。
- 用户组多选。
- 旧 Hydro AND Krypton scope。
- 未绑定用户。
- 临时账号 session 覆盖。
- 管控窗口默认值。
- 管控窗口自定义 before/after。
- 多比赛窗口并集。
- 客户端 session 单比赛绑定。
- 管理员/owner/maintainer 绕过。

### 15.2 集成测试

建议覆盖：

- 普通网页登录命中封锁后被踢到说明页。
- 普通网页登录未命中范围不受影响。
- client_required 比赛普通 session 不能访问比赛工作台。
- /vigil-launch 创建客户端 session 后可进入指定比赛。
- 客户端 session 不能复用到另一个 client_required 比赛。
- participantScopeMode 为 none 时回退旧 Hydro 访问控制。
- auto 模式只自动放行正常绑定且 eligible 学生。
- strict 模式进入审批。
- 未绑定/未知学生进入审批，不能 auto。

### 15.3 UI 验证

建议覆盖：

- 创建比赛页。
- 编辑比赛页。
- 克隆比赛。
- 学校/用户组互斥切换。
- vigilEnabled 与 entryMode 联动。
- 默认管控窗口显示。
- 旧配置回显。
- 管理员预览工作台。
- ACM/XCPC 工作台。
- exam 试卷工作台。

### 15.4 Vigil 验证

建议覆盖：

- probe 返回单场 eligible。
- probe 返回多场 eligible，需要选择。
- 指定 targetContestId 太早时返回候考状态。
- 当前窗口自动通过。
- strict 审批。
- 临时账号创建。
- launch_exam_webview 指向 /vigil-launch 并最终进入 /exam-mode/:tid。
- close/force close 能关闭工作台。

## 16. 实施顺序

推荐实施顺序：

1. 后端字段与公共判断。
   先扩展 Tdoc 语义、contest edit handler 保存字段、scope helper、client session helper。

2. 登录与 session 封锁。
   加入当前请求懒惰失效、白名单、说明页。

3. Vigil/OJ eligibility。
   改 lookup-student，让它支持所有 rule、vigilEnabled、client_required、参赛范围和时间过滤。

4. Vigil Server 登录选择。
   增加 probe 或 needs selection 流程，支持 targetContestId、too early、候考。

5. OJ-Vigil 主动同步。
   contest add/edit/delete 后 push 或 delete Vigil mirror，同时保留 lazy upsert。

6. ui-next 比赛编辑页。
   补齐老 UI 配置，再加入 Krypton 参赛范围与客户端/反作弊配置。

7. 客户端比赛工作台。
   将 /exam-mode/:tid 抽象为 Contest Workspace。exam 走试卷 UI，其他 rule 走比赛 UI。

8. 测试与验收。
   先测 helper 和后端入口，再测 UI build，最后测 Vigil server pytest 与端到端 smoke。

这个顺序的核心原则是先闭合后端语义，再写 UI。否则容易出现 UI 能保存字段，但登录、提交、Vigil 审批没有一致执行的情况。

## 17. 已确认决策摘要

- 客户端强制进入适用于所有比赛赛制。
- /exam-mode/:tid 保留 URL，但语义升级为客户端比赛工作台。
- 正常 Qt 流程在客户端登录阶段选择比赛，审批后直接进入 /exam-mode/:tid。
- 学校/用户组参赛范围独立于旧 assign。
- 学校模式与用户组模式互斥，但各自支持多选。
- 旧 Hydro 访问控制与 Krypton 参赛范围取 AND。
- client_required 的普通网页登录封锁只影响命中参赛范围的学生。
- 管控窗口默认开始前 60 分钟到结束后 30 分钟，表单可覆盖。
- 多场比赛对同一学生取窗口并集。
- 已有普通 session 懒惰失效，不批量删除用户所有 session。
- 比赛路由也强制校验客户端 session，不能只靠登录拦截。
- 客户端 session 是单比赛凭证。
- 所有 Vigil 会话都绑定单个 contest。
- V1 只记录机器信息，不做每请求强机器证明。
- 未绑定/未知学生进入老师审批，不自动通过。
- 老师可创建临时账号覆盖范围，但必须记录审计。
- 临时账号不写永久学校/用户组身份，赛后走认领迁移。
- vigilEnabled 与 entryMode 分离，client_required 强制 vigilEnabled。
- 反作弊策略 V1 只做比赛级。
- 比赛保存时主动同步 Vigil，登录时 lazy upsert 兜底。
- 修改比赛配置不自动踢已有 Vigil 会话。
- 工作台内提交复用现有 judge/record/submit 链路。
