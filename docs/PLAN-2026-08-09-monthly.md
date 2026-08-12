# Plan: 2026-08 月度任务清单（41 项）

_Locked via eight-batch Grill — motricseven + Codex，2026-08-09。老师所称“九月份第一批任务”按用户最终纠正登记到当前八月计划；2026-08-31、2026-09-13 和 10 月校赛前 DDL 原样保留。全部产品分叉及替代关系见 `docs/plan-2026-08/grill-decisions.md`。_

---

## 文档状态与事实源

- **月度任务唯一事实源**：本文档。八月任务的目标、产品决策、实现边界、依赖、验收和部署组合只认本文档锁定后的内容。
- **任务状态唯一事实源**：`docs/plan-2026-08/tasks.js`。状态变化必须按 R4 同步；不能只在聊天、commit message 或任务 note 外另记进度。
- **全局工程约束**：仓库根 `AGENTS.md`。本文档只记录八月任务的增量约束，不复制并分叉长期 canonical。
- **生产与部署命令事实源**：`CLAUDE.md` 和 `docs/KRYPTON-OPS-RUNBOOK.md`。本文档只声明部署类型、组合、确认门和验收范围，不凭记忆重写命令。
- **七月计划仅作历史参考**：`docs/PLAN-2026-07-06-monthly.md` 及其看板不自动成为八月任务；结转必须由用户明确选择并在本文重新登记。
- **冲突优先级**：用户本轮明确指令 > 本文锁定任务 spec > `AGENTS.md` > `CLAUDE.md` / runbook > 任务看板 note。发现冲突时停下来指出，不自行挑一个方便的版本执行。

### 当前状态

| 项目 | 值 |
|---|---|
| 计划状态 | `locked` |
| 当前 revision | `Rev.1` |
| 已登记任务 | 41 |
| 已锁定任务 | 41 |
| 默认提交策略 | 用户选择任务后按 R2 创建任务级本地英文 Conventional Commit |
| 默认部署策略 | **不部署**；任务或批次必须有用户明确部署授权 |
| push | 禁止，除非用户另行明确授权 |

> 本计划已经锁定，但锁定不等于授权实现。新会话必须先按批次列出当前未完成任务并等待用户选择；没有选择、提交授权或部署授权时分别停在对应边界。

---

## Goal

把用户和老师确认的八月工作拆成可独立选择、独立实现、独立验收的子任务，并按紧迫度分批。每个子任务必须具备足够的信息，让新会话只读本文、看板、`AGENTS.md`、`CLAUDE.md` 和对应 runbook 后即可执行，不需要在实现中猜产品语义。

每个锁定任务至少包含：

1. 用户目标和真实使用场景；
2. 代码现状锚点，以及需要时的生产只读事实；
3. bug 的根因或 feature 的 canonical 设计；
4. 明确的范围、不变项和 Out of scope；
5. 数据、权限、生命周期、错误与可观测性边界；
6. 可执行的分层改动清单；
7. 回归矩阵和用户可观察的验收标准；
8. 依赖、不可拆部署单元、部署类型、确认门和回滚边界。

本站规模基线：单站，日常活跃人数小于 100，比赛/考试峰值不超过 500。实现必须完整满足正确性和安全边界，但遵守 YAGNI，不为假想规模引入缓存层、消息队列、分布式锁、后台 reconciler、自动恢复系统或其它未被真实需求证明的基础设施。

---

## 计划填充与锁定流程

1. **收集**：逐条记录老师/用户原始需求，不在收集时合并掉看似相近但验收不同的需求。
2. **只读核查**：阅读实际调用链、现有测试和必要的生产只读事实；不要把记忆或页面印象写成“现状”。
3. **识别分叉**：能由代码、既有 canonical 或小站规模直接决定的细节由 Agent 决定；会改变产品结果、数据语义、权限、兼容策略或生产写入范围的真实分叉才询问用户。
4. **拆任务**：一个任务应当是一次完整实现后可以开始 R1 对抗审查的最小阶段；跨 schema/协议的不可拆切换仍拆成可审查任务，但必须声明共同部署单元。
5. **写 spec 与看板**：任务总表、详细 spec、`tasks.js` 必须同一次更新，ID、标题、依赖、部署类型和确认标记完全一致。
6. **一致性检查**：核对任务总数、ID 唯一性、依赖无环、跨月引用、部署组合、红线、Out of scope 和所有占位符。
7. **计划审查**：任务全部填完后，对照八批 Grill 决策、代码现状、任务表与看板做只读一致性审查；未解决的真实分叉、占位符、依赖环或协议冲突任一存在时不得锁定。
8. **用户锁定**：用户明确确认后才把状态改为 `locked`。新增需求通过新的 Rev 追加，不静默改写既有已执行决策。

---

## 全局工作流规则（锁定后，每个执行会话必须遵守）

### R1. 完成后对抗性验证循环

> 做完每一个阶段之后，注意是**做完**，启动一个新的只读对抗性验证 Agent 审查本阶段改动；按审查意见继续修复，再启动新的 Agent 复审，直到没有需要修改的部分，或主 Agent 对全部剩余意见给出可核查的驳回理由。

执行细则：

- “一个阶段”默认等于本文的一个子任务；若任务属于不可拆部署单元，仍逐任务审查，部署前再做一次组合边界核对。
- **只有对抗审查才启动 Agent**。实现、排查、测试、修复和提交由当前主 Agent完成；不得在编码中途用 Agent 分工、探路或代写。
- 只有在实现和既定测试全部完成后，才能把看板从 `doing` 改为 `verifying` 并启动审查；半成品不得用审查 Agent 代替主 Agent 自测。
- 每一轮都使用新的 Agent，并提供：锁定 spec、实际 diff、测试结果、相关红线、已知脏文件和上轮发现的处理结果。
- 审查重点：授权与数据泄漏、生命周期绕过、schema/索引、遗漏调用点、错误吞噬、可观测性、兼容性、不变项、YAGNI 与任务外扩张。
- 接受的意见必须修复并回归；驳回意见必须把事实、测试或源码依据记入看板 note 或 review log，不能只写“不同意”。
- 审查闭环后才允许进入 R2 收尾或 R3 部署。

### R2. Git 纪律

- 所有 PLAN、review log 和看板文件都放在现有被忽略的 `docs/` 下，**不进 git，也不得新增 ignore 规则**。
- 保留用户和其他任务已有脏改动。源码只按真实所属仓库逐路径 `git add`，禁止 `git add .`、`git add -A` 或把无关文件顺带提交。
- 每次暂存前后核对 `git status --short`、实际 diff 和 `git diff --cached --name-only`。
- 本计划锁定后，用户明确说“按 PLAN 做 <任务 ID>”才授权该任务按本规则创建本地 commit；仅让 Agent 阅读、补充或评审计划不构成 commit 授权。
- 有提交授权时：每个任务完成 R1 循环后、下一个任务开始前，创建一个任务级本地 commit；使用准确的英文 Conventional Commit message。不可拆部署单元也不得把多个本可独立审查的任务揉成无法核对的巨型提交。
- `ecosystems/KryptonVigilSystem/{Server,Dashboard,Client}` 是独立且被主仓忽略的仓库；改到哪个仓就在真实所属仓分别核对和提交，不能以主仓状态代替。
- 禁止 push，除非用户另行明确授权。

### R3. 部署与生产变更纪律

- 选择任务、完成实现或创建 commit **不等于部署授权**。没有明确部署指令时，验证后停在 `done_local`。
- 获得部署授权后，先完整读取 `CLAUDE.md` §4 和 runbook 对应章节，再展示准确命令、目标主机、传输范围、排除项、备份、切换点、健康检查与回滚范围。
- 标记 ⚠️“部署前需确认”的任务，即使用户先前给过宽泛实施授权，也必须在生产写入/删除/迁移/服务切换前停下，展示当次实际命令和事实范围，获得明确确认后再执行。
- 涉及生产数据、testdata/checker、证据文件、权限、比赛/考试状态或不可逆操作时必须在切换前备份并验证；只读 plan、fingerprint、CAS apply、verify 和非目标数据哈希按任务 spec 执行。
- 严格按改动类型选择 runbook：源码、UI、依赖、Vigil、系统配置、Windows Client、单题 testdata/checker 不得互相套用简化命令。
- 传输只包含本任务所需源码/产物，排除 `dev/`、`docs/`、`tmp/`、`ecosystems/`（除非任务明确部署对应独立系统）、`node_modules` 及其它无关大目录；OJ 流量与离线约束必须遵守。
- 切换前执行生成文件门禁；切换后不能只看进程在线，必须按 runbook 验证 HTTP、PM2/systemd 日志、索引、manifest/hash 和任务特定业务路径。
- 修题面、testdata 或 checker 不自动授权创建验证提交或历史重测；重测必须由用户单独明确批准。
- 部署成功才改为 `deployed`；切换未发生或验收未完成不得提前标记。

### R4. 看板更新纪律

- 状态文件：`docs/plan-2026-08/tasks.js`；看板：`docs/plan-2026-08/dashboard.html`。
- 状态机：`todo → doing → verifying → done_local → deployed`；可进入 `blocked`，经用户明确取消可进入 `cancelled`。
- 每次状态变化立即更新该任务的 `status`、`note`、`updatedAt`，并同步顶层 `updatedAt`。
- `note` 记录当前可验证事实：实现到哪、测试/审查结果、commit（如有）、部署/备份/验证结果或阻塞条件；不得只写“完成”“差不多”或把未验证结果写成已上线。
- spec、依赖、部署类型或确认门变化时，本文总表、详细 spec 与 `tasks.js` 同步修改；不能只改看板。

### R5. 红线清单

以下是八月任务的常驻红线；任务填充时必须补充该任务特有红线。长期 canonical 仍以根 `AGENTS.md` 为准。

1. **生产既有数据默认受保护**：不覆盖、重编号、迁移或批量改写既有题目、Record、比赛、考试、训练、权限、导图、录像等，除非锁定 spec 精确列出范围并经过 R3。
2. **考试壳与 Vigil 安全边界不可顺手改**：Exam Mode、`rule=exam`、`client_required`、Vigil session、普通浏览器封锁和团队赛能力必须按 `AGENTS.md` 的 canonical 边界回归；前端隐藏不是权限。
3. **权限必须在最终服务端写入口重查**：页面 capability 只改善体验，不能代替 handler/model gate、revision/CAS、生命周期或容器时窗校验。
4. **修根因，不糊补丁**：bug 任务必须先记录可复现症状、真实根因和受影响全集；禁止按页面、题型、某个 ID 或某个文件名加一次性 special case 掩盖共享链问题。
5. **错误不能静默通过**：禁止 catch 后默认成功、返回空数据、自动回退旧协议、后台恢复掩盖未知状态或前端 toast 成功但服务端部分失败。
6. **关键路径可追踪**：外部写入、权限拒绝、状态转换、CAS 冲突、judge 入队、文件映射和迁移阶段要记录足以关联请求与对象的结构化上下文；敏感源码、答案、密码和 token 不进日志。
7. **schema 与 canonical 单写源不可绕过**：不得用请求路径静默回填、双写兜底、裸 Mongo 或直接文件操作绕过正式 model/service；确需迁移必须使用显式、可恢复、可验证的离线流程。
8. **Mongo 索引按真实能力设计**：partial index 禁止不支持的操作符；部署后必须查 `ensureIndexes failed`，不能因框架 catch 而把失败当成功。
9. **题目文件保持三层一致**：`document.data`、storage canonical mapping 和物理 blob 必须走正式 API 同步更新；任何层不一致都先停下定位。
10. **结构化代码与题面不得泄密**：学生端只消费 client-safe serializer；完整 source、标准答案、私有行、隐藏 cases、内部坐标和非公开元数据不能经 HTML、bootstrap、API、WebSocket 或错误响应泄漏。
11. **重构任务功能不变**：先建立行为基线和回归矩阵，再改内部结构/UI；不得借“重构”增加功能、改变权限、数据语义、路由协议或兼容行为。
12. **UI 不能只看截图**：新增页面必须落齐 route/template/component/PAGE_MAP/navigation/capability；真实登录态覆盖主流程、错误态、键盘、窄屏和深链恢复，不落 `GenericPage`。
13. **文件系统操作有路径边界**：来自 DB 或用户输入的路径先 `resolve` 并断言位于允许根目录；对外文件名安全化、限长且可追踪。
14. **YAGNI 但不偷功能**：必须完成 spec 的全部真实功能和边界测试；不得以小站为由省略正确性，也不得擅加缓存、队列、分布式协调、自动恢复、兼容层或预优化。
15. **关键 canonical 变化同步文档**：数据模型、协议、权限或产品事实源改变时，同步根 `AGENTS.md` 和对应 runbook/PRD；不能让全局文档变成过时说明。

---

## 任务编号、批次与预估口径

- ID：`P<紧迫度>.<顺序号>`，例如 `P1.1`。计划锁定后不复用已删除或取消的 ID；取消项保留并标 `cancelled`。
- 跨月依赖写全限定名，例如 `2026-07/P2.42`；八月内部依赖可直接写 `P2.1`。
- 紧迫度不是技术难度：
  - `1`：生产事故、安全/越权、考试比赛阻断、数据完整性风险；
  - `2`：关键基础能力、明确期限需求、其它任务的强依赖；
  - `3`：本月主要功能和大型重构；
  - `4`：体验、统计、运维和低风险完善；
  - `5`：研究、设计、可延后优化。
- 预估：`S` ≤ 半天会话；`M` ≈ 1 个完整会话；`L` ≈ 2–3 个会话。超过 `L` 应优先按可独立审查的 seam 拆分，而不是写成一个无限任务。
- 部署类型只写 runbook 对应类型，如 `§4.1`、`§4.3`、`§4.4`、`§4.5`、`§4.10`、`纯生产数据`、`无部署`；组合任务明确写所有目标与不可拆关系。

---

## Approach — 任务总表

> 每新增一项，必须同时新增详细 spec 和 `tasks.js` 条目。不要在总表放“稍后再说”的假任务；未完成 grill 的真实分叉写在“Open questions”，解决后再锁定任务。

| ID | 任务 | 紧迫 | 预估 | DDL | 依赖 | 部署 | 标注 |
|---|---|---:|:---:|---|---|---|---|
| P1.1 | IDE：兼容 JetBrains 剪贴板粘贴 | 1 | S | 尽快 | — | §4.4 | — |
| P1.2 | 题库：批量分配只读验题人 | 1 | S | 尽快 | — | §4.4 | ⚠️部署前需确认 |
| P1.3 | 真实性训练：策略与可信上下文 canonical | 1 | M | 尽快 | — | §4.4 | ⚠️部署前需确认 |
| P1.4 | 真实性训练：上下文提交与独立完成记录 | 1 | M | 尽快 | P1.3 | §4.4 | ⚠️部署前需确认 |
| P1.5 | 真实性训练：IDE 禁粘贴、草稿隔离与提交入口 | 1 | M | 尽快 | P1.3、P1.4 | §4.4 | ⚠️部署前需确认 |
| P1.6 | 真实性训练：防 AI 标记 authoring 与安全序列化 | 1 | M | 尽快 | P1.3 | §4.4 | ⚠️部署前需确认 |
| P1.7 | 真实性训练：复制注入与嵌套策略联调 | 1 | M | 尽快 | P1.5、P1.6 | §4.4 | ⚠️部署前需确认 |
| P1.8 | 终端基础：逐机器入网凭据与安全协议 | 1 | M | 2026-08-31 | — | §4.9 + §4.5 | ⚠️部署前需确认 |
| P1.9 | Endpoint Service：常驻连接、能力协商与模块边界 | 1 | M | 2026-08-31 | P1.8 | §4.9 | ⚠️部署前需确认 |
| P1.10 | Endpoint Service：完整网络策略与持久锁状态 | 1 | M | 2026-08-31 | P1.9 | §4.9 | ⚠️部署前需确认 |
| P1.11 | Vigil Server：执行会话、命令防重放与逐终端 ACK | 1 | M | 2026-08-31 | P1.8 | §4.5 | ⚠️部署前需确认 |
| P1.12 | 独立网络锁 MVP：无 Client 启停闭环 | 1 | M | 2026-08-31 | P1.10、P1.11 | §4.9 + §4.5 | ⚠️部署前需确认 |
| P1.13 | 考试基础设施：ExamEvent、权限与审计模型 | 1 | M | 2026-09-13 | — | §4.4 | ⚠️部署前需确认 |
| P1.14 | 考试基础设施：策略模板、不可变 revision 与目标快照 | 1 | M | 2026-09-13 | P1.13 | §4.4 | ⚠️部署前需确认 |
| P1.15 | OJ ↔ Vigil：控制面 API 与执行事实同步 | 1 | M | 2026-09-13 | P1.11、P1.14 | §4.4 + §4.5 | ⚠️部署前需确认 |
| P1.16 | 考试基础设施：WebUI 与外部考试工作流 | 1 | M | 2026-09-13 | P1.15 | §4.4 | ⚠️部署前需确认 |
| P1.17 | 网络锁正式控制面：热更新、回滚与端到端验收 | 1 | M | 2026-09-13 | P1.12、P1.16 | §4.9 + §4.5 + §4.4 | ⚠️部署前需确认 |
| P2.1 | 座位数据：ClassSignin 离线导入与差异确认 | 2 | M | 2026-10 校赛前 | P1.13 | §4.4 + 纯生产数据 | ⚠️部署前需确认 |
| P2.2 | 终端座位：长期绑定与临时配对码 | 2 | M | 2026-10 校赛前 | P1.9、P2.1 | §4.9 + §4.5 + §4.4 | ⚠️部署前需确认 |
| P2.3 | 终端座位：可视化绑定工作台 | 2 | M | 2026-10 校赛前 | P1.16、P2.2 | §4.4 | ⚠️部署前需确认 |
| P2.4 | 考试座位：userbind 名单与不可变范围快照 | 2 | M | 2026-10 校赛前 | P1.13、P2.1 | §4.4 | ⚠️部署前需确认 |
| P2.5 | 考试座位：可复现随机分配与人工调整 | 2 | M | 2026-10 校赛前 | P2.3、P2.4 | §4.4 | ⚠️部署前需确认 |
| P2.6 | 预登录：两阶段预检与一次性票据 | 2 | M | 2026-10 校赛前 | P1.15、P2.5 | §4.4 + §4.5 | ⚠️部署前需确认 |
| P2.7 | Endpoint Service：拉起 Client 与预登录兑换 | 2 | M | 2026-10 校赛前 | P1.9、P2.6 | §4.9 + §4.5 | ✅本地实现与双审完成；⚠️部署前需确认 |
| P2.8 | Endpoint Service：U 盘与进程检测告警 | 2 | M | 2026-10 校赛前 | P1.9、P1.11 | §4.9 + §4.5 + §4.4 | ⚠️部署前需确认 |
| P2.9 | 一键考试准备：分配、预登录与失败重试联调 | 2 | M | 2026-10 校赛前 | P1.17、P2.5、P2.6、P2.7、P2.8 | §4.9 + §4.5 + §4.4 | ⚠️部署前需确认 |
| P3.1 | 题集：TrainingDoc canonical 与服务单写源 | 3 | M | 无硬 DDL | — | §4.1（与 P3.2 同批） | — |
| P3.2 | 题集：`/problem-sets` 全站改名与旧路由跳转 | 3 | M | 无硬 DDL | P3.1 | §4.4（与 P3.1 同批） | — |
| P3.3 | 题集权益：发现范围与访问来源 canonical | 3 | M | 无硬 DDL | P3.1 | §4.4 | ⚠️部署前需确认 |
| P3.4 | 题集权益：列表、详情与显式开始学习 | 3 | M | 无硬 DDL | P3.2、P3.3 | §4.4 | ⚠️部署前需确认 |
| P3.5 | 题集权益：阶段解锁与 DAG 双门禁 | 3 | M | 无硬 DDL | P3.3 | §4.4 | ⚠️部署前需确认 |
| P3.6 | 兑换码：权限、批次、摘要与原子兑换模型 | 3 | M | 无硬 DDL | P3.3 | §4.4 | ⚠️部署前需确认 |
| P3.7 | 兑换码：创建、批量导出与管理工作台 | 3 | M | 无硬 DDL | P3.6 | §4.4 | ⚠️部署前需确认 |
| P3.8 | 兑换码：兑换、停用与单人权益撤销 | 3 | M | 无硬 DDL | P3.5、P3.6、P3.7 | §4.4 | ⚠️部署前需确认 |
| P3.9 | 课程联动：引用题集/阶段与可信来源上下文 | 3 | M | 无硬 DDL | P1.3、P3.5、P3.8 | §4.4 | ⚠️部署前需确认 |
| P4.1 | VP：资格、Attempt 与计时状态机 | 4 | M | 无硬 DDL | — | §4.1 | — |
| P4.2 | VP：提交归属与多赛制独立计分 | 4 | M | 无硬 DDL | P1.4、P4.1 | §4.1 | ⚠️部署前需确认 |
| P4.3 | VP：虚拟参赛工作台与信息隔离 | 4 | M | 无硬 DDL | P4.2 | §4.4 | — |
| P4.4 | VP：独立榜单、管理与显式重测 | 4 | M | 无硬 DDL | P4.2、P4.3 | §4.4 | ⚠️部署前需确认 |
| P5.1 | Endpoint 更新：签名发布包与安全自更新 | 5 | M | 后续增强 | P1.8、P1.9 | §4.9 | ⚠️部署前需确认 |
| P5.2 | Endpoint 更新：灰度、回退与运维工作台 | 5 | M | 后续增强 | P1.11、P1.16、P5.1 | §4.9 + §4.5 + §4.4 | ⚠️部署前需确认 |

### 批次主题

| 批次 | 默认含义 | 本月真实主题 |
|---|---|---|
| P1 | 线上阻断 / 安全 / 数据完整性 | 尽快项、8 月 31 日独立网络锁和 9 月 13 日正式控制面 |
| P2 | 核心依赖 / 数据治理 / 管理能力 | 10 月校赛前的座位、终端、分配和预登录基础设施 |
| P3 | 主要功能 / 大型重构 | 题集、分阶段权益、兑换码和课程联动 |
| P4 | 体验 / 统计 / 运维完善 | 个人编程赛虚拟参赛与独立成绩体系 |
| P5 | 研究 / 设计 / 可延后事项 | Endpoint Service 签名自更新、灰度和回退 |

---

## ui-next 页面注册与导航契约

任何新增或迁移 ui-next 页面都必须在任务 spec 和下表登记完整五件套；不涉及新页面的任务不要填假行。

| 任务 | canonical 路由 | handler `response.template` | React 组件 | PAGE_MAP / 导航 / active 说明 |
|---|---|---|---|---|
| P1.16、P1.17 | `/admin/exam-infrastructure`、`/admin/exam-infrastructure/events/:eventId` | `admin_exam_infrastructure.html`、`admin_exam_event.html` | `ExamInfrastructurePage`、`ExamEventPage` | 管理侧栏“考试基础设施”；按对应模板 active，不复用 Vigil Dashboard |
| P2.3 | `/admin/exam-infrastructure/classrooms/:classroomId` | `admin_exam_classroom.html` | `ExamClassroomPage` | 归属“考试基础设施”，教室详情深链刷新保持选中座位 |
| P2.5、P2.6、P2.9 | `/admin/exam-infrastructure/events/:eventId/seats` | `admin_exam_seats.html` | `ExamSeatPlanPage` | 归属“考试基础设施”，分配/预检/预登录步骤保留 URL 状态 |
| P3.2、P3.4、P3.5 | `/problem-sets`、`/problem-sets/:tid`、`/problem-sets/:tid/edit`、`/problem-sets/:tid/file` | `problem_set_main.html`、`problem_set_detail.html`、`problem_set_edit.html`、`problem_set_files.html` | `ProblemSetPage`、`ProblemSetManagePage` | 主侧栏“题集”；旧 `/training` 只跳转，不注册第二套页面 |
| P3.7 | `/manage/redemption-codes` | `redemption_code_manage.html` | `RedemptionCodeManagePage` | 管理区按服务端 capability 展示；无权限直链拒绝 |
| P3.8 | `/redeem` | `redeem.html` | `RedeemPage` | 登录用户全局入口；不因目标题集尚未可见而泄漏元数据 |
| P4.3、P4.4 | `/contest/:tid/virtual`、`/contest/:tid/virtual/scoreboard` | `contest_virtual.html`、`contest_virtual_scoreboard.html` | `VirtualContestPage`、`VirtualContestScoreboardPage` | 比赛详情内入口；VP 页面 active 与正式比赛/普通补题清晰区分 |

统一验收：服务端先做 capability gate；route/template/component/PAGE_MAP/导航 active 同步；刷新和深链不丢模块或筛选状态；无权限用户直链明确拒绝；页面不落 `GenericPage`；旧页面若删除，必须明确 404、redirect 或兼容策略，不能由框架静默 fallback 决定。

---

## 各任务详细 Spec

> 以下每个任务均为 `locked`。共同完成定义：实现与既定测试完成 → R1 对抗审查闭环 → 立即更新看板 → 按真实所属仓库逐路径提交 → 无部署授权时停在 `done_local`；只有按 R3 上线并完成任务特定验收才是 `deployed`。

### P1.1 IDE：兼容 JetBrains 剪贴板粘贴

**类型与目标**：`bugfix`。普通 Krypton IDE 必须接受 Dev-C++、JetBrains 系列 IDE、系统文本编辑器和浏览器复制的正常源码；真实性禁粘贴上下文仍必须拒绝全部外部粘贴。

**现状与根因边界**：编辑器核心位于 `packages/ui-next/src/components/krypton-ide.tsx`，当前用户实测 Dev-C++ 可粘贴、JetBrains 不可粘贴。实现阶段先在目标 Edge/Windows 环境只记录 `clipboardData.types`、各格式是否存在、长度、换行类型和事件序列，绝不记录正文；据此修正共享 clipboard→CodeMirror 输入适配，禁止按 JetBrains 产品名加 special case。

**范围与不变项**：规范化文本换行为 `\n`，在多个 MIME 并存时选择真实纯文本代码并保留 Unicode、制表符和末尾换行；不解析或执行 HTML，不改 IDE 提交、自测、语言、快捷键、undo、草稿和只读行为。Out of scope：富文本粘贴、格式化代码、剪贴板历史和系统级防绕过。

**验证与可观测性**：加入合成 ClipboardEvent/CodeMirror 回归，覆盖 `text/plain`、`text/html`、JetBrains 自定义 MIME、多格式、CRLF/LF、空文本、超长文本、快捷键/右键/中键以及真实性模式拒绝；真实 Edge 验证 Dev-C++ 与至少一个 JetBrains IDE。失败显示明确原因，不静默吞掉 paste。

**部署**：§4.4，`confirmBeforeDeploy:false`；仅 UI 源码/产物，无 schema、权限或生产数据写，回滚恢复旧前端。

### P1.2 题库：批量分配只读验题人 ⚠️

**类型与目标**：`feature`。复用题库现有批量协作对话框和 canonical `verifier` 角色，为多道已选题一次分配只读验题人。

**现状与设计**：现有入口在 `packages/ui-next/src/pages/problems.tsx`，写链在 `packages/krypton-permits/src/handler.ts` 的 `/problem-contributions/bulk` 与 `src/service.ts`。新增操作必须调用正式 permit service 的 direct verifier grant；不得伪装成 data/tag contribution，也不得写 legacy maintainer 镜像。已有 verifier 幂等成功；author/maintainer 已存在时不写入、不降级，并返回明确的 higher-role 冲突。

**权限与结果协议**：操作者必须同时拥有现有批量选择能力和每道题的 canonical 分配权限；最终 gate 在服务端逐题重查。请求带精确 pid 集合、目标 UID、角色和 requestId；返回逐题 `applied/already-present/conflict-higher-role/failed`，部分失败不回滚已成功项，但必须生成精确重试集合和一条汇总通知/审计。

**验收**：覆盖普通题、托管题、跨域伪造、无权题、失效选择 revision、重复提交、目标不存在、author/maintainer 保留和中途失败；UI 预览数量、成功/跳过/失败清单与服务端一致。不能把“请求返回 200”当作全部成功。

**部署**：§4.4，`confirmBeforeDeploy:true`，因为上线新增批量权限写入口；部署本身不分配任何人，真实角色变化只由用户后续操作产生。

### P1.3 真实性训练：策略与可信上下文 canonical ⚠️

**类型与目标**：`feature/schema`。为课程和题集建立服务端可信、可版本化的真实性策略，不把开关放在 Problem 或客户端 query 上。

**Canonical**：新增 `PracticeIntegrityRevision`，归属一个 Course 或 ProblemSet，发布后不可变；首版字段只含禁外部代码注入、移除独立提交表单、复制防 AI 注入及必要的策略版本元数据。首次产生受控草稿或提交后，修改必须发布新 revision。新建页面上下文由服务端签发短期 `PracticeContext`，绑定 domain、uid、容器、章节/阶段、pid 和全部参与 revision；URL 参数只用于请求上下文，不能自证授权。

**现状锚点与范围**：复用 `packages/hydrooj/src/model/training.ts`、`handler/course.ts`、`handler/training.ts`、`handler/problem.ts` 和 `packages/ui-next/src/components/krypton-ide.tsx`。同一题在课程中可禁粘贴、在 Contest/普通题页允许；首版只支持 Course 默认和 ProblemSet 默认，不做逐题、逐章、逐阶段 override。

**权限/生命周期**：只有容器 owner/协作管理者及管理员可编辑草稿/发布；学生开始后旧 revision 保留，既有完成不追溯撤销，旧草稿不能导入新 revision。无有效上下文时受控入口 fail closed，普通题目行为保持不变。

**测试与部署**：矩阵覆盖跨用户/跨容器/跨题重放、过期、嵌套策略、发布竞态、无策略、管理员预览和存量课程/训练。关键日志只记 contextId、uid、容器、pid、revision 和拒绝原因。§4.4，确认门覆盖新集合/索引、权限和上下文协议；P1.3–P1.7 为不可拆部署单元。

### P1.4 真实性训练：上下文提交与独立完成记录 ⚠️

**类型与目标**：`feature/schema`。真实性容器只认本上下文内真实完成的 AC，同时保留全站普通 ProblemStatus 语义。

**Canonical**：新增幂等 `ContextualCompletion`，唯一身份至少为 domain、uid、容器、作用域、pid 与适用策略 revision；Record 保存可信 context 引用而非客户端声明。`ProblemSubmitHandler` 在最终写入口验证 context、题目、用户、容器可见性和最新适用 revision，再把 context 交给异步评测链；AC 回写以 RID 幂等创建完成事实。普通、Contest、其它课程和历史 AC 不能补造记录。

**组合语义**：从课程引用题集进入时，一次 AC 同时完成该课程上下文和引用范围内的题集上下文；直接从题集进入只完成题集，不反向完成所有引用课程。非真实性容器继续使用全局 AC；VP AC 只进入非真实性容器。

**错误/可观测性**：缺失、伪造、过期或 scope 不匹配返回明确 4xx/409，不回退普通提交；评测回写日志包含 rid/context/container/pid/revision/stage，重复事件必须幂等，未知状态要暴露而非假定完成。

**验证与部署**：覆盖并发 AC、重测、取消、非 AC、同题多课程、嵌套题集、普通/Contest/VP 和策略换版；证明旧进度不被删除。依赖 P1.3，§4.4，`confirmBeforeDeploy:true`，与 P1.3–P1.7 同批切换。

### P1.5 真实性训练：IDE 禁粘贴、草稿隔离与提交入口 ⚠️

**类型与目标**：`feature/ui`。在有效受控上下文中尽量阻止外部代码注入，同时保留学生完成任务所需的 IDE 自测、提交和记录反馈。

**交互边界**：在 `KryptonIDE`/CodeMirror transaction 边界统一拒绝快捷键粘贴、右键粘贴、中键粘贴、拖放、文件导入、`beforeinput/inputType=insertFromPaste|insertFromDrop` 及自身复制再粘贴；直接键入、自动补全、撤销和 IDE 内正常编辑保留。所谓“无提交界面”只移除题面旁独立 textarea/form，IDE 内置 submit/pretest/records 必须保留。

**草稿与权限**：草稿 key 必须绑定用户、上下文、pid、语言和策略 revision；普通 IDE、其它课程或旧 revision 草稿不得自动导入。学生受限；author、maintainer、管理员和 verifier 保留工作能力，并可显式进入学生预览，预览不产生学生 completion。

**安全说明**：服务端在提交时仍验证 PracticeContext；前端禁粘贴是威慑和真实性约束，不宣传为不可绕过安全沙箱。拒绝时提供短说明，不记录剪贴板内容。

**验收/部署**：覆盖所有注入入口、键盘导航、IME、触屏、刷新恢复、策略切换、普通/Contest 不受限和独立提交表单消失。依赖 P1.3/P1.4，§4.4，确认门和不可拆部署单元同 P1.3。

### P1.6 真实性训练：防 AI 标记 authoring 与安全序列化 ⚠️

**类型与目标**：`feature/schema/ui`。作者能在题面任意位置插入任意长度的隐藏提示文本，但正常阅读、LaTeX、辅助技术、打印和 PDF 不出现真实零宽垃圾字符。

**Canonical**：`AntiAiMarker` 是 Problem 上的结构化定位记录，包含稳定 marker ID、题面位置/anchor、注入文本和 revision；Markdown canonical 本身不混入零宽字符。题面保存沿现有 revision/CAS 更新标记位置，无法确定的编辑冲突必须阻止保存，不在附近猜锚点。

**作者 UI 与序列化**：在现有题面编辑工作台以可见 chip/边界标记编辑、移动、删除和查看文本；提供“学生可见效果”和“复制结果”两种预览。学生 serializer 只下发执行复制注入所需的最小安全 marker，不下发作者内部 anchor、审计或无关策略；未启用上下文注入时页面复制保持干净。

**验收**：标记位于段首/段尾/链接/代码块/LaTeX/中文组合字符，题面编辑插入删除，打印/PDF、屏幕阅读器树和普通复制均验证；未知 schema fail closed。依赖 P1.3，§4.4，确认门覆盖新题面结构；不批量改任何旧题。

### P1.7 真实性训练：复制注入与嵌套策略联调 ⚠️

**类型与目标**：`feature/integration`。只有当前可信上下文启用复制注入，且复制选区真实跨过 marker 时，指定文本才进入剪贴板。

**实现协议**：题面渲染器保留不可见但可定位的 marker boundary；复制事件按 DOM Range 和 serializer 映射计算命中标记，在 `text/plain` 与 `text/html` 两种格式的相同语义位置注入。不得每次复制统一追加、污染学生代码、题目附件、IDE 编辑器、打印或 PDF。Course 与 ProblemSet 嵌套策略以逻辑 OR 取更严格结果，并把参与 revision 记录进 PracticeContext。

**失败边界**：无法验证上下文时不假装已启用受控模式；受控页面初始化失败应明确阻止进入/提交，而非降级普通题页。Clipboard API 不可写时向用户显示失败，不能只修改一类 MIME 导致粘贴目标绕过。

**验证/部署**：覆盖部分段落、多 marker、反向选择、跨元素、代码块、纯文本/富文本目标、未跨 marker、Contest/普通页以及作者预览。依赖 P1.5/P1.6；P1.3–P1.7 全部完成后按 §4.4 一次上线并在部署前重新确认。

### P1.8 终端基础：逐机器入网凭据与安全协议 ⚠️

**类型与目标**：`feature/security/protocol`。替换 Vigil 现有共享 `client_token` 和明文/可重放边界，使每台 Endpoint Service 拥有独立可吊销身份。

**Canonical**：管理员创建短期、有过期时间和注册数上限的入网批次；终端首次注册生成本机密钥并取得逐机器凭据，`machineId` 只作硬件变化诊断。控制链使用加密 WebSocket、固定服务器公钥或本站私有 CA；版本化命令含 endpointId、activityId、commandId、schema/protocol version、revision、issuedAt/expiresAt 和完整性证明，服务持久化防重放游标。

**范围/权限**：OJ 保存教师授权和入网批次业务事实，Vigil 保存凭据/连接执行事实；只有站点或考试基础设施管理员可创建、吊销、换机。删除所有非空默认共享凭据并提供明确轮换步骤；不建设通用企业 PKI，不允许任意远程 shell。

**验收**：过期/超额入网码、重复注册、克隆凭据、旧命令重放、时钟偏差、证书错误、密钥轮换、主板/网卡变化和吊销均有确定结果；日志不得含密钥、token 或完整入网码。§4.9 + §4.5，确认后才可连接/注册真实 Windows 主机；与 P1.9–P1.12 构成 8 月 31 日部署单元。

### P1.9 Endpoint Service：常驻连接、能力协商与模块边界 ⚠️

**类型与目标**：`refactor/feature`。把现有只承载本机 IPC 的 `KryptonVigilService` 演进为开机自启、可独立连接执行面的 `Krypton Endpoint Service`。

**现状锚点**：`Client/app/service_main.cpp`、`watchdog/windows_service_win.cpp` 当前启动 `NetworkLockIpcServer`，学生 GUI 的 `server_connection.cpp` 才连接 Server。新服务以编译期模块注册和严格 schema 承载：网络策略、版本/能力、Client 拉起、一次性预登录、U 盘、进程、座位与当前活动状态；不实现动态 DLL、脚本或任意命令。

**生命周期**：服务在 SCM 下启动、持久化 endpoint identity、断线重连并上报版本/capabilities；模块命令必须先做 capability/version gate。GUI 仍是独立低权限交互进程，不能持有终端长期凭据；服务重启恢复已授权活动状态，不凭 GUI 存活决定解锁。

**验证**：Windows 服务安装/卸载/开机、无交互 session、Server 不可达、协议不兼容、模块缺失、重复连接、凭据吊销和升级前后兼容；日志含 endpointId/version/capability/stage，不含秘密。依赖 P1.8，§4.9，真实分发前确认并保留旧安装包和回滚步骤。

### P1.10 Endpoint Service：完整网络策略与持久锁状态 ⚠️

**类型与目标**：`bugfix/feature/security`。网络锁无需学生 GUI 续约，且产品声明的域名、IP/CIDR、端口规则必须真实落到 Windows 系统层。

**根因与设计**：现有 `network_lock_manager.cpp` 使用约 45 秒 lease/owner process，`network_lock_manager_win.cpp` 主要解析 IPv4，策略 `ports` 未完整应用。改为由服务持有签名活动授权：activityId、policyRevision、target endpoint、startAt、hardEndAt 和状态；断线继续最后已 ACK 策略，只能经认证停止、硬截止或有审计的本机管理员恢复。

**网络语义**：支持精确域名/子域规则、IPv4/IPv6、IP/CIDR 和端口；明确 DNS 刷新、通配域、无法解析、DNS/DHCP/控制面必需流量及策略冲突。HTTPS 只承诺主机/IP/端口，不做路径过滤、MITM 或证书注入。策略应用必须事务式，失败不得留下一半旧一半新规则。

**验收**：WFP 单元/Windows 集成覆盖 IPv4/v6、CIDR、端口组合、DNS 变化、重启、断线、硬截止、停止、紧急恢复、两个活动冲突和应用失败清理。依赖 P1.9，§4.9；切换前确认目标机并验证可恢复路径。

### P1.11 Vigil Server：执行会话、命令防重放与逐终端 ACK ⚠️

**类型与目标**：`feature/schema/protocol`。用持久执行事实替代 `client_registry.py` 的纯内存在线快照和只表示 send 成功的命令结果。

**Canonical**：Vigil 保存 endpoint、连接、execution session、command envelope、expected/applied revision、sentAt/appliedAt/failure 和审计；OJ 不复制这些执行事实。服务校验 P1.8 命令身份、防重放和活动范围，逐终端状态明确区分 queued/sent/applied/failed/expired/offline。重复 ACK 幂等，未知 endpoint/revision fail closed。

**范围与不变项**：保留现有正式 Vigil Client/监考比赛链，新增 Endpoint 通道不得把 Dashboard 共享 token 变成正式权限模型；不建设消息队列或多站分布式调度，单站数据库加 asyncio 边界足够。断线重连后终端报告实际状态，Server 不凭最后一次 send 猜成功。

**验证/部署**：覆盖并发命令、失联、晚到 ACK、重复 commandId、过期/降级 revision、Server 重启和部分成功；结构化日志能按 activity/endpoint/command/revision 追踪。依赖 P1.8，§4.5；数据库备份和协议兼容检查后才能切换。

### P1.12 独立网络锁 MVP：无 Client 启停闭环 ⚠️

**类型与目标**：`integration/milestone`。在 2026-08-31 前证明 Windows 服务不启动学生 Client 也能完整执行独立网络锁。

**范围**：提供受控的管理/API 入口选择已注册 endpoint、提交一份显式策略与硬结束时间、预检能力、启用、查看逐机 ACK、停止和核验释放。MVP 可以没有最终 OJ WebUI，但不能用测试假 ACK 或直接调用本机 IPC 冒充远程闭环；运行状态必须使用 P1.11 canonical。

**验收矩阵**：至少一台真实 Windows 测试机完成安装→入网→离线 Client 状态→启用严格网络策略→允许/拒绝访问核验→Server 临时断线仍锁定→服务重启恢复→认证停止/硬截止释放。另测策略应用失败、终端离线、旧协议、部分批次成功和本机恢复。不得连接或修改生产机房，除非用户展示范围后再次批准。

**原子边界/部署**：依赖 P1.10/P1.11；P1.8–P1.12 是首个跨 Client/Server 不可拆协议单元。§4.9 + §4.5，切换前展示二仓 commit、安装包哈希、备份、目标机、命令、健康检查和回滚。

### P1.13 考试基础设施：ExamEvent、权限与审计模型 ⚠️

**类型与目标**：`feature/schema`。在 OJ 建立可脱离 Contest 存在的考试活动，为 Krypton 考试和 CSP 等外部考试提供共同业务根。

**Canonical**：`ExamEvent` 保存 domain/school scope、标题、类型、可选 contestId、生命周期、时间窗、owner/collaborators、revision 和审计引用；网络策略、目标、教室、座位与预登录以后都引用 eventId。关联 Contest 只附加题目/考试壳，不改变 ExamEvent 生命周期，也不为外部考试伪造空 Contest。

**权限**：OJ 教师账号进入“管理 → 考试基础设施”；基础设施管理员可跨活动，普通教师只能在 userbind 学校范围内创建和管理自己/协作活动。服务端最终 gate 重查学校、角色和 revision；Vigil Dashboard 共享 token 不参与。创建/编辑/归档使用 CAS，已启动活动的关键身份/范围冻结，删除有引用活动拒绝。

**实现/测试**：在 Hydro model/handler、oplog 和 ui-next bootstrap 定义最小安全 serializer；覆盖跨域/跨校、关联不存在 Contest、并发编辑、归档、活动已开始和无权直链。同步 `AGENTS.md` 与 runbook。§4.4，确认门覆盖新集合/索引和权限；部署本身不创建真实活动。

### P1.14 考试基础设施：策略模板、不可变 revision 与目标快照 ⚠️

**类型与目标**：`feature/schema`。教师通过可复用草稿发布不可变网络策略，并在活动启用时把动态选择编译成明确终端清单。

**Canonical**：PolicyTemplate 是可编辑草稿容器；PolicyRevision 是发布后不可变的域名/IP/CIDR/端口规则；TargetAssignmentRevision 保存按教室、手工 endpoint/seat、考试座位或 userbind 用户组解析出的 endpoint IDs 与来源 fingerprint。活动执行 session 固定引用两类 revision。

**生命周期**：发布前校验规则、重复/冲突、控制面必需流量和终端能力；启用时重新解析并展示差异，确认后冻结。活动中的组变化、座位编辑或换绑不改变目标；增删必须发布新目标 revision。模板删除不得破坏历史 revision，回滚是重新分配旧 revision，不生成反向 patch。

**权限/测试**：只能为可管理的 ExamEvent 发布/分配；跨学校 endpoint、空目标、无法解析域名、旧 revision、CAS 冲突和部分能力不足明确拒绝。日志记录 actor/event/revision/target counts/fingerprint。依赖 P1.13，§4.4，确认门覆盖 schema 与后续终端影响。

### P1.15 OJ ↔ Vigil：控制面 API 与执行事实同步 ⚠️

**类型与目标**：`feature/integration`。以窄服务接口连接 OJ 业务事实与 Vigil 执行事实，不让任一侧成为另一侧数据库的副本。

**协议**：OJ 向 Vigil 发送已授权的 event/session、policy revision、target revision 与硬截止；Vigil 返回逐 endpoint execution refs/status。请求使用现有 OJ↔Vigil service-token 轮换边界并增加 requestId/revision/幂等键；回调只更新 OJ 的投影视图和审计引用，不覆写 policy/target canonical。网络超时返回未知/失败，不显示成功。

**现状锚点**：复用 `packages/hydrooj/src/handler/vigil-integration.ts`、`service/vigil-bridge.ts` 与 Server `app/api/oj_integration.py`/`security.py`，不得扩建 `Dashboard` token API。权限只在 OJ 用户请求入口做，Vigil 只接受受信 service scope。

**验证/部署**：契约测试覆盖 token 轮换、重试、重复请求、乱序状态、OJ/Server 单边重启、Vigil 已执行但响应丢失和 scope 越权；两边日志以 requestId/event/session 关联。依赖 P1.11/P1.14，§4.4 + §4.5，双端备份后同批切换。

### P1.16 考试基础设施：WebUI 与外部考试工作流 ⚠️

**类型与目标**：`feature/ui`。在 OJ 主侧栏管理区提供正式工作台，教师能创建独立外部考试、配置策略和目标并看到真实执行状态。

**页面与交互**：实现页面注册表中的 `/admin/exam-infrastructure` 与 event detail；列表区分草稿/计划/活动/结束/归档，详情按“基本信息→策略→目标终端→预检→启停与结果”顺序减少跳转和滚动。状态明确分为已发布、已送达、已应用、应用失败，空状态与无权限直链完整。复用 Krypton UI/权限/导航，不引用 `ecosystems/.../Dashboard` 组件或共享令牌。

**安全/可观测性**：所有写操作由 P1.13/P1.14 服务执行 CAS；前端不能直接向 Vigil 发高权限命令。启停、发布和放宽策略使用自定义确认，展示 revision、目标数、差异、硬截止和失败机；不把 polling/transport 成功冒充执行成功。

**验证/部署**：真实教师/无权限/管理员、Krypton Contest/纯外部考试、0/1/500 endpoints、窄屏、键盘、深链刷新、Server 离线与部分失败。依赖 P1.15，§4.4，部署前确认服务接口和生产侧栏可见范围。

### P1.17 网络锁正式控制面：热更新、回滚与端到端验收 ⚠️

**类型与目标**：`integration/milestone`。在 2026-09-13 前完成正式可用的网络锁控制面及热更新闭环。

**行为**：活动中发布新 policy/target revision 前展示规则与 endpoint 差异，并标明收紧或放宽；教师显式确认后推送，逐机保留旧/期望/实际 revision。回滚选择一个历史 revision 再分配。离线终端显示待处理/失败，不自动解除；硬截止与本机恢复始终有效。支持纯外部考试和关联 Contest 两种活动。

**验收**：在授权测试环境以多 endpoint 模拟和至少一台真实 Windows 验证创建→发布→预检→启用→热更新→部分失败→重试→回滚→停止→硬截止；Server/OJ/Endpoint 任一重启、DNS 变化、IPv6、端口限制和审计查询均覆盖。UI 所有计数必须能追到 execution facts。

**原子部署**：依赖 P1.12/P1.16；P1.8–P1.17 组合边界核对后按 §4.9 → §4.5 → §4.4 的兼容顺序切换，具体顺序以届时 runbook 的向后兼容矩阵为准。确认前停下展示安装包哈希、三端备份、传输排除项、目标终端、切换、健康检查和回滚；不顺带启用真实考试。

### P2.1 座位数据：ClassSignin 离线导入与差异确认 ⚠️

**类型与目标**：`migration/data/feature`。把用户提供的 ClassSignin/码上坐数据库导出确定性导入 Krypton 自己的教室与座位 canonical；运行时不连接上游 API 或数据库。

**现状与输入协议**：本地参考实现的 `src/server/db/schema.ts` 中 `classrooms` 保存 UUID、schoolId、name、layoutJson，布局 item 含稳定 `id`、label、x/y、width/height、rotation、type/status。实际生产导出到手后必须先只读识别版本；manifest 显式映射上游 schoolId 到 OJ userbind 学校，仅导入必要学校元数据、教室与布局，不导入学生、班级、课程或签到历史。

**Canonical/import state**：OJ 保存 source system、sourceSchoolId/sourceClassroomId/sourceSeatId、导入 batch、源 fingerprint、layout revision 与快照；seatId 是身份，label 可变。只实现部署时运行一次的受控迁移程序，按 `validate → plan → apply → verify` 顺序完成安全检查和写入，不注册长期导入/导出业务 API、WebUI 或运行时同步子系统。plan 展示新增/不变/变更/删除/冲突和非目标哈希。重跑同 fingerprint 幂等；已被 EndpointSeatBinding 或 ExamEvent 引用的删除/ID 变化整批相关写入 fail closed，不按 label 猜匹配。

**权限/验收**：一次性 apply 只能由具备站点/考试基础设施管理权限的部署操作者显式执行。覆盖畸形 JSON、重复 seat ID、装饰物、跨校映射、空布局、坐标边界、重复批次、布局漂移和 CAS 竞争。生产 apply 必须基于已取得的只读导出，另行展示备份、manifest、fingerprint 和精确命令并取得确认；本地实现阶段不得连接或写入生产 MongoDB。§4.4 + 纯生产数据，依赖 P1.13。

### P2.2 终端座位：长期绑定与临时配对码 ⚠️

**类型与目标**：`feature/schema/protocol`。在没有稳定 Windows 主机名的固定机房中，以低操作成本建立实体 seatId 与 endpointId 的长期一对一绑定。

**Canonical**：`EndpointSeatBinding` 保存 domain/school/classroom/seatId、endpointId、revision、状态、created/updated actor/time 和换机审计；唯一约束保证同一域内一个有效实体座位只绑定一个 endpoint、一个 endpoint 只占一个实体座位，与具体活动无关。管理员在教室页面为未绑定座位开启短时识别窗口，页面显示 `XXXX-XXXX`，终端只输入对应 8 位数字；Server 将当前已认证 endpoint 与 seat 绑定。码在本次窗口内唯一、短 TTL、单 endpoint 认领且限速，明文只在创建响应和当前管理员页面内存出现。

**生命周期**：label/坐标变化不影响绑定；硬件身份变化进入显式换机，旧 endpoint 保留历史。重绑前展示旧/新端点和引用的未来活动；进行中活动引用的是目标快照，不被重绑静默修改。冲突、过期、跨校、重复兑换和未认证 endpoint 明确拒绝。

**实现/验证**：OJ 管理绑定业务事实，Vigil 只提供 endpoint 认证/在线执行事实；配对协议带 requestId 和审计。GUI 每次显式启动都重新查询当前 binding：bound 才进入原学号/姓名界面，unbound 只显示座位码输入，查询失败则停止；Vigil 在普通登录、预登录兑换和任何实际创建/恢复/人工批准 ExamSession 的写边界再次向 OJ 重查，未绑定客户端即使绕过 GUI或等待审批后被解绑也不能建立考试会话。开机不自动弹 GUI，本机不缓存 seatId；GUI 的 client-safe endpoint 身份每次从固定路径 LocalSystem Service 的严格 IPC 取得，共享 `config.kvs` 不参与身份信任。覆盖并发抢码、一机两座、一座两机、终端离线、换机、Ghost 还原后的同 endpoint 恢复和导入布局漂移。依赖 P1.9/P2.1，§4.9 + §4.5 + §4.4；真实机房绑定前必须再次确认目标范围。

### P2.3 终端座位：可视化绑定工作台 ⚠️

**类型与目标**：`feature/ui`。教师在真实布局上完成绝大多数绑定操作，不要求记忆机器名、UUID 或在表格间反复复制。

**页面**：实现 `/admin/exam-infrastructure/classrooms/:classroomId`，按导入坐标渲染座位和装饰物；座位状态至少区分未绑定、已绑定在线、已绑定离线、终端身份变化、冲突和被活动引用。点座位即可开启配对码、查看 endpoint 信息、重绑或解除；批量识别窗口能按最近响应定位机器，但不靠主机名自动匹配。

**交互约束**：本任务不重新实现 ClassSignin 布局编辑器，也不允许直接改 source seatId/几何；P2.1 是一次性部署迁移，不作为日常布局编辑或再导入入口。未来确需变更 canonical 布局时必须另立受控任务并重新定义引用保护与确认边界。配对成功自动选中下一个未绑定座位；提供搜索、键盘操作、单步撤销和最近操作记录。下一步控件距离和滚动量应小，但座位、确认和详情仍保有可点击面积与有效视口；键盘可遍历座位，缩放/平移不遮挡主要操作。

**错误/验收**：所有 mutation 使用 P2.2 revision/CAS；Server 离线、码过期、并发重绑和权限变化后显示真实状态。用空教室、密集 500 座、长 label、窄屏、键盘、深链刷新和亮/暗主题验证。依赖 P1.16/P2.2，§4.4，确认后上线但不自动建立任何生产绑定。

### P2.4 考试座位：userbind 名单与不可变范围快照 ⚠️

**类型与目标**：`feature/schema`。所有学生范围统一来自 OJ userbind 学校/用户组，并在活动准备时形成可审计快照。

**Canonical**：`ExamRosterRevision` 保存 ExamEvent、选择来源、解析时 userbind group revision/fingerprint、明确 uid/boundUserId 列表和排除原因；`ExamSeatPlan` 引用 roster revision、classroom/layout revision 与候选 seat IDs。纯外部考试可以没有学生名单并直接选教室；Krypton 考试可引用 Contest audience，但仍编译成明确用户列表。

**生命周期/权限**：只有可管理 event 且有对应学校/用户组查看权的教师可生成。活动启用后 userbind 组变化不改变 roster；刷新名单必须新建 revision 并展示增删。未绑定 OJ 账号、重复学生、跨校组、已停用用户和座位不足形成诊断，不自动创建第二套学生。

**验证/部署**：复用 `packages/krypton-userbind` 的 canonical 查询，覆盖多组去重、组成员并发变化、空名单、500 人、活动已开始和跨域伪造；日志含 event/roster revision/counts/fingerprint。依赖 P1.13/P2.1，§4.4，确认门覆盖 PII、快照集合和权限。

### P2.5 考试座位：可复现随机分配与人工调整 ⚠️

**类型与目标**：`feature/ui`。老师一键获得稳定、可解释、可复现的学生—座位分配，并能在发布前处理少量现场例外。

**Canonical/算法**：`ExamSeatAssignmentRevision` 固定 rosterRevision、layoutRevision、候选 seats、规范化约束、随机 seed、算法版本和最终 uid→seatId 映射。默认将排序后的 uid 与 seatId 用保存的 CSPRNG seed 做确定性 shuffle；同输入/seed/版本必得同结果。人数超座位、禁用/无绑定座位、重复与约束冲突返回完整诊断，不生成半份正式 revision。

**UI/生命周期**：预览显示学生身份、虚拟座位、实体 endpoint 在线情况和未分配项；可切换学号顺序，允许拖换/手工指定并锁定已确认配对，显式“重新随机”才生成新 seed 且保留锁定项。发布后 revision 不原地改，调整生成新 revision；已启用活动不静默跟随布局或终端重绑。这里分配的是考试座位，不修改长期 EndpointSeatBinding。

**验收**：相同 seed、不同 seed、0/1/500 人、座位不足、人工 swap、并发发布、组成员漂移和布局漂移；导出/页面显示一致。依赖 P2.3/P2.4，§4.4，部署不自动分配真实考试。

### P2.6 预登录：两阶段预检与一次性票据 ⚠️

**类型与目标**：`feature/security/protocol`。老师一键预登录前先看到全部阻塞，确认后只向合格终端发放绑定身份的一次性短票据。

**两阶段协议**：prepare 读取固定 assignment revision，校验 endpoint 在线、版本/capability、seat binding、用户绑定、Contest/ExamEvent 可进入性和不存在活动冲突，返回逐项诊断与 preparation fingerprint，不产生 ticket/启动命令。任一硬错误会阻止整批 confirm，USB/进程等告警只展示；教师修复或显式重建目标后重新 prepare。confirm 必须携带相同 fingerprint 并重新校验；命令开始投递后才允许业务级部分成功，保留成功项并为失败项形成精确重试集合。

**Ticket canonical**：绑定 eventId、assignmentRevision、uid、endpointId、目标 Client/workspace、issuedAt/expiresAt、nonce 和单次兑换 CAS；只保存安全摘要，明文只送目标 endpoint。重试不得为已成功兑换项再发新会话；失效、错机、错用户、重复兑换和活动变化 fail closed。

**权限/验收**：只有 event 管理者可 prepare/confirm；日志记录 batch/request/ticket ref/stage/result，不记秘密。覆盖响应丢失、并发 confirm、部分离线、过期和用户解除绑定。依赖 P1.15/P2.5，§4.4 + §4.5；部署前确认协议和真实命令范围。

### P2.7 Endpoint Service：拉起 Client 与预登录兑换 ⚠️

**类型与目标**：`feature/protocol`。Endpoint Service 接到经过授权的命令后拉起学生交互 Client，并让其安全兑换一次性票据直达正确工作台。

**执行链**：服务验证 P1.8 command envelope、活动/endpoint/ticket scope 和当前冲突，使用明确可执行文件路径与参数启动 Client；完整 ticket 不进入 Client、本机 IPC、可长期读取的命令行、日志或普通用户文件。Client 通过本机受限 IPC 只提交 ticketId 引用，由 Endpoint Service 经已认证连接领取材料、完成兑换并返回校验后的绑定 session/launch，随后打开 ExamEvent 关联的 canonical workspace。启动、进程就绪、兑换、页面就绪分别 ACK。

**失败与恢复**：可执行文件缺失、版本不兼容、用户 session 不可用、兑换失败和页面失败均回报具体 stage；不循环无限重启。教师只重试失败项；已成功项保持幂等。预登录不修改用户密码、不把凭据永久写入机器，也不允许 endpoint 选择另一个 uid。

**验收/部署**：Windows 服务无桌面 session/已有 Client/崩溃/重复命令/过期 ticket/错 endpoint 和重启；端到端证明直接进入目标工作台。依赖 P1.9/P2.6，§4.9 + §4.5，真实 Windows 发布前确认安装包、目标机和回滚。

**本地状态（2026-08-12）**：Server、Endpoint Service 与 Client 的 P2.7 实现、自动化门禁和两轴独立对抗性终审均已完成；未连接真实 Windows、远端或生产。真实 LocalSystem/WTS/命名管道、正式安装包和三端真实 E2E 仍属于部署确认，当前外部考试 workspace 继续沿 P2.6 canonical 明确 fail closed，不声称已完成外部工作台 E2E。

### P2.8 Endpoint Service：U 盘与进程检测告警 ⚠️

**类型与目标**：`feature/observability`。把已有/可复用监测能力置于常驻服务模块，在活动策略启用时只检测并报警。

**行为**：策略 revision 声明需关注的可移动存储事件和进程规则；Endpoint 模块产生带 eventId/endpointId/ruleId/timestamp/evidence summary 的告警，Vigil 持久化执行事实并推送 OJ 工作台。U 盘插拔和命中进程都不自动卸载、禁用、结束、锁屏或取消考试；UI 文案只能写“检测到/报警”。

**隐私与错误**：只采集判定所需设备类别/标识摘要、进程规范名/路径摘要和规则，不上传文件内容、命令行秘密或剪贴板。进程枚举/设备 API 失败单独报警为检测失效，不能当作“未发现”。规则热更新沿 P1.17 revision/ACK。

**验收/部署**：插入/拔出、启动/退出、重复去抖、白名单、权限不足、服务重启、离线补报、500 endpoint 事件量和跨活动 scope；教师页面区分违规告警与检测器故障。依赖 P1.9/P1.11，§4.9 + §4.5 + §4.4，确认后部署。

### P2.9 一键考试准备：分配、预登录与失败重试联调 ⚠️

**类型与目标**：`integration/ui`。把老师实际操作收束为一个清晰工作流：选择范围→生成座位→终端预检→确认预登录→只重试失败项。

**状态机/UI**：ExamEvent detail 明确展示 roster/assignment/policy/target/ticket 各 revision；每一步只在前置事实未漂移时可继续。默认主路径操作距离短、无需反复切页；诊断和高级明细按需展开但始终可达。确认页显示将影响的学生、座位、endpoint、策略、Client 版本和硬截止，成功/失败/未处理不能混为一个百分比。

**原子边界**：一键不是数据库事务或黑盒批处理；每台 endpoint 有独立可追踪结果，业务级部分成功允许精确重试，系统级 canonical/鉴权错误立即停止批次。活动启动后使用固定 target/assignment revision，不能因 userbind、座位或换机变化后台修正。

**验收/部署**：空班、座位不足、离线/旧版/错绑、部分启动、响应丢失、重复点击、教师换页恢复、500 人和外部考试无名单模式；成功终端不得被重试打断。依赖 P1.17 与 P2.5–P2.8，三端组合部署，切换前展示全范围并获确认；不上线时不连接生产终端。

### P3.1 题集：TrainingDoc canonical 与服务单写源

**类型与目标**：`schema/refactor`。把现有“训练”产品演进为“题集”，继续复用 `docType:40`、章节 DAG、题目成员、报名与进度，不创建第二套集合或复制存量数据。

**Canonical**：新建题集显式写 `kind:'problem_set'`；`kind:'course'` 只表示课程；无 `kind` 或旧 `kind:'training'` 的存量文档在共享服务读取时解释为题集。集中提供 `isProblemSet`、题集查询与写入 helper，handler 不再各自猜 `kind`；禁止请求路径回填、批量迁移和双写新集合。

**范围与不变项**：改动锚点为 `packages/hydrooj/src/model/training.ts`、`handler/training.ts`、`handler/course.ts` 及相关 resolver/test。现有 tid、章节、pids、先修关系、状态和做题事实保持不变；课程与题集即使共用 docType，也必须分别做类型和权限校验。

**验收/部署**：覆盖无 kind、旧 training、新 problem_set、course、跨类型伪造、列表/详情/编辑/文件和容器引用。与 P3.2 是不可拆上线单元；本任务按 §4.1 准备兼容源码，不能单独切换用户可见路由。

### P3.2 题集：`/problem-sets` 全站改名与旧路由跳转

**类型与目标**：`refactor/ui`。用户可见的“训练”统一改名为“题集”，canonical URL 统一为 `/problem-sets`，同时保住既有收藏、课程链接和文件深链。

**路由与 UI**：新增列表、详情、编辑和文件 canonical 路由与对应 ui-next 五件套；服务端内部 URL、面包屑、侧栏、首页、任务引用、通知与页面文案统一生成新地址。`/training` 及其详情/编辑/文件路径只做保持参数和锚点的明确 301/302 跳转，不注册第二套页面或 mutation。

**不变项/验收**：题集功能、权限、进度、章节、文件和题目顺序不变；旧 GET 深链跳到一一对应新 URL，旧 mutation 明确拒绝或转向唯一 canonical 写入口，不能发生重复写。覆盖未登录、无权、owner、历史链接、查询参数、深链刷新和导航 active。

**部署**：依赖 P3.1，P3.1/P3.2 经组合回归后同批 §4.1 + §4.4 上线；任一侧未就绪则不切换。

### P3.3 题集权益：发现范围与访问来源 canonical ⚠️

**类型与目标**：`feature/schema/security`。把“能否发现”“能否进入内容”“是否开始学习”拆为三个明确事实，支持公开、userbind 用户组、课程引用和兑换四类来源。

**Canonical**：共享 `ProblemSetAccessService` 返回带来源的 discovery/access 结论；来源是固定判别联合，不接受任意权限 JSON。公开和当前用户组成员关系动态生效；课程来源随引用与课程权限动态生效；兑换形成持久 entitlement。多个来源取并集并保留来源明细，撤销一个来源不能误删其它来源。`enroll` 只表示个人学习记录，不作为授权。

**强制边界**：列表、详情、阶段、题目跳转、附件/文件、IDE 上下文和直接 URL 都调用同一服务端判断；仅兑换可见的题集在兑换前不得泄漏标题、阶段或成员。GET 介绍页不写库，query/cookie/前端隐藏不能自证来源。

**验收/部署**：覆盖来源组合、加入/退出组、课程加删引用、兑换后离组、撤销单一来源、域隔离和资源枚举。依赖 P3.1，§4.4；上线新增权益 gate，需确认索引、权限和存量公开行为矩阵。

### P3.4 题集权益：列表、详情与显式开始学习 ⚠️

**类型与目标**：`feature/ui`。让学生清楚看到自己为什么能访问、哪些内容仍锁定，并只在明确开始时建立个人学习记录。

**行为/UI**：题集列表区分“可发现”“我的题集”和仅兑换后出现；详情展示公开/用户组/课程/兑换来源及整集/阶段锁定状态。公开或组可见题集点击“开始题集”后幂等创建学习记录；成功兑换自动创建或确认该记录，不要求再点一次。刷新、预览介绍和老师管理查看均不得隐式报名。

**错误与验收**：开始操作在服务端重查访问来源、题集状态和 revision；权限刚失效、重复点击和并发请求返回明确结果。覆盖空列表、多来源、仅兑换隐藏、已开始、撤销一个来源、窄屏/键盘/深链和无权限直链；不能把锁定阶段渲染成可点击空页面。

**部署**：依赖 P3.2/P3.3，§4.4，需确认新增学习记录 mutation 与可见范围；不迁移或重置既有进度。

### P3.5 题集权益：阶段解锁与 DAG 双门禁 ⚠️

**类型与目标**：`feature/schema`。阶段能否进入必须同时满足访问权益和既有 DAG 先修进度，兑换不能绕过学习顺序。

**Canonical**：阶段访问 entitlement 与阶段完成/先修事实分开。兑换一个阶段时，同一原子服务计算其传递先修闭包并授予这些阶段的访问权，但不创建 AC、不标记完成；进入目标阶段仍由现有 DAG 判断前置是否完成。UI 分别显示“未获得访问权”和“前置阶段未完成”。

**实现边界**：闭包只在发布的题集 DAG revision 上计算，检测环、失效阶段、跨题集引用和并发结构变化后 fail closed；运行时不靠前端 stage 列表。整集 entitlement 等价于所有当前可授予阶段的访问来源，但不复制为无界后台任务。

**验收/部署**：覆盖线性/分叉/多前置、环、兑换后题集编辑、已有部分权益、先修完成前后、直接 URL 和并发兑换。依赖 P3.3，§4.4，部署前确认 schema、索引与存量题集默认开放语义。

### P3.6 兑换码：权限、批次、摘要与原子兑换模型 ⚠️

**类型与目标**：`feature/schema/security`。建立专用兑换码子系统，支持单次码、限量通用码、长期/限时、批量生成、创建时手工码值，以及题集/阶段/课程三类受限权益。

**Canonical 与秘密边界**：`RedemptionCodeBatch` 固定一份权益定义，`RedemptionCode` 保存版本化的服务端密钥 HMAC 查找摘要、类型、上限、有效期、状态和使用计数，`Redemption`/`AccessEntitlement` 保存幂等结果；禁止对弱手工码使用可离线枚举的裸哈希。手工值只去除首尾空白，保留大小写和内部字符；拒绝空值、控制字符、协议不安全输入和域内重复，不做长度/熵强度门禁但明确警告。自动值使用 CSPRNG。明文只在创建响应中出现一次，不进库、不进日志。

**权限/生命周期**：创建者必须同时有新建兑换码权限和目标题集/课程 owner/管理权；全域管理员可管理全部。码值创建成功后永不编辑。首次成功兑换前可改目标、允许用户组、有效期、上限和备注；首次使用后目标/组冻结，只能改备注、延长有效期或提高上限。

**原子性/验收**：同一用户同一码幂等，单次码和总上限通过服务端原子条件更新，失败不得发出 entitlement；目标在创建、编辑、兑换和撤销时重查域/类型/状态。覆盖并发最后一个名额、摘要碰撞处理、过期、停用、删除目标、组限制和权限撤销。依赖 P3.3，§4.4，确认后建索引与权限位。

### P3.7 兑换码：创建、批量导出与管理工作台 ⚠️

**类型与目标**：`feature/ui`。为有权教师提供创建批次、一次性领取明文、查看使用情况、编辑允许字段和停用的正式工作台。

**页面/行为**：`/manage/redemption-codes` 按 capability 展示本人或全域批次；创建表单支持自动生成或手工填写，批量模式主要生成单次码。成功页必须明确“仅此一次”，允许下载带批次/目标/码值的 CSV；离开后只能查看摘要标识、状态和统计，不能恢复明文。编辑器根据是否首次使用严格锁定字段，停用前展示剩余码与已发权益不受影响。

**安全/验收**：导出响应 `no-store`、防止 secret 出现在 URL、analytics、异常和审计；权限在每个 handler 重查。覆盖创建者/全域管理员/无权用户、手工弱码提示、批量部分冲突整批失败、下载重试边界、首次使用前后编辑、搜索筛选和 CSV 注入安全。

**部署**：依赖 P3.6，§4.4，需确认新增秘密创建/导出入口；部署不创建任何生产兑换码。

### P3.8 兑换码：兑换、停用与单人权益撤销 ⚠️

**类型与目标**：`feature/security/ui`。学生可在全局入口兑换有效码；管理员能停止未来兑换或精确撤销某一用户的一项来源权益。

**兑换流程**：`/redeem` 在未泄漏目标元数据前接收码值，限速并规范化后调用 P3.6 原子服务；当下实时校验登录用户、域、允许 userbind 组、有效期、上限和目标。成功后原子建立兑换记录、entitlement 与学习记录，重复请求返回同一结果。离开允许组后既有兑换权益保留。

**停用/撤销**：停用码只阻止未来兑换，不追回历史权益。单人撤销必须选择明确用户、权益和兑换来源，预览其它仍有效来源并审计；首版不提供整批追回。撤销不删除提交、AC、学习记录或历史进度，也不能覆盖公开/用户组/课程/其它兑换来源。

**验收/部署**：覆盖猜码限速、并发兑换、跨域、组刚变化、过期、停用、目标删除、重复、单人撤销和多来源并存。依赖 P3.5–P3.7，§4.4，部署前确认权限、限速与精确撤销范围。

### P3.9 课程联动：引用题集/阶段与可信来源上下文 ⚠️

**类型与目标**：`feature/integration`。课程章节可引用整个题集或指定阶段，复用题集成员和权益，不复制 pids，并为真实性策略提供可验证的上下文链。

**Canonical**：课程章节保存受限引用 `{problemSetId, stageIds?}`；题集仍是阶段结构和成员唯一事实源，引用实时反映题集变化。现有课程直接挂题继续保留且不迁移。学生进入时服务端同时验证课程访问、引用关系、阶段成员、题集权益/DAG 和双方策略 revision，签发包含课程→题集链的 `PracticeContext`；query 不能自行声明来源。

**进度与生命周期**：从课程引用入口产生的合格 AC 同时更新当前课程和被引用题集；从题集独立入口不反向完成所有课程。移除引用只移除课程来源访问，不删除兑换权益、提交或进度。策略按 P1.7 逐项取更严格布尔 OR；VP 与 Contest 不进入该链。

**验收/部署**：覆盖整集/部分阶段、题集实时改动、引用删除、多课程引用、直接题、过期上下文、策略组合和一份 AC 双目标幂等。依赖 P1.3/P3.5/P3.8，§4.4，需确认课程 schema 与访问变化。

### P4.1 VP：资格、Attempt 与计时状态机

**类型与目标**：`feature/schema`。为已结束的个人编程赛提供一次正式虚拟参赛机会，与不限时赛后补题并存。

**范围/资格**：支持个人 ACM、OI、IOI、Ledo、Strict IOI，包括源比赛正式阶段配置 Vigil/`client_required` 的场次；排除 exam、homework、团队赛、主观题和人工评分。支持范围内新旧比赛默认允许，管理员可关闭；隐藏、学校、用户组、邀请码等 canonical 范围仍需满足。只能在全局结束后开始。

**Attempt 状态机**：`VirtualContestAttempt` 保存真实 uid、sourceContestId、规则/题序/时长/封榜偏移快照、startAt/endAt、状态和审计。用户确认后服务端原子立即开始，固定时窗取原 `end-begin`，弹性赛取原 duration，不预约、不暂停，可提前结束。每人每场最多一个有效正式 attempt；首份 VP 提交前可取消误开并重启，之后身份与起点锁定。

**验收/部署**：覆盖所有支持/排除 rule、范围权限、并发双开、取消前后、到时、提前结束、历史比赛和时钟边界。§4.1，`confirmBeforeDeploy:false`；只新增 dormant schema/服务，不自动创建 attempt。

### P4.2 VP：提交归属与多赛制独立计分 ⚠️

**类型与目标**：`feature/schema/security`。VP 提交必须显式归属 attempt 并按其规则快照计分，绝不污染正式比赛状态。

**Canonical**：VP Record 保存 `virtualAttemptId` 与 `sourceContestId`；提交入口重查 uid、pid 属于快照、attempt 活跃和相对时间。独立统计支持 P4.1 的各赛制及封榜偏移，不写源比赛 `ContestStatus`、正式榜单、Rating、RP、气球、虚拟打印、团队或 Vigil session。缺失/错配/过期上下文 fail closed，不猜作普通提交。

**个人做题事实**：Record 进入用户历史，AC 更新全局 ProblemStatus/题目统计，并可完成未启用真实性策略的课程/题集；不产生 PracticeContext，不能完成真实性容器。源比赛后续题面变化不重写快照，实际评测使用当前 testdata。

**验收/部署**：为每种 rule 建立与正式计分器的固定样例对照，覆盖封榜、重交、错题、越时、普通补题混用、正式参赛者和真实性容器。依赖 P1.4/P4.1，§4.1，确认后新增 Record 归属与统计索引。

### P4.3 VP：虚拟参赛工作台与信息隔离

**类型与目标**：`feature/ui`。赛后清楚提供“开始虚拟参赛”和“继续赛后练习”两个入口，并在活跃 VP 中营造自律计时环境。

**页面行为**：`/contest/:tid/virtual` 显示本人相对剩余时间、源题序和 A/B/C 状态；活跃时隐藏标签、难度、来源、题解、讨论、统计、关联比赛、正式榜单和其它 VP 状态，到时/提前结束后恢复正常赛后入口。普通题 URL 仍可能被主动打开，文案不得承诺强防作弊。

**Vigil 边界**：即使源比赛使用 Vigil/`client_required`，VP 也只是普通浏览器自律训练；不启动 Client、不建 Vigil session、不应用网络锁、进程/U 盘检测、座位、预登录或全站封锁。页面只复用题目、计分、时长和封榜语义。

**验收/部署**：覆盖未开始/活跃/结束/取消、刷新恢复、双标签、移动端、键盘、隐藏比赛、无资格和源 Vigil 比赛。依赖 P4.2，§4.4，`confirmBeforeDeploy:false`；不改变正式比赛页面的进行中安全边界。

### P4.4 VP：独立榜单、管理与显式重测 ⚠️

**类型与目标**：`feature/ui/ops`。VP 结束后提供完全独立的相对时间榜单和最小必要的管理、排错与重测能力。

**榜单/管理**：不同起点统一按各自相对时间计分，VP 行永不进入正式榜单；普通用户只能在本人结束后查看独立榜单，不能窥视他人进行中状态。管理员可查看进行状态、提前结束、作废和经二次确认重新开放资格，全部审计；不能直接编辑分数。

**重测边界**：源比赛“整题重测”默认只含正式比赛 Record。VP 只提供按精确 attempt/题目选择的独立重测，执行前展示 Record ID/数量/规则快照；不因 testdata 更新自动重写历史成绩或扫入所有 VP。

**验收/部署**：覆盖相对罚时、封榜显示、同分规则、权限、作废/重开竞态、正式重测排除和精确 VP 重测。依赖 P4.2/P4.3，§4.4，需确认管理 mutation 和实际重测范围。

### P5.1 Endpoint 更新：签名发布包与安全自更新 ⚠️

**类型与目标**：`feature/security/ops`。在硬 DDL 功能稳定后，为 Endpoint Service 提供受限、可验证、可回退的二进制更新，不允许下载任意程序执行。

**协议**：发布 manifest 固定版本、协议/能力、平台、包 URL、大小和强哈希，并由独立更新签名密钥签名；终端内置固定公钥验证 manifest 与包，更新密钥和日常控制命令密钥分离。包先下载到 staging、校验、验证最低/目标版本并由受限 updater helper 进行 side-by-side 切换；运行中服务不能覆盖自身文件。

**生命周期/恢复**：活动执行中禁止安装，只可预下载；切换后必须健康握手，失败回退 last-known-good 并上报明确 stage。只保留本站 Endpoint 的 Windows 安装/升级语义，不做通用包管理器、动态插件或任意脚本。密钥轮换、撤销和丢失必须有显式 runbook。

**验收/部署**：覆盖篡改 manifest/包、降级、断点下载、磁盘不足、重启中断、活动中命令、健康失败和回退。依赖 P1.8/P1.9，§4.9，发布前确认签名材料、包哈希、目标机和人工升级回退路径。

### P5.2 Endpoint 更新：灰度、回退与运维工作台 ⚠️

**类型与目标**：`feature/ui/ops`。让管理员按明确目标灰度发布，看到逐终端阶段并能停止或回退失败批次，不做无人值守的全量自动更新。

**Canonical/UI**：OJ 创建 UpdateRollout，固定 P5.1 manifest、目标终端快照、批次、窗口和 actor；Vigil 保存投递/下载/校验/待切换/已切换/健康/失败/回退执行事实。工作台先小批 canary，达到人工确认条件后才推进下一批；同一 endpoint 同时最多一个 rollout。

**安全与失败**：进行中 ExamEvent 的终端不可切换；取消只停止未开始项，已切换项显示实际版本。回退也是显式签名版本 rollout，不通过任意远程命令。页面不得把“已下发”显示成“升级成功”，失败集合可精确重试。

**验收/部署**：覆盖 canary 成败、部分离线、版本漂移、并发 rollout、活动冲突、取消、回退和 OJ/Vigil/服务重启恢复。依赖 P1.11/P1.16/P5.1，§4.9 + §4.5 + §4.4，三端切换前再次确认目标、窗口、安装包与回滚。

---

## 任务类型附加要求

### Bugfix

- 先证实根因与受影响全集，再改共享 canonical 边界；不能只处理用户碰到的一个实例。
- 回归测试至少要在修复前能失败、修复后能通过，并证明没有扩大权限或吞掉错误。

### Refactor / UI 重设计

- 先列功能、路由、operation、权限、数据和关键 DOM/交互基线；“功能不变”必须由矩阵验证。
- UI 优化同时考虑下一操作直线距离、所需滚轮距离和有效视口大小，但不能以压缩视口、隐藏信息或破坏可访问性换短距离。
- 使用真实登录态和用户现有浏览器做视觉/逻辑验收时，不新启动另一个浏览器；具体连接方式由执行会话按用户授权决定。

### Migration / 生产数据

- 固定顺序：备份并验证 → 只读 plan → 计数/差异/非目标哈希 → fingerprint → 展示命令并确认 → CAS apply → verify → 审计/报告。
- 业务 skip 与系统错误分流；系统错误立即非零退出，不得伪装成“跳过问题数据”。
- 不在启动或请求路径静默回填，不为一次迁移建设长期双读双写或后台恢复系统。

### 新协议 / 跨任务 schema

- 在下方建立“总体 Spec”，声明唯一 canonical、消费者、兼容策略、切换顺序和不可拆部署单元。
- 全部调用点和泄漏面审计后才允许切换；若生产不存在旧数据，明确选择一次切换而不是默认造兼容层。

### 运维 / 紧急生产修复

- 优先最短正确路径：只修用户指定对象和根因，完成 canonical 写入与必要验证后立即反馈；未经授权不顺手重测、重判或扩大数据范围。
- 紧急不等于跳过备份、三层一致性、明确命令或健康检查；可以省去无收益仪式，不能省去决定安全性的证据。

---

## 跨任务总体 Spec

### Rev.1 考试基础设施与 Endpoint 执行面

**Problem Statement**：现有网络锁依赖学生 GUI 短租约，Vigil 以共享凭据和内存状态为主，OJ 又没有可复用的外部考试、终端、座位和执行控制面；因此既不能独立服务 CSP，也无法安全扩展到预登录和现场告警。

**Canonical Solution**：OJ 保存 ExamEvent、教师权限、不可变策略/目标/名单/座位 revision 和业务审计；Vigil 保存逐机器凭据、连接、命令、ACK 与实际执行事实；Endpoint Service 是开机自启、逐机器认证、按编译期模块执行严格 schema 的 Windows 服务。三者只通过版本化、幂等、可追踪的窄协议协作。

**User Stories**：教师能在 OJ 创建无 Contest 的外部考试或关联 Krypton Contest，选择教室/终端/学生，预览并启用网络策略，看到每台机器的真实结果；后续可完成座位分配和预登录。现场断网仍执行到硬截止，并可用管理员提权的本机工具紧急恢复。

**Implementation Decisions**：域名/IP/CIDR/端口是网络锁能力上限；策略发布、目标、名单、座位和分配都用不可变 revision；动态条件在启用时编译成明确快照；部分终端失败保留成功项并精确重试；USB/进程只检测报警。站点规模不引入队列、分布式锁、通用 PKI 或动态插件。

**Security / Privacy Boundaries**：删除默认共享凭据并轮换；短期入网码仅注册，终端获得独立凭据；加密连接、服务端固定、命令有效期/防重放/活动 scope 必须同时满足。Endpoint 不执行任意命令，日志不含 token、学生密码、文件内容或剪贴板正文。硬截止和本机恢复不能被普通远程配置移除。

**Testing Decisions**：协议、模型和模块分别测，再用模拟多终端和至少一台真实 Windows 做断网、重启、DNS/IPv4/IPv6、端口、部分失败、重放、换机、热更新、回滚与硬截止端到端。500 台是上限场景，不用假想万人规模替代正确性测试。

**Atomic Deployment Unit**：P1.8–P1.12 组成独立网络锁 MVP；P1.13–P1.17 组成正式控制面；P2.2/P2.3 与三端配对协议须兼容后同批启用；P2.6/P2.7 和 P2.9 的预登录链必须同批可回滚。各任务独立审查/提交，部署按 Client → Vigil → OJ 或届时兼容矩阵执行，不得把半协议暴露给生产。

**Out of Scope**：Vigil Dashboard demo、实时 ClassSignin API、HTTPS 路径过滤、TLS 中间人、动态 DLL、远程 shell、自动阻止 USB/进程、无人值守全站二进制更新。

### Rev.2 真实性训练与可信提交上下文

**Problem Statement**：题目级全局禁粘贴会误伤 Contest，纯前端隐藏又能被独立提交页和普通题目入口绕过；现有全局 AC 也无法证明学生是在指定课程/题集规则下完成。

**Canonical Solution**：课程和题集分别发布不可变 `PracticeIntegrityRevision`，服务端签发绑定用户、题目、容器链与 revision 的短期 `PracticeContext`；有效策略逐项取更严格 OR。Record 和独立容器完成事实保存可信上下文归属，只有合格提交能完成启用真实性策略的容器。

**User Stories**：教师可让同一道题在课程中禁粘贴、比赛中正常粘贴；学生仍能在 IDE 键入、自测和提交，刷新可恢复隔离草稿；题面复制在指定上下文按作者标记注入隐藏文本；其它场景 AC 只提示“曾通过”，不冒充本课程完成。

**Implementation Decisions**：首版只做课程/题集默认策略，不做逐题/章节 override；移除的是独立提交表单，不是评测；所有外部代码注入入口统一拒绝；普通 IDE 共用修复后的 clipboard adapter。AntiAiMarker 属于 Problem，激活开关属于上下文策略；课程引用题集的一次合格 AC 幂等更新两个明确目标。

**Security / Privacy Boundaries**：前端限制只是威慑，服务端上下文和最终提交 gate 才是授权；不宣称阻止 DevTools、OCR 或手工重打。学生 DTO 不泄漏作者 canonical，标记不进入视觉、屏幕阅读器、打印/PDF或未启用策略的复制；日志只记上下文/策略/拒绝原因，不记代码或隐藏文本。

**Testing Decisions**：建立普通/课程/题集/嵌套/Contest/VP × student/author/verifier × paste/drop/import/IDE submit/direct submit 的矩阵，覆盖 revision 切换、草稿隔离、上下文过期和一份 AC 双目标幂等。JetBrains/Dev-C++ 用真实 Edge 再验证。

**Atomic Deployment Unit**：P1.3/P1.4 先建立服务端可信归属；P1.5–P1.7 必须在服务端 gate、学生 UI、作者标记和复制 serializer 全部兼容后共同启用策略。P3.9 复用同一上下文链，不新建另一套 token。

**Out of Scope**：浏览器级不可绕过防作弊、键盘模拟/OCR/截图封锁、题目级策略 override、追溯撤销既有完成、Contest 自动继承课程策略。

### Rev.3 题集、访问权益与兑换码

**Problem Statement**：现有 TrainingDoc 把发现、报名和访问混在页面行为里，无法表达指定组可见、按阶段解锁、兑换持久权益和课程引用；另建一套集合会复制章节、题目和进度并制造迁移风险。

**Canonical Solution**：在 docType 40 上将题集显式命名为 `kind:'problem_set'`，以共享访问服务计算公开、组、课程和兑换来源；个人学习记录独立。阶段进入同时要求 entitlement 与 DAG 进度。兑换子系统只授予题集/阶段/课程的固定权益，使用摘要秘密、原子兑换和可审计的精确撤销。

**User Stories**：教师能配置谁能发现题集、整集或分阶段解锁，创建/批量导出单次或通用码；学生在全局入口兑换并清楚看到访问来源和未满足的先修；课程可实时引用题集/阶段而不复制题目。

**Implementation Decisions**：旧 training 在读取时解释，不批量迁移或回填；`/problem-sets` 是唯一新 URL，旧路由仅跳转。兑换明文只在创建结果出现一次，码值创建后不可改；首次使用后权益语义冻结。停用码不追回权益，首版只支持精确单人撤销；组兑换在兑换时校验，成功权益以后不随离组收回。

**Security / Privacy Boundaries**：创建权限与目标管理权都必须满足；每个最终资源入口重算 canonical access，未兑换的隐藏题集不泄漏元数据。兑换码不进 URL、日志、analytics 或可恢复存储；猜码限速，计数与 entitlement 同一原子边界；撤销来源不删除其它来源、提交或进度。

**Testing Decisions**：覆盖存量文档、旧路由、来源组合、组变化、DAG 闭包、并发最后名额、批量明文导出、首次使用冻结、停用/单人撤销、课程实时引用和直接资源 URL。

**Atomic Deployment Unit**：P3.1/P3.2 同批切换命名与兼容路由；P3.3–P3.5 的授权服务先于 UI 开放；P3.6–P3.8 的模型、权限、管理与兑换入口在完整原子/限速链就绪后启用；P3.9 依赖真实性上下文和权益服务。

**Out of Scope**：第二套题集集合、存量批量迁移、兑换任意 Hydro 权限/脚本、在线支付、整批追回历史权益、课程复制题目、题集版本快照。

### Rev.4 个人赛虚拟参赛（VP）

**Problem Statement**：现有赛后补题没有空白成绩、固定时长和独立排名，直接复用 ContestStatus 又会污染正式榜单、Rating/RP 与 Vigil 状态。

**Canonical Solution**：`VirtualContestAttempt` 固定一次相对时间与计分规则快照；VP Record 显式归属 attempt/sourceContest，由独立统计与榜单读取。正式比赛、普通补题和 VP 是三条不同上下文，任何缺失归属都 fail closed。

**User Stories**：符合源比赛范围的用户可在比赛结束后选择一次计时 VP 或继续不限时补题；活跃 VP 只看自己的相对状态，结束后进入独立榜单；管理员能排查、结束、作废和精确重测。

**Implementation Decisions**：支持个人 ACM/OI/IOI/Ledo/Strict IOI，排除团队、考试、作业和人工题；每人每场一次，首份提交前可取消重开，不暂停。源为 Vigil 的比赛也能 VP，但 VP 永远是普通浏览器自律训练，不继承客户端或监控。AC 更新全局做题事实，但不进入真实性容器。

**Security / Privacy Boundaries**：VP 不绕过隐藏/学校/用户组/邀请码范围，不枚举隐藏资源；不写正式 ContestStatus、奖励、气球或 Vigil session。普通用户不能看他人进行中 VP；管理员 mutation 和重新开放资格全部审计。

**Testing Decisions**：所有支持赛制与正式计分器做固定对照，覆盖相对封榜、时间边界、并发开始、普通补题混用、源 Vigil 比赛、信息隐藏、正式重测排除和精确 VP 重测。

**Atomic Deployment Unit**：P4.1 建立 dormant attempt；P4.2 完成 Record/计分归属后才允许 P4.3 开放开始入口；P4.4 在独立统计稳定后上线。任何阶段都不得把 VP Record 混入正式榜单。

**Out of Scope**：团队 VP、考试/作业 VP、主观题、重复刷正式 VP、客户端 VP、模拟监考、正式奖励和自动重测历史 VP。

---

## Key decisions & tradeoffs

| # | 决策 | 选择理由 | 明确代价 | 被拒绝方案 | 关联任务 |
|---:|---|---|---|---|---|
| 1 | 当前需求登记在八月 PLAN | 当前日期是八月，DDL 可跨月 | 9 月 13 日/10 月事项仍在八月看板跟踪 | 另建九月看板 | 全部 |
| 2 | 正式 WebUI 放 OJ 管理区 | 复用教师身份、权限、userbind 与审计 | OJ/Vigil 需要窄控制协议 | 扩建 Vigil Dashboard demo | P1.13–P2.9 |
| 3 | ExamEvent 可脱离 Contest | CSP 等考试没有 OJ 题目 | 新增独立生命周期与权限模型 | 伪造空 Contest | P1.13–P1.17 |
| 4 | OJ 存业务事实，Vigil 存执行事实 | 避免双向配置冲突 | 需要版本化同步和 read model | 双向 last-write-wins | P1.11–P1.17 |
| 5 | Endpoint 使用逐机器凭据 | 共享 token 泄漏会失守全机房 | 需要注册、吊销和换机流程 | 共享长期 token / 硬件指纹认证 | P1.8–P1.12 |
| 6 | 断线保持锁到硬截止 | 控制面故障不能自动放开考试网络 | 必须实现可靠本机恢复 | GUI 45 秒续约或断线解锁 | P1.10–P1.12 |
| 7 | 网络锁只做域名/IP/CIDR/端口 | 系统层不能可靠识别 HTTPS 路径 | 路径级限制留给未来受控浏览器 | MITM/TLS 解密 | P1.10、P1.14 |
| 8 | USB/进程只报警 | 阻止与恢复复杂度不值收益 | 仍需监考人工处置 | 卸载设备、杀进程、内核策略 | P2.8 |
| 9 | ClassSignin 离线导入，userbind 管学生 | 用户只会提供数据库导出，OJ 已有身份体系 | 只做一次性部署迁移；未来变更另立受控任务 | 实时 API、常驻导入系统、导入第二套学生 | P2.1、P2.4 |
| 10 | seatId 是身份，label 只展示 | 主机名和座位名都不稳定 | 首次需人工配对 | 按主机名/label 自动猜 | P2.2、P2.3 |
| 11 | 真实性策略属于使用上下文 | 同题在课程禁粘贴、比赛允许 | 提交和进度需上下文归属 | Problem 全局 flag | P1.3–P1.7 |
| 12 | AntiAiMarker 存题面，策略决定激活 | 位置随题面编辑，是否注入随容器变化 | 需安全 serializer 与作者预览 | 直接塞零宽 Unicode | P1.6、P1.7 |
| 13 | 题集沿用 TrainingDoc | 保留章节、DAG、进度和引用 | 读取必须严格区分 course/problem_set | 新建集合并迁移 | P3.1–P3.5 |
| 14 | 发现、访问、学习记录分离 | 支持隐藏兑换、组可见、阶段锁和显式开始 | 授权判断更明确但调用点更多 | 用 enroll 充当权限 | P3.3–P3.5 |
| 15 | 兑换秘密只保存摘要、明文一次性导出 | 降低数据库泄漏风险 | 管理员丢失导出后不能恢复原码 | 明文持久存储 | P3.6、P3.7 |
| 16 | 停用与单人撤销分开 | 避免误伤已发权益和其它来源 | 不提供一键批量追回 | 停码即回收全部 | P3.8 |
| 17 | VP 有独立 Attempt/Record/榜单 | 保护正式成绩与奖励语义 | 新增独立统计链 | 写入 ContestStatus | P4.1–P4.4 |
| 18 | 源 Vigil 比赛的 VP 不用 Client | VP 是自律练习，不需正式赛公平性成本 | 不承诺强防作弊 | 创建 VigilVirtualSession | P4.1–P4.3 |
| 19 | 二进制自更新列 P5，不占近期 DDL | 配置热更新与 EXE 更新风险不同 | 硬 DDL 阶段继续人工升级 | 匆忙远程下载执行 EXE | P5.1、P5.2 |
| 20 | 小任务独立审查/提交，协议按单元部署 | 便于定位回归又不暴露半协议 | 需要明确兼容矩阵 | 巨型 commit 或临时兼容层 | 全部 |

## Risks / implementation watchpoints

| 风险/竞态 | 触发条件 | 影响任务 | 防线与验证 |
|---|---|---|---|
| 终端冒充或旧命令重放 | 共享凭据遗留、nonce/有效期未持久化 | P1.8–P1.12 | 凭据轮换、逐机认证、服务端固定、持久 replay gate、重放测试 |
| 网络策略 UI 与 WFP 实际语义不等价 | 端口、DNS、通配、IPv6 只写配置未落规则 | P1.10、P1.17 | 系统级黑盒连通矩阵和逐规则 applied fact |
| 断线/重启导致永久锁或提前解锁 | 状态未完整持久化、墙钟漂移、恢复绕过 | P1.10–P1.12 | 完整性校验、硬截止、本机提权恢复、跨重启测试 |
| OJ/Vigil 事实漂移 | 重试、响应丢失或双向写配置 | P1.11–P1.17、P2.6–P2.9 | immutable revision、requestId、逐端 ACK、只由 OJ 写业务 canonical |
| 布局再导入破坏生产绑定 | seatId 删除/重用、按 label 猜映射 | P2.1–P2.5 | fingerprint/diff/CAS、引用保护、非目标哈希、冲突即停 |
| 预登录票据落入日志或错机兑换 | 放命令行、宽 scope、重复 confirm | P2.6、P2.7 | 摘要存储、本机受限 IPC、endpoint/uid/event 绑定、单次 CAS |
| 真实性模式仍有旁路 | 只隐藏按钮，独立提交/普通上下文可冒充 | P1.3–P1.7、P3.9 | 服务端 PracticeContext 与容器完成事实，缺失上下文 fail closed |
| 防 AI 标记污染正常内容或泄漏 | serializer 混用、标记进入投影/PDF/ARIA | P1.6、P1.7 | client-safe 表示、复制专用注入、视觉/打印/辅助技术矩阵 |
| 存量题集被误迁移或课程串型 | handler 按 docType 不验 kind | P3.1–P3.4 | 集中类型 helper、无请求回填、跨类型负向测试 |
| 兑换码超发或可恢复明文 | 并发计数、日志/URL/CSV 处理不当 | P3.6–P3.8 | 原子条件更新、摘要、no-store、日志清洗、并发末名额测试 |
| 撤销一种权益误删其它来源/历史 | 只存最终布尔访问结果 | P3.3、P3.8 | 来源化 entitlement、精确来源撤销、提交与进度不可删除 |
| VP 污染正式成绩或真实性进度 | Record 缺显式归属、复用 ContestStatus | P4.1–P4.4 | virtualAttemptId 强制 gate、独立统计、正式重测默认排除 |
| 活跃 VP 泄漏正式信息 | 共用普通比赛 DTO/讨论/榜单 | P4.3 | 专用 client-safe serializer、资源/深链负向矩阵 |
| 自更新成为远程执行入口 | 未签名 manifest、脚本化安装、降级 | P5.1、P5.2 | 独立签名钥、固定公钥、强哈希、版本 gate、side-by-side 回退 |
| partial index 在生产静默失败 | 使用 Mongo 不支持的表达式且框架 catch | 所有 schema 任务 | 本地按生产版本验证，部署后查 ensureIndexes 日志与实际索引 |

## Out of scope（本月明确不做）

- 不使用或扩建 `ecosystems/KryptonVigilSystem/Dashboard` demo；正式 WebUI 只在 OJ。
- 不实时连接 ClassSigninSystem/码上坐，不导入其学生、班级、课程和签到历史；等待用户提供数据库导出后才执行 P2.1 生产 apply。
- 不建设 HTTPS 中间人、证书注入或 URL path 白名单；网络锁不承诺浏览器内容级过滤。
- 不实现动态 DLL 插件、任意远程命令、企业通用 PKI、消息队列、分布式锁或万人规模调度。
- U 盘和进程只检测告警，不卸载设备、修改系统驱动、杀进程或引入 AppLocker/WDAC。
- 不要求每场打印/保管紧急恢复码；不设置硬编码万能密码。
- 真实性训练不承诺阻止 DevTools、OCR、截图、手工重打、虚拟机或外接自动输入；不做逐题/章节/阶段策略 override。
- 不把真实零宽长文本直接写入可见题面，不让防 AI 文本进入打印、PDF、ARIA 或普通上下文复制。
- 不新建第二套题集集合、不迁移/回填存量 TrainingDoc、不复制课程引用题集的 pids。
- 兑换码不授予任意 Hydro 权限、脚本或管理员能力；不做在线支付、整批追回、明文找回或创建后改码值。
- VP 不支持团队赛、exam、homework、主观题、人工评分、重复正式 attempt、正式奖励或客户端监考。
- 近期网络锁 DDL 不包含 Endpoint 二进制自更新；P5 完成前继续用可重复人工升级流程。

## Open questions / 真实分叉（锁定时必须清零）

无。ClassSignin 生产数据库导出的实际格式属于 P2.1 的必需实施输入；文件尚未提供只会阻塞该任务的生产 apply，不构成需要预先猜测的产品分叉。

## 上月结转登记（不自动继承）

| 七月任务 ID | 七月状态 | 八月处理 | 八月任务 ID / 说明 |
|---|---|---|---|
| — | — | 不自动结转 | 本计划 41 项均来自本轮新增需求；七月 PLAN 与看板保持历史事实源，用户未来若明确结转再追加 revision。 |

---

## 附 A：看板数据契约（tasks.js）

```js
// docs/plan-2026-08/tasks.js — 执行会话按 R4 更新。
window.KRYPTON_PLAN_TASKS = {
  updatedAt: "2026-08-09T15:32:41+08:00",
  planFile: "docs/PLAN-2026-08-09-monthly.md",
  planStatus: "locked", // draft | locked
  tasks: [
    {
      id: "P1.1",
      title: "IDE：兼容 JetBrains 剪贴板粘贴",
      urgency: 1,
      size: "S", // S | M | L
      deps: [],
      deadline: "尽快",
      deploy: "§4.4",
      confirmBeforeDeploy: false,
      status: "todo", // todo | doing | verifying | done_local | deployed | blocked | cancelled
      outcome: "普通模式可稳定粘贴不同 IDE 复制的代码，同时严格尊重真实性上下文的禁粘贴策略。",
      note: "",
      updatedAt: null,
    },
  ],
};
```

一致性门禁：

- `tasks.length` 等于本文总表和详细 spec 的任务数；
- ID、标题、紧迫度、预估、依赖、部署类型、确认标记逐项相同；
- `deadline` 与总表 DDL 相同，`outcome` 只描述用户可验证效果，不能把技术动作或未上线结果伪装成交付；
- 依赖 ID 必须存在或使用完整跨月引用，且图无环；
- `cancelled` 条目保留，不能删除后复用 ID；
- 计划仍为 `draft` 时不得把任何占位任务写入 live `tasks` 数组。

## 附 B：新增任务时的同步清单

1. 原始需求与用户用语已保存；
2. 实际代码/生产只读事实已核查；
3. 真分叉已问清，机械细节由 Agent 决定；
4. 总表增加一行；
5. 详细 spec 按模板补齐；
6. `tasks.js` 增加同 ID 条目；
7. ui-next 新页面契约（如适用）已登记；
8. 依赖、原子部署单元、红线、风险、Out of scope 已同步；
9. 顶部任务总数、revision、更新时间已更新；
10. 锁定前已清除所有占位符并完成计划对抗审查。

## 附 C：新会话 kickoff prompt

### C1 日常推进

```text
读 /Users/motricseven/Krypton/AGENTS.md、
/Users/motricseven/Krypton/CLAUDE.md、
/Users/motricseven/Krypton/docs/PLAN-2026-08-09-monthly.md（八月任务唯一事实源）
和 /Users/motricseven/Krypton/docs/plan-2026-08/tasks.js（任务状态唯一事实源）。

如果 PLAN 仍是 draft，停止实现，只告诉我还缺哪些锁定项。
如果已 locked，先把当前未完成任务按批次列成清单：id/标题/紧迫度/预估/依赖/状态/是否需部署确认；不要开始做事，等我选。

我选定后严格执行对应 spec 和 R1-R5。只有任务完整实现和测试完成后才启动对抗性验证 Agent；按意见修复并换新 Agent 复审直到闭环。状态变化立即更新 tasks.js。PLAN/看板不进 git，源码逐路径 add；按 R2 创建任务级本地英文 Conventional Commit，不 push。没有明确部署授权则停在 done_local；生产变更严格走 CLAUDE.md §4 和对应 runbook。
```

### C2 指定任务直开

```text
读 AGENTS.md、CLAUDE.md、docs/PLAN-2026-08-09-monthly.md 和 docs/plan-2026-08/tasks.js。
直接开始做 <任务 ID>；若 PLAN 未 locked、依赖未完成或任务属于尚未就绪的不可拆单元，先停下来报告。
严格遵守该任务 spec 与 R1-R5。未明确说部署时不要部署；不要 push。
```

### C3 给老师的进度汇报

```text
读 docs/PLAN-2026-08-09-monthly.md 和 docs/plan-2026-08/tasks.js，生成面向老师的中文进度汇报：按批次列出已上线、待部署、进行中、阻塞和未开始；每项只写可验证效果，不提内部文件路径，不把 done_local 写成已上线。
```

### C4 继续填计划

```text
读 docs/PLAN-2026-08-09-monthly.md、七月 PLAN 与两个 tasks.js。
这次只补充/修改八月 PLAN 和看板，不实现、不提交、不部署。先核查代码和必要的生产只读事实；机械细节替我决定，只有会改变产品/数据/权限/兼容策略的真实分叉才问我。每项都补齐总表、详细 spec、依赖、验收、部署类型和 tasks.js。
```

---

## Revision log

- `Rev.0`（2026-08-09）：基于七月 PLAN 的实际结构建立八月空白框架；尚未录入、审查或锁定任何任务。
- `Rev.1`（2026-08-09）：完成八批 Grill 与代码现状核查，锁定 41 项任务、四套跨任务 canonical、DDL/依赖、R1–R5、部署确认门和八月本地 Dashboard；用户明确要求当前只生成计划，不授权实现、提交或部署。
