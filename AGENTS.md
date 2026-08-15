# Krypton Agent Rules

## 全局工程规则

1. **Fail Fast / Errors Never Pass Silently**：不要用兜底逻辑吞掉错误或隐藏问题。错误必须明确暴露，并保留足够上下文供定位。
2. **Fix the Cause, Not the Symptom / Don't Paper Over Bugs**：必须定位并修复根因，不得用针对性补丁掩盖问题。
3. **Make It Observable**：关键流程必须有充分日志和可观测性。信息不足时，应补充日志并如实说明，不得假装已经修复。
4. **Design for Debugging / Traceability**：关键节点和外部写入必须可追溯，能够确认执行到了哪里、写入了什么以及验证结果。
5. **Living Documentation / Single Source of Truth**：关键技术栈、产品方向或固定工作流变化时，同步更新本文件和对应的唯一事实源，避免文档与实际实现脱节。

## UINext TypeScript 与测试约束

- `packages/ui-next` 使用严格 TypeScript，`noImplicitAny` 必须保持开启；`src` 禁止新增显式 `any`，不可信输入先使用 `unknown`，再通过真实的结构判断或生产者协议收窄。
- `KryptonPage.data` 是外部 bootstrap 边界，canonical 类型固定为 `unknown`。每个页面应在消费入口声明自己的最小 payload 接口，不得恢复全局 `Record<string, any>` 或用双重断言绕过建模。
- UINext 的 `tsconfig.json` 与根 `tsconfig.ui-next.json` 都由 `build/prepare.js` 生成；类型门禁只能修改生成器，禁止只改生成产物造成下次安装后回退。
- UINext 测试统一使用 Vitest；不得恢复 `node:test` 或 Chai 独立导入。覆盖率阈值是当前实测下限的 ratchet，只能随覆盖率增长而提高，不得用降阈值掩盖回归。
- 功能不变的类型重构至少验证包级与根 UI TypeScript、全量 ESLint、Vitest、覆盖率和生产构建。源码文本契约只约束真实行为表达式，不得绑定可擦除的类型别名或注解。

## 知识导图 schema 约束

- canonical 模型为 `mindmap.maps` 中的一等导图记录、`mindmap.nodes.mapId` 和 `document.knowledgeMapId`；不得恢复 `_id:'global'` 单例配置或无 map scope 的读写兜底。
- P2.28 多图源码与 P2.29 全量归属迁移是不可拆部署单元。现存单图节点和 Problem 只允许通过 P2.29 的备份、只读 plan、fingerprint、CAS apply/verify 流程迁移，禁止在启动或请求路径中静默回填。
- 节点创建、移动、排序、删除、引用保护和题目搜索必须显式限定 `mapId`；发现 Problem 的 `knowledgeMapId` 与节点归属不一致时 fail closed。
- 课程仅通过可选 `TrainingDoc.mindmapId` 引用一张公开导图，不拥有或复制导图节点。课程可继续引用其它导图或无节点题；课程导图视图只能投影课程章节内、当前用户可见且 canonical 节点直接属于该图的题目。

## 结构化代码单源码协议

- `StructuredCodeTemplate.source` 是唯一完整源码；`publicRanges` 是显式公开整行区间，`regions` 是原位作答区，剩余行默认私有。公开区和作答区必须互斥，禁止把未标记行自动公开。
- region 顺序只按 `(startLine,endLine,id)` 由服务端派生，不接受或持久化独立 `order`；代码实现题 region 只有可选 `title/description`，不恢复必填函数签名。
- 学生响应只能由共享 serializer 生成按源码顺序的公开 code block 与 region descriptor；不得下发完整 `source`、`sourceHash`、原始坐标、标准答案、cases、私有行或隐藏数量。
- 作者端源码变更只使用 CodeMirror change mapping 更新整行区间；整体删除、交叠或无法确定的映射必须显式失效并阻止保存，不得靠附近文本或旧 anchor 猜测恢复。
- P3.21/P3.22/P3.23 是不可拆部署单元；生产唯一旧函数草稿只能经过备份、只读 plan、确认、精确迁移和 verify 后切换，不维护旧协议双读双写。

## 防 AI 标记协议

- `ProblemDoc.antiAiMarkers` 是隐藏复制提示的唯一 canonical 元数据；题面 Markdown/结构化题面正文不得写入真实零宽字符或隐藏文本。标记保存稳定 ID、题面字段路径、UTF-16 边界、亲和方向、短上下文和独立 revision。
- 标记与题面必须通过同一授权写入口和 `structureRevision` CAS 保存。浏览器只做确定性的单次编辑映射；删除、替换跨过边界或上下文不一致时必须阻止保存，禁止按邻近文字猜测恢复。旧题第一次添加标记只允许显式 expected revision `0` 的单题 CAS，不做批量回填。
- 作者端可读取完整标记并显式预览学生题面与复制结果；普通公开投影、比赛投影和学生题面不得包含内部上下文、亲和方向或 revision。学生端只有在当前真实性 Context 的 `antiAiCopyInjection` 生效时才能收到最小安全视图（ID、路径、位置、注入文本）。
- P1.6 仅定义标记 schema、作者维护和安全 serializer；实际 copy/cut/selection 注入属于 P1.7。未启用策略的普通题目复制行为必须保持不变，打印/PDF、屏幕阅读器和正常视觉渲染不得出现隐藏文本。

## 结构化编程题面协议

- 网页新建的编程题使用 `statementFormat:'structured-v1'` 与 `programmingStatement` schema v1；canonical 固定为 `zh-CN` 的背景、描述、输入、输出、样例和总提示，区块顺序不可配置，时空限制只读取实际评测配置。
- `programmingStatement` 是结构化题面的唯一写入源；`content` 只能由服务端 compiler 在同一次 revision/CAS 写入中生成。任何直接 content 写入、未知字段/schema、canonical 与投影不一致或校验钩子改写都必须 fail closed。
- 草稿可保存 `undecided`；发布或加入正式容器前必须确认所有区块状态、非空描述、合法有序样例和有效时空限制。样例只接受服务端按数组顺序生成的严格 `inputN/outputN` 配对。
- 学生端只消费 client-safe serializer；普通题目、比赛和 Exam Mode 共用同一结构化视图，IDE 直接读取安全样例数组。不得下发作者 canonical 或把样例自动当作正式 testdata。
- 无 `statementFormat` 的既有题保持 legacy 行为。旧题转换必须由操作者显式发起，以当前 revision 与原文 fingerprint 一次性 CAS 写入；未归类内容非空时拒绝，转换后不得退回自由 Markdown。
- P2.23 schema v2 新导入必须同时提供 canonical JSON 与等值 Markdown 投影；schema v1 仅可 verify。原始 Hydro/ICPC 包显式保存为 `legacy-import-v1`，禁止请求路径回填或批量静默转换。

## 题号命名空间协议

- Problem 归属只认显式 `pidNamespaceId`；运行时不得从 PID 前缀推断、补写或修复命名空间。P2.38 源码与 P2.39 全量迁移是不可拆部署单元。
- 内置命名空间固定为 PAT 乙级、PAT 甲级、自命题 P5、牛客、HDU、天梯赛和 CAUC；内置编号规则不可改删。自定义命名空间仅支持大写前缀加四位数字，首次分配后前缀和起始编号永久锁定，只能停用或重新启用。
- 自命题 P5 在具备基础出题权限时默认可用；其它命名空间必须同时具备基础出题权限与该命名空间 author/manager 授权，`PERM_CREATE_PROBLEM` 不得绕过 namespace gate。
- `author` 只控制该命名空间的新题创建，`manager` 只增加普通出题人并审核/退回/发布隐藏托管题，`editAll` 独立控制该命名空间全部题目的内容、数据、配置和元数据维护。manager 不隐含 editAll；仅全站管理员可授予 manager 或 editAll。
- editAll 不得绕过比赛/考试进行中保护、归档保护、首次提交结构锁、结构 revision/CAS 或专用发布流程；撤销 namespace 授权只影响后续 namespace 能力，不回收既有 per-problem 角色。
- P2.39 迁移只允许按备份、只读 plan、计数与非目标哈希、SHA fingerprint、人工确认、CAS apply、verify、审计顺序执行；禁止请求路径静默回填或修改未在计划中精确列出的题目。

## 团队 ACM 赛前组队协议

- `contest.teamBatches`、`contest.teamBatchTeams`、`contest.teamBatchInvites` 只承载比赛创建前的组队协作；每名用户在同一开放批次最多属于一支 1–3 人 active 队伍，关闭批次后所有阵容写入冻结。
- 团队比赛可先通过 `plannedTeamBatchId` 预绑定同域开放或已关闭批次；预绑定只用于赛前管理预览，不创建临时 ContestTeam，也不参与任何运行时授权或计分。批次关闭后，管理员必须在比赛开始前、无 Record、无既有 active ContestTeam 时显式定版，整批校验后生成新的 `contest.teams` 快照并写入 finalized `teamBatchId`、清除 planned 引用。任一成员不符合目标比赛的 `assign`、`participantScope` 或账号参赛权限时整批拒绝且清理本次准备态；`_code` 是开赛入口凭据，不在赛前快照时自动代领。
- 本站单 Hydro 进程通过同一 contest 级轻量边界串行化快照激活、ContestTeam 写入及运行时队伍读取，保证多文档快照不会以半批状态对应用可见；禁止新增绕过该边界的 active team 游标或直接写入口，也不为此引入 Mongo 事务、队列或分布式锁。
- 计分、提交授权、榜单、Vigil 角色、Record 和虚拟打印只读取比赛内 finalized `ContestTeam`；存在 planned 引用但尚未定版的团队赛必须以 `team_batch_not_finalized` fail closed。禁止运行时回查批次、复用批次 teamId、自动同步或把赛内修正反写批次。一个关闭批次可用于多场比赛，但每场必须生成独立 teamId 与 snapshot hash。
- 本节的“P1.17”是团队 ACM 旧计划编号，不是 `docs/PLAN-2026-08-09-monthly.md` 中“网络锁正式控制面”的 P1.17。该旧任务不修改 Vigil Server 或 Client，不需要迁移或回填历史比赛与队伍；部署只加载 OJ/UI 源码及等值 partial/普通索引，不得顺带创建批次、绑定比赛或连接 Windows 主机。
- 赛前就绪检查只允许管理员按需执行，复用定版的 canonical 阵容校验并返回聚合诊断；结果不是授权令牌，不能缓存、自动修复、自动关批或自动定版，实际定版必须重新校验。

## Vigil 普通浏览器封锁协议

- `client_required` 比赛入口 gate 与普通浏览器全站封锁是两条独立边界；前者始终要求当前比赛的有效 Client session，后者只能封锁 canonical 受众。学生 GUI 每次显式启动都必须先经固定本机 IPC、当前 Endpoint Service 连接和 OJ canonical 重新查询 active seat binding；bound 才能显示原有学号/姓名登录界面，unbound 只显示座位码输入，查询不可用或畸形时 fail closed。Vigil Server 在普通登录、预登录兑换以及任何实际创建、恢复或人工批准 ExamSession 的写边界都必须独立重查同一 binding，不能信任 GUI 门禁或较早的审批事实。Windows 开机只启动 Service，不得自动弹出 GUI；本机不缓存 seatId，也不得让未绑定 endpoint 建立考试会话。
- 有效 Client session 只是其绑定比赛工作台的能力凭证，不是主 OJ 的全站通行证。该会话只允许绑定域和 `tid` 的 `/exam-mode/:tid`、`/paper/:tid` 及携带同一 `tid` 且由下游再次校验的提交、题面附件和评测轮询端点；访问首页、全站记录、其它域、其它比赛或其它 `tid` 必须保留会话并重定向回绑定工作台。路由拦截必须在 `handler/before-prepare` 阶段完成，既不执行被拒绝路由的数据准备或业务逻辑，也不得在 Hydro 建立 handler 前直接返回导致重定向被改写成 500。该约束先于管理员旁路，管理员只有在普通浏览器 session 中才可旁路；考试壳内普通 HTML 表单的 4xx 错误不得退回主 OJ 壳。
- 显式学校、用户组或 legacy `assign` 受众在封锁窗口内提前封锁；邀请码继续要求 `ContestStatus.attend`。真正不限参赛的个人赛只封锁已经通过 Client 入场且存在 `attend` 的用户，不得再把域内全部已绑定学生视作受众。
- 团队赛只封锁未处于批次待定版状态且属于 active `ContestTeam` 的成员；不得用不限范围、预绑定批次或运行时批次回查扩大受众。
- Client 自动 attend 成功后必须立即精确失效 `(domainId, uid)` 封锁缓存并记录审计；团队定版、建队和成员变化必须在仍持有同一比赛轻量边界时同步失效对应域缓存，再执行邀请清理或 Vigil 网络调用。任何失效都要推进进程内 generation，禁止并发旧计算重新写回；退出 Client 不清除 attend，也不在窗口结束前恢复普通浏览器。不得为此新增数据库状态、后台任务或 Client/Vigil Server 协议。

## Vigil 逐终端身份与命令协议

- OJ 的 `endpoint.registrations` 保存完整 machine fingerprint 与确定性 endpointId 的不可变一对一登记；历史 `endpoint.enrollmentBatches` 仅保留既有随机 endpoint 的 ownership 兼容，不再是安装或恢复入口。Vigil Server 保存逐终端公钥和状态；Windows 每次本地身份状态丢失后重新生成不可导出的 CNG machine key，并用稳定硬件摘要恢复既有 endpoint。Windows `machineId` 只允许由 SMBIOS System UUID（优先）或物理有线网卡永久 MAC（回退）确定性派生，禁止使用 Ghost 会复制的磁盘卷序列、MachineGuid、ProductId 或主机名兜底；没有硬件级来源必须拒绝登记。新 endpointId 由完整 machine fingerprint 确定性派生；既有随机 endpointId 不迁移，Vigil 通过 active machine fingerprint 唯一映射恢复原 endpointId。恢复只允许原地更新同一 active endpoint 的公钥并推进 credential revision，revoked/replaced/pending 身份不得自动恢复；Vigil 仍存在未到硬截止且可能已送达的网络策略、又没有之后成功 stop 事实时必须暂缓恢复，防止整盘还原后的终端以同一 endpoint 身份无锁上线。未知 machine fingerprint 由 Vigil 先经 service-token 让 OJ 幂等确保确定性登记，再创建同一 active credential；OJ 不可达、登记响应畸形或任一唯一性冲突时保持不可考试状态。当前机房部署明确接受 machineId 可被知情者伪造的风险；CNG 私钥证明只证明本次启动密钥持有，不把硬件摘要提升为不可伪造的密码学认证。Vigil 与 OJ 都对 active/登记硬件摘要实施唯一约束，重复硬件摘要不得生成第二个 endpoint。
- Endpoint WebSocket、截图上传和后续终端写入口只接受活动逐机凭据的短期签名证明；共享 `client_token`、空配置开放、裸 `ws://` 和只靠硬件指纹的兼容路径均禁止。客户端必须使用 `wss://` 并固定部署证书的 SPKI SHA-256；证书或固定值不匹配时 fail closed。
- Server 下发的能力命令必须是版本化 ES256 envelope，精确绑定 endpoint、activity、command、revision、签发/过期时间和显式能力名称。客户端在执行前持久化每个 activity 的最高 revision；重放、过期、错 scope、未知 schema/命令或签名失败均不得执行。协议没有 shell、脚本、任意可执行文件或任意文件写入能力。
- 新安装不创建入网批次、短码或 replacement 批次；硬件更换通过新机器的确定性登记、座位绑定换机确认与旧 endpoint 显式吊销完成。终端吊销仍只允许 `PRIV_EDIT_SYSTEM`。日志可记录 endpoint、machine fingerprint 摘要、credential revision、stage/reason，但不得记录私钥、公钥签名、token、旧完整入网码或剪贴板/文件正文。
- P1.8 只建立身份、入网、加密固定、签名命令格式和持久 replay gate；不提前实现 P1.9 的服务常驻控制连接、P1.10 的网络策略或 P1.11 的逐命令执行会话/ACK。P1.8–P1.12 是不可拆生产协议单元，独立本地提交不授权部署或连接真实 Windows 主机。

## Endpoint Service 协议边界

- Windows 常驻进程固定为 SCM 自启动的 `Krypton Endpoint Service`；沿用既有内部服务名以支持原位升级。Endpoint Service 独立持有逐机器长期身份、建立 `/api/ws/endpoints/:endpointId` 常驻连接并上报精确版本与 capability；学生 GUI 只能通过本机严格 schema IPC 请求既有 WebSocket 登录或截图上传所需的短期签名，不能直接打开长期私钥。GUI 与 Service 的短签名必须绑定不同的精确用途，禁止跨路由复用。
- Endpoint Service wire protocol 2 要求 hello/heartbeat 上报当前网络策略状态，并要求 command result 回显签名活动与命令 revision；protocol 1 只允许被严格解析并持久记录为 incompatible，不得进入命令平面。最低 Service 版本为 0.3.0，协议版本与最低版本在握手时 fail closed。Server 只能向终端已明确公布且版本精确匹配的 capability 下发命令；终端只通过编译期静态注册表分派严格 schema 命令，禁止动态 DLL、脚本、shell、任意程序启动或通用文件写入。模块尚未真实实现时不得发布空 capability；P1.9 只公布 `endpoint.status@1/ping`。
- 凭据换机或吊销必须在同一 endpoint 边界内同步关闭旧 GUI 与 Endpoint Service 连接；每条已建立连接仍逐消息重查当前 credential revision。重复连接只保留最新连接，协议不兼容终端必须出现在只读运维列表中并带稳定原因。
- Endpoint Service 的 TLS probe、WebSocket Upgrade 和 hello 协商必须异步且各自有硬截止；SPKI 匹配前不得生成或发送签名证明。双端协议只接受严格文本 JSON object，签名命令顶层与 integrityProof 也必须 exact-key，二进制、畸形、未知字段或未知消息一律 fail closed。Endpoint Service 与 GUI 使用独立的持久防重放游标；Windows 普通用户 GUI 不直接读写管理员状态，而通过受信本机 IPC 由 Service 校验并提交自己的独立游标。日志只记录 endpointId、版本、capability、commandId 和 stage，不记录签名、入网码、token、代码或截图正文。P1.8–P1.12 是首个不可拆部署单元；完成单项本地实现不得提前连接或切换真实 Windows 主机。

## Endpoint 持久网络策略协议

- `network.policy@1` 只接受编译期固定的 apply/status/stop 三种严格命令。apply 的签名 payload 必须精确绑定 activityId、单调 policyRevision、targetEndpointId、startAt、hardEndAt，以及仅含 hosts/ips/ports 的策略；同一时刻只允许一个持久活动，热更新不得改变活动时间窗。网络命令必须按“签名与语义预验、持久 pending、提交 replay、执行 WFP”顺序处理；active 只允许 revision 精确等于防重放游标，只有已完整验签且语义可重建的 pending 可在崩溃恢复时采用严格更高的已签名 revision（允许跨过未提交的拒绝命令），禁止相等、回退或从非 pending 状态推进游标。Server 对成功结果必须按 commandId 与命令类型之外，再精确核对 apply 的活动、revision、时间窗和策略；stop 结果必须回报被释放的活动与 revision，不能用另一活动的状态冒充成功。
- Service 是持久锁唯一 owner；GUI 短 lease 与持久活动冲突时 fail closed。控制面断线或 Service 停止不得解锁，恢复时先验证签名状态再恢复规则；释放只允许匹配当前 revision 的签名 stop、硬截止或提升后的本机管理员 recovery。首次清理失败必须保持可观测的 release_pending 并重试，不得谎报 inactive；硬截止同时使用绝对 UTC 与本次进程的单调时钟，避免墙钟回拨延长活动。
- 策略语义只包括精确域名、前导整标签通配域、IPv4/IPv6、IP/CIDR 与全局目标端口；不支持 URL path、MITM 或证书注入。Windows 规则必须以同一 WFP transaction 替换，许可地址与端口显式做笛卡尔积；DNS 只通向当前系统 resolver，DHCP 只通向协议所需广播/组播目的地，隐式 Vigil 控制面只允许 Endpoint Service 可执行文件使用，最终 v4/v6 block 为硬阻断。域名依赖 Windows Firewall Dynamic Keyword/Network Protection 的 DNS 观察；未解析主机保持阻断，并在 status/log 中明确报告。
- Endpoint Service 信任的控制面地址、SPKI、公钥、网络状态、Service 防重放游标与由 Service 代管的 GUI 独立游标必须位于独立的 `%ProgramData%\KryptonVigilMachineTrust`；普通 GUI 的 `config.kvs` 继续留在共享配置目录且只承载普通本机设置，不得成为 Service 或 GUI 的 endpoint 身份信任输入。GUI 每次启动必须从固定路径、LocalSystem 的 Service 严格 IPC 取得 client-safe endpointId、控制面和命令公钥投影并覆盖共享配置中的同名字段；Service 不得向用户可控共享路径写身份投影。machine trust 根及其 `ServiceState` 必须在创建调用本身携带 SYSTEM/Administrators owner 与受保护的 SYSTEM/Admin-only DACL，普通用户不得拥有父目录 `DELETE_CHILD`；预存的不可信根必须 fail closed，禁止静默接管或在共享目录下只加固子目录。每次读取前重新验证，父路径任一 reparse point/junction、符号链接或非普通文件都必须 fail closed。提升恢复可以清理 WFP，但父路径不可信时不得沿该路径删除文件，必须明确报告状态路径未修复。状态文件缺失但 WFP 中仍有 Krypton 托管过滤器时必须拒绝启动并要求提升后的恢复，禁止猜测状态或静默解锁。卸载只允许 inactive/无状态，必须先取得 SCM 删除句柄，再事务删除托管过滤器、动态关键字和持久子层，最后删除服务；任一步失败都不得留下无 owner 的半卸载状态，原服务此前运行时必须尝试恢复。恢复工具只可查看安全摘要、导出不含签名正文的诊断或清理 Krypton 管理的规则，不提供万能密码、恢复码、通用配置编辑或远程命令。提权 WFP 集成测试必须默认不注册、显式开启，并以栈展开清理隔离的持久规则。
- Endpoint 身份轮换必须先停止既有 Service，并在联系 Server 前确认持久网络状态仅为 missing/inactive 且不存在托管过滤器；active/apply-pending/release-pending 必须拒绝轮换并恢复原 Service。新 endpointId 激活后，已验证的 inactive 状态必须幂等重绑到新身份，再初始化新 replay cursor 并重启；失败保留受保护 pending claim 供同一码重试。`RotateEndpointKey` 与 `SkipEnrollment` 必须 fail fast 互斥，既有服务轮换不得再次调用 `CreateService`。

## Endpoint 执行事实与 ACK 协议

- Vigil 以 `EndpointExecutionSession` 持久记录每次认证连接，以 `EndpointExecutionCommand` 持久记录签名 envelope、endpoint/activity/command revision、capability、预期策略 revision、连接 session、过期时间和最终结果。命令必须先与 replay cursor 在同一数据库事务中创建为 queued，才允许尝试 WebSocket 发送；随后只进入 sent、applied、failed、expired 或 offline，禁止用内存 pending 充当 canonical。Server 启动时必须把遗留 queued 明确标成未发送的 offline，允许同一不可变策略用新的 command revision 重试；sent 不得据此猜测结果。
- Endpoint 的 `command_result` 必须回显签名命令的 `activityId` 与 `revision`，并与持久 commandId、endpoint、capability、command 和预期网络身份精确核对。相同终态 ACK 幂等；冲突、未知、未发送、过期或降级结果 fail closed。已经持久接受但 WFP 首次执行失败的 apply/release pending 仍保持 sent，不得误记 failed；Endpoint 通过现有心跳和重连 hello 持续上报实际网络状态，成功重试后由原命令精确收敛为 applied，超时仍进入 expired。Server 重启把遗留连接标为断开，但不把 sent 猜成成功；apply 只有完整活动授权与唯一未决命令精确一致时才可补记 applied；stop 还必须由受保护的持久状态回报最后成功 stop 的 commandId、command revision、activityId 和 policy revision，普通 inactive 或硬截止不得冒充 stop ACK。重连对账与终态写入必须原子或 CAS，过期及并发 ACK 只能形成无副作用的 no-op，失败注册不得留下在线会话。
- 单站只使用现有数据库和 endpoint 级 asyncio 边界；不为 P1.11 引入消息队列、分布式调度或 Dashboard 共享 token 权限模型。P1.11 不提供独立网络锁管理入口、不创建 OJ 业务活动，也不复制 OJ canonical；这些仍属于 P1.12–P1.17。

## 考试网络策略与目标快照协议

- `exam.policyTemplates` 是学校范围内可复用的策略草稿容器；草稿可改，发布后的内嵌 revision 不可改。每个 revision 只保存 canonical 域名、IP/CIDR、端口与 fingerprint；发布校验必须通过受信 resolver 取得本站 Endpoint Service 的实际控制面 host/port，并按终端相同的去重与端口展开语义把隐式 service-only 许可计入 4096 条规则上限。resolver 缺失或控制面无法解析时 fail closed。归档模板不得删除历史 revision，回滚只重新引用旧 revision，不生成反向 patch。
- `exam.targetAssignments` 每个 ExamEvent 最多一份动态来源草稿。教室、endpoint、seat、考试座位和 userbind 用户组必须通过受信 resolver 在确认时重新解析；resolver 未注册、来源漂移、空目标、跨学校 endpoint、重复 endpoint，或缺少精确 `network.policy@1` 的 apply/status/stop 任一固定命令时一律 fail closed。发布只保存显式、排序后的 endpoint IDs、来源 fingerprint 和目标 fingerprint；后续组、座位或绑定变化不得改写旧 revision。
- `exam.eventNetworkConfigs` 只保存当前活动引用的 policy revision 与 target revision。每次分配都重查 ExamEvent、学校、模板/目标归属和不可变 revision，并用 CAS 形成新的配置 revision；未来执行会话必须固定读取这两个引用，不能运行时回查动态来源。
- ExamEvent 学校/生命周期 mutation 与 P1.14 的事件关联写入必须共享同一 `(domainId,eventId)` 单进程轻量边界，并在取得边界后重读事件、重查权限、学校和归档状态；不得仅靠跨集合先读后写维持不变量，也不为此引入 Mongo 事务或分布式锁。P1.14 只建立 OJ canonical schema、验证/确认边界和审计，不直接调用 Vigil、不发送终端命令，也不提供正式 WebUI。目标与控制面 resolver、执行同步由 P1.15 接入，工作台属于 P1.16；P1.13–P1.17 仍是不可拆生产部署单元。

## 教室终端与实体座位绑定协议

- `exam.endpointSeatBindings` 是实体座位与 Endpoint 长期一对一关系的唯一 canonical；实体身份固定为 `(domainId,classroomId,sourceSeatId)`，label、坐标和装饰变化不得改变绑定。active 座位与 active endpoint 都有域内唯一约束；解绑保留原文档和完整单调历史，禁止删除历史或按主机名/label 猜测绑定。
- `exam.seatOperationalProfiles` 是教室实体座位能否用于考试和业务朝向的唯一运行配置；revision 以 `(domainId,classroomId,layoutRevision)` 为边界不可变追加，完整绑定学校、历史布局 fingerprint、全部规范化实体座位和内容 fingerprint。某个布局尚无持久 revision 时只派生 revision `0` 的 `enabled + facing:unset` 默认投影，不在读取或部署路径写库；布局换版重新从该布局的默认投影开始，旧布局 revision 继续精确可读。每次写入必须提交当前布局、完整 seat set 与 expected revision，通过唯一索引 CAS 形成新 revision；seat entry 只允许 `enabled`、`unset|up|right|down|left`、固定禁用原因及可选备注，恢复必须清除原因和备注。该配置不得修改导入布局的 sourceSeatId/label/坐标/rotation，不得解除长期 Endpoint 绑定，也不得把离线状态自动持久化成禁用。
- 配对窗口按教室和全局单调 revision/CAS 管理；每次开窗创建新文档，旧 window、code digest、claim、decision 与 actor 事实永久保留以支持 ACK 丢失恢复，不得用“当前窗口”覆盖历史。不同实体座位 mutation 可并发，但同座位串行；开窗/关窗使用排他的教室 window transition phase，并等待该教室所有在途绑定、换机、取消与解绑完成。域删除在删除 domain 根之前建立排他 lifecycle gate，等待在途 mutation 并阻止新 mutation，直至全部 domain cleanup 完成；等待者随后必须重读教室、座位与 endpoint ownership。跨文档写入中断后只能从 binding 单调历史精确收敛对应 window，禁止把已完成绑定取消掉或覆盖首次审计；HTTP retry 只能记录显式 replay 事件并携带 canonical actor，不得冒充当前操作者完成了一次新 mutation。明文座位码 canonical 固定为 8 位 ASCII 数字，管理员页面仅显示成 `XXXX-XXXX`，终端传输与输入不含横线；同一窗口内必须唯一，Mongo 只保存 SHA-256 摘要与两位提示，日志、oplog、Vigil 和 Endpoint 均不得持久化或输出明文。码短 TTL、单 endpoint 认领并按 endpoint 限速；同一已认证 endpoint 持同一码只允许无副作用恢复既有结果，不能再次消费或改写首次审计，另一 endpoint 必须拒绝。
- OJ 保存绑定、窗口、换机与解绑事实；Vigil 只在已认证且仍为当前连接的 Endpoint Service 与 OJ service-token 路由之间转发严格协议。座位配对要求 Service `>=0.4.0`，普通 GUI 只能经受信本机 IPC 请求当前 Service 发送，且在发送配对码或查询当前绑定前必须核对命名管道服务端为固定安装路径下的 LocalSystem Service；Service 同时核对调用方来自固定 GUI 路径。配对不是远程命令 capability。任一未知字段、错 requestId、旧版本、断线、超时或畸形 OJ 响应必须 fail closed；秘密不得进入日志。奥易/Ghost 按最坏情况视为每次重启整盘还原且不提供任何穿透：固定程序目录为 `C:\Program Files\KryptonVigil`，基线只保存不含 endpointId、私钥或 seatId 的 Server URL/SPKI bootstrap。Service 缺少本地身份时必须按运行时 machine fingerprint 向固定 Vigil 执行同一个 ensure 操作：已存在 active mapping 时原地恢复 endpoint 并轮换本次凭据，未知 fingerprint 时由 OJ/Vigil 原子登记确定性 endpointId；随后重建受保护 config/replay 状态并继续使用 OJ 中原座位绑定。复制来的本地 config、私钥和 replay 只有 registered fingerprint 与当前机器精确相等时才可采用，否则必须在确认无持久网络 owner 后安全清除；Server/OJ 未确认、网络结果未知、revoked/replaced、重复或冲突身份一律保持不可考试状态。`%ProgramData%\KryptonVigilMachineTrust` 与 CNG key 在单次 Windows 运行期间仍是 Service 的受保护事实源，但不再作为跨整盘还原保持 endpointId/座位绑定的前提；本机始终禁止缓存或猜测 seatId。
- 硬件更换会按新机器的 runtime machine fingerprint 登记新的确定性 endpoint；座位换机确认前必须重读 binding/window/seat，展示旧/新 endpoint 与当前或未来活动引用并绑定 confirmation fingerprint，完成后再显式吊销旧 endpoint。换绑和解绑不得修改已发布 target revision 或进行中 execution 的 endpoint 快照。
- `classroom` 目标来源按当前 active bindings 展开；`seat` 来源 ID 固定为 `EndpointSeatBinding._id`。解析必须重查 domain/school、binding canonical、finalized endpoint ownership、Vigil credential/协议/能力，并在联系 Vigil 前拒绝重复 endpoint；发布后仍只使用冻结的 endpoint IDs。
- P2.2/P2.3 与 OJ、Vigil Server、Endpoint Service 三端配对协议是不可拆部署单元。完成本地实现不授权连接真实机房、建立生产绑定或启用旧 Vigil SQLite seat-label 子系统。

## 考试预登录票据协议

- prepare 只读取已发布的固定座位分配 revision，并重查 ExamEvent、Contest 入口资格、当前 userbind、实体座位绑定和 Vigil Endpoint 在线/版本/能力/活动会话；只返回完整逐项诊断与 preparation fingerprint，不创建票据或命令。confirm 必须在同一 ExamEvent 轻量边界内重新计算并精确匹配 fingerprint；任一硬错误阻止整批投递。
- `exam.preloginBatches`、`exam.preloginTickets` 与 Vigil 的持久 request/command/link 是响应丢失后的恢复事实。batch/request/ticket identity 必须确定且幂等；同 request 的重试只能收敛已有单调状态，已经兑换的 ticket 不得降回 issued。Vigil projection 必须按 revision 持久确认，未确认投影在启动后和固定周期内继续重发，不依赖终端再次重连或心跳。
- 明文 `KPT1-*` 只允许经 OJ→Vigil service-token material 路由交给票据绑定的当前 Endpoint；Mongo、SQLite、日志和 oplog 只保存摘要或引用。票据精确绑定 event、assignment、publication、uid、student record、seat binding、endpoint 与 workspace，并在兑换前重查这些当前事实；过期、错机、错 batch、活动或资格漂移以及不同 request 的重复兑换均 fail closed。
- 失败重试只接受当前 projection 中完整且精确的 `expired / failed / offline / rejected` 集合，保留其它成功 command facts。只有仍为 issued 的失败过期票据可 CAS 续期并把新摘要/期限精确同步给 Vigil；已兑换票据不得签发新会话，只能在 Vigil 重验原 command/link 与唯一 active session 后精确恢复。签名 launch payload 必须分别绑定 `ticketExpiresAt`、`commandExpiresAt` 与可空的 `resumeSessionId`；无精确恢复会话时两种期限必须相同且票据仍有效，过期票据不得借新的命令期限进入普通启动路径。初次 dispatch 在持久 request/link/command 前必须整批重查 active session；相同已 claim 请求的幂等读回不得被随后出现的会话改写。重试 requestId/idempotencyKey 内容冲突、投影漂移或非精确集合必须拒绝。
- `exam.prelogin@1/launch_prelogin` 必须先通过签名 envelope、endpoint/activity/ticket scope、双 expiry 与 exact payload 校验并持久提交 Service replay cursor，才允许启动固定安装目录内的 `KryptonVigilClient.exe`。启动只面向当前活动控制台用户，参数只能携带非秘密 ticketId 引用；无桌面 session、固定程序缺失或启动失败必须形成明确终态，不得循环拉起。
- 完整 `KPT1-*` 只可短暂存在于 OJ→Vigil→Endpoint Service 内存；不得进入 Service→GUI IPC、Client 命令行、普通用户文件或日志。Service 为断线精确重发可保留票据到收到确定的兑换响应，并须在兑换成功、明确失败或终态清理时清除。Service→GUI 的预登录 IPC 只传 ticketId 引用或兑换后的安全 launch/session，并同时验证固定程序路径与活动控制台；GUI 同时验证固定 LocalSystem Service。已运行 Client 的同用户接管通道也只传 ticketId 引用并复验两端程序身份。
- `launch / process_ready / redeemed / page_ready` 必须按固定 revision 持久化后逐阶段 ACK；最终成功还必须绑定 exact command、ticket、session，并验证浏览器最终主文档与严格校验过的 launch URL 同一 HTTPS origin、精确命中签名命令所绑定的 canonical workspace path。连接重建只重发当前 exact stage/result；跨 WebSocket 的成功 ACK 只允许在 Server 已持久保存相同 page-ready/session 事实时收敛。Service 崩溃不得猜测成功：仍为 issued 的失败过期票据只按 P2.6 规则续期，已经兑换的恢复才必须使用同 ticket 对应的唯一 active session。
- ExamSession 创建与普通登录共用 endpoint + `(contest,uid)` 轻量边界，并在边界内重读 active session；预登录还必须重验当前 Contest role 与 batch/ticket/request identity。迟到的本机 IPC 失败不得把已兑换或 page-ready 事实降级；只有已持久失败的同 ticket 项可被更高 command revision 替换，成功项和在途项不得被重启。
- P2.6 只建立 OJ/Vigil 的两阶段预检、票据、持久投递投影与精确重试；P2.7 只补 Endpoint Service/Client 拉起、兑换、分阶段 ACK 与精确恢复，不包含 P2.8 检测或 P2.9 教师联调 UI。P2.6/P2.7/P2.9 的预登录链须兼容后同批部署和回滚；本地完成不授权连接真实 Windows 主机或生产环境。

## 一键考试准备整合协议

- P2.9 复用 `/admin/exam-infrastructure/events/:eventId/seats` 与现有 ExamEvent、名单、分配、网络执行、监测预检和预登录 canonical；不得新增第二套 workflow 集合、后台编排器、队列或自动发布。教师按显式步骤生成并发布座位分配、配置目标、启动网络、运行终端预检、确认预登录，只能精确重试当前投影中的失败项。
- Krypton 预登录 workflow 必须由服务端从已发布 assignment 派生 endpoint，并同时固定 preparation fingerprint、当前 active network execution revision、policy/target 完整引用、硬截止、目标覆盖和 P2.8 hard readiness。预登录 endpoint 必须全部包含在冻结 target 中，网络执行必须在硬截止前对完整目标真实 `applied`；USB/进程/检测器 warning 只展示且不进入 drift fingerprint，离线、版本/能力不兼容、目标缺失或检测不可用属于硬错误。
- confirm 必须在 ExamEvent 轻量边界内重新计算并精确匹配 workflow fingerprint，之后把确认时的 execution/policy/target/window 引用写入既有 `exam.preloginBatches` canonical。已完成的同 requestId POST 只按持久批次身份读回，不因后来事实漂移重复投递或重复记录 mutation；不同 payload 复用 requestId 必须拒绝。批次列表和恢复必须显示当时固定引用，不能拿当前 config 冒充历史确认事实。
- 页面在发送 confirm 前把 requestId 写入 URL；响应未知先按同 requestId 查询，换页优先恢复 URL 指向批次，否则只读取按 `createdAt` 确定的最新批次。首轮 dispatch complete 不等于完成，仍须轮询到每项 `applied/page_ready` 或明确 `expired/failed/offline/rejected`；成功、失败、在途和未处理必须分开显示。同一发布 assignment 已有批次时不得创建第二个 requestId，只能查看结果或按原 projection revision 与完整失败 ticket 集精确重试。
- 外部考试没有受信 Contest workspace 时明确显示预登录不适用；仍可用教室或指定终端目标执行网络控制，不得创建空 batch、伪造名单/workspace 或把无名单解释成成功。500 人保持一个 canonical batch、一次服务端预检和 O(n) Map join，前端不得私自分块。
- P2.9 的 `workflow` 字段采用同一制品的兼容 reader 与受控 writer 分阶段启用：新制品先以 `exam.preloginWorkflowWriterEnabled=false` 部署并读取全部旧批次，确认不存在无 workflow 的遗留 `dispatching` 批次后才可显式启用 writer。任一 workflow 批次写入后，允许关闭 writer，但二进制回滚下限永久提升为能严格读取可选 workflow 的兼容 reader；禁止直接回到不认识该字段的 P2.6/P2.7 旧制品。该门禁只解决存储形状兼容，不得绕过运行时 readiness 或作为长期产品开关。

## 考试基础设施活动协议

- `exam.events` 是 Krypton Contest 与纯外部考试共用的 OJ 业务根；`type:'krypton'` 可在草稿期不关联 Contest，但进入计划态前必须关联当前域内且操作者可管理的 Contest，`type:'external'` 禁止伪造空 Contest。Contest 不拥有或驱动 ExamEvent 生命周期。
- ExamEvent 写入态只使用 `draft / scheduled / archived`；`active / ended` 由已计划活动的时间窗确定性派生，不通过后台任务改写。所有 mutation 使用 `revision` CAS，活动开始后 school/type/contest/time window 冻结，title 与 collaborator 仍可维护；归档是当前唯一移除路径，不开放绕过后续引用检查的硬删除。
- 基础设施管理员是 `PRIV_EDIT_SYSTEM` 或显式 `PERM_MANAGE_EXAM_INFRASTRUCTURE` 持有者。普通教师必须持有 `PERM_CREATE_EXAM_EVENT`，并在每次请求重新满足 userbind canonical 学校范围、owner/collaborator 与关联 Contest 权限；URL、前端 capability、schoolId 或 collaborator 列表均不能自证授权。
- 每个 revision 保存确定性的 `auditRef=exam-event:<eventId>:<revision>`，并由 OJ oplog 记录 actor、event、revision、变更字段和关联身份。P1.13 不创建网络策略、终端目标、Vigil execution session 或真实考试活动；这些只能由后续任务引用 eventId。

## 考试名单与候选座位快照协议

- `exam.rosterRevisions` 只保存从 userbind 学校/用户组或 Krypton Contest audience 显式编译出的不可变名单 revision。每份 revision 固定 ExamEvent、学校、选择来源、group/source fingerprint、明确学生与绑定 UID、排除诊断和相对上一版的 UID 增删；刷新只能追加新 revision，不得改写旧名单、请求时回填或后台跟随 userbind。
- 名单生成只允许当前仍可管理 ExamEvent、持有 `PERM_USERBIND_MANAGE_STUDENTS` 且仍具有对应学校与 Contest 权限的操作者（考试基础设施管理员可按既有全域权限旁路），并在同一 ExamEvent 轻量边界内重读事件和权限。userbind source 与 OJ 用户状态必须双读一致后才可落库；跨域、跨校、缺组、重复绑定、未绑定、用户缺失或停用必须明确拒绝或进入不可变排除诊断，禁止静默创建第二套学生事实。
- `exam.seatPlans` 是严格 v1/v2 union 的不可变候选范围 revision。无 `schemaVersion` 的 v1 字节、fingerprint 与单教室 `sourceSeatId` 语义必须永久保持可读；`schemaVersion:2` 固定 event、可选 roster，以及按顺序保存的多教室 classroom/layout/运行档案引用和各教室排序候选。Krypton ExamEvent 必须引用名单；纯外部考试可显式使用空名单。人数多于候选座位只记录诊断，候选范围本身不包含 UID→座位映射。
- `exam.seatAssignments` 同样是严格 v1/v2 union 的不可变正式分配 revision。v1 继续固定单教室、候选/可用座位和 UID→`sourceSeatId` 双射；v2 以 `(classroomId,sourceSeatId)` 为唯一座位身份，并冻结名单、全部教室/layout/运行档案、座位几何/朝向/可用性、绑定历史 revision、终端状态、策略/seed/算法/约束、最终映射与解释。相同输入、seed 与算法必须得到相同结果；禁用、未绑定、未知状态、座位不足或约束冲突必须返回完整诊断且不落半份 revision。随机 seed 只在显式首次生成或“重新随机”时更换，重新随机保留锁定项；人工换位和锁定只能追加新 revision，不得修改长期 Endpoint 绑定。
- P2.11 只启用 v1/v2 reader；P2.12 开始允许模型层显式追加 v2 seat-plan 与 assignment revision，但不创建迁移、回填或双写，也不在 P2.13 前开放跨教室教师 UI、在 P2.14 前接入预登录消费者。v2 算法只在教师圈定的候选教室内工作：enabled、布局状态有效且具有完整 active binding 的座位才可分配，Endpoint 离线或在线未知只进入冻结 warning；容量不足或锁定/人工约束冲突才阻止落库，满员近邻不得成为拒绝理由。默认策略先选择容量足够的最少教室，优先间隔策略可使用更多候选教室；同队每人一座并优先同室聚集，同队之间不计抄袭风险，异队/个人按规范化几何距离与明确朝向生成高/中风险边。`spatial-best-effort-v1` 的近邻图固定为每座按规范化距离、再按结构化座位身份稳定决胜的最多八个最近座位，并保存该有界图内的全部高/中风险边；这既是可解释算法语义，也是 500 座单文档的固定容量边界。实现固定为带 seed 的确定性有限 greedy 候选，不得声称全局最优或引入通用求解器、外部优化服务。
- P2.13 在既有座位页显式开放 v2 教师工作流：老师选择一至多个当前教室后追加候选计划，再选择策略生成、跨教室换位、锁定、重新随机、保存不可变 revision 并通过 publication CAS 发布。页面只投影冻结的教室容量、风险边、拆队、跳过座位、Endpoint 在线 warning 与未设置朝向；风险边明细和连线按需展开，500 人只保留一个共享座位选择器并使用 Map/Set 连接，不为每行复制完整座位控件。任何未保存的映射或锁定变化都必须阻止发布、CSV 导出和候选计划 mutation；请求在途、响应未知、重读失败或 assignment 不再精确引用当前最新 plan 时页面必须标记事实过期并关闭全部写入/导出，老师只能显式放弃未保存草稿后重读，禁止猜测写入结果。完全公开或仅靠邀请码且参赛者仍可变化的个人赛第一版不提供自动排座，也不得用学校、用户组或瞬时 attend 绕过；只有固定受众或已定版团队名单可进入 v2 写边界。CSV 必须携带教室/座位/Endpoint 身份并中和公式。v1 历史继续只读兼容，P2.13 不修改长期绑定或运行档案，也不允许 v2 分配进入预登录；该消费者升级属于 P2.14。
- 自 P2.13 writer cutover 起，所有 v1 计划、生成、调整、重新随机和发布入口必须 fail closed；纯 v1 事件也只能查看或导出历史，新写入统一使用 v2。任何 v2 写入都会把二进制回滚下限永久提升到能严格读取 v2 union 的兼容 reader，禁止回到只认识 v1 exact-key 的旧制品。
- `exam.seatAssignmentPublications` 只保存每个 ExamEvent 当前发布 revision 的完整 CAS 指针。发布前必须在 ExamEvent 边界内重读事件、名单、计划、当前 layout 与 active binding，并用保存的 seed/约束重建同一映射；已发布 revision 不原地改写，后续调整与重新发布继续追加 assignment/publication revision。
- 管理读取必须重新验证 roster、classroom、layout 与 seat 引用；事件学校一旦有 roster/seat-plan/assignment 事实就不得改变。操作日志只记录 event/revision、数量、诊断码与 fingerprint，不记录姓名、学号或成员明细。首次部署必须确认 PII 保存范围、四份 Mongo 集合及权限边界；加载代码不自动生成或发布真实考试分配。

## OJ 与 Vigil 考试网络执行同步协议

- OJ 的 `exam.networkExecutions` 只保存 ExamEvent 的期望执行 revision、固定 policy/target 引用、幂等 request identity 和 Vigil 返回的最小逐机投影；不得复制 Vigil 的签名 envelope、策略正文、终端结果正文或用投影改写 `exam.eventNetworkConfigs`。Vigil 继续以 P1.11 session/command 为唯一逐机执行事实，并只增加幂等请求到这些 commandId 的窄映射。
- 每次 start/update/stop 必须先在 OJ 以 ExamEvent 轻量边界、当前权限和 revision CAS 持久化 intent，再通过既有 OJ service token 发送固定 requestId/idempotencyKey/executionRevision。HTTP 超时或响应丢失只能标记 unknown；相同 payload 可重试并复用同一 command facts，idempotency key 或 requestId 内容冲突必须 fail closed。
- Vigil callback 与 OJ 主动 pull 使用同一严格最小投影 schema。OJ 仅接受精确 domain/event/execution/request/activity/policy/target identity，projection revision 单调；旧 execution callback 只作无副作用忽略，同 revision 不同 fingerprint 拒绝。callback 仍走 `/api/vigil/*` service-token 边界，不复用 Dashboard token；回调失败依靠同一持久 request pull 恢复，不引入 MQ、调度器或第二套 endpoint 状态。
- P1.15 只接入 domain-owned explicit endpoint source；classroom/seat/exam-seat/userbind-group 在各自 canonical 系统完成前明确不可用。explicit endpoint 必须存在于当前域已 finalize 的 enrollment claim，Vigil credential 仍 active，并携带完整 `network.policy@1` 三命令能力；离线不伪装在线，也不阻止冻结已知能力的目标快照。

## 考试网络策略热更新与重试协议

- 活动中的热更新或历史 revision 回滚只允许变更 policy revision，必须保持同一不可变 target revision，并在执行前展示规则收紧/放宽、旧/期望/实际 Endpoint policy revision 与精确 endpoint 差异。target revision 变化必须先停止旧快照并取得全部旧目标的完整成功释放投影，再按新快照启动；禁止把移除终端留在不可见的旧锁中。
- 传输未知或 dispatch 未完成只重试同一 requestId/idempotencyKey。只有完整投影中存在 `failed/offline/rejected/expired` 明确终态时，教师才可创建新的整批 retry execution：apply 对完整冻结目标使用更高 policy revision，stop 对完整冻结目标使用新的签名命令但保持 policy revision。不得把整批重发伪装成“只重试失败终端”，也不新增后台队列或自动解锁。
- 已经 inactive 的 Endpoint 仅在受保护的最后 stop proof 与新命令的 activityId、policyRevision 精确一致时，才能幂等接受更高 command revision 的 stop 并更新证明；错活动、错 revision、无证明、硬截止/本机恢复释放或存在 legacy lease 时必须 fail closed。重复 stop 的 pending proof 必须按持久 pending → replay commit → inactive 顺序恢复，不能清除无关 legacy 网络规则。
- 浏览器预检只作展示；每次 start/hot update 的 OJ 写入口必须在 ExamEvent 轻量边界内重读当前 config revision，并重新执行服务端预检。UI 预检身份必须绑定 config revision 与 policy/target 的 ID、revision、fingerprint，任一变化后立即失效。真实 Windows 验收只在用户明确批准的非生产机器执行，不得为了本地完成状态连接生产或机房终端。

## 独立网络锁 MVP 控制协议

- P1.12 的控制入口只挂在现有 OJ→Vigil service-token 边界，固定提供终端预检、显式活动 apply/update、实时 status 查询、匹配 revision 的 stop、活动命令事实读取和单命令读取；不复用 Dashboard token，不创建 ExamEvent、定时调度器或第二套网络锁状态。
- 批量操作必须逐 endpoint 返回 P1.11 canonical command fact或明确的 pre-dispatch rejection；离线、能力缺失、旧协议、发送失败和部分成功不得折叠成整批成功。apply/update/stop 只驱动 `network.policy@1` 严格命令，status 使用 endpoint 控制 scope，不伪造活动 ACK。
- 每次 protocol 2 heartbeat 和被接受的网络命令结果都要更新当前 execution session 的 reported network state；预检和活动视图只读该状态及 P1.11 持久命令，不读取学生 GUI、本机 IPC 或测试假 ACK。真实 Windows 闭环必须在用户明确指定的非生产测试机上验收，未获范围批准时不得连接或修改生产机房终端。

## 教室与座位布局 canonical

- OJ 的教室事实只认 `exam.classrooms`；每个教室以 `sourceSystem + sourceClassroomId` 保留上游身份，并在同一文档内保存按 revision 递增的不可变布局快照。实体座位身份只认 `sourceSeatId`，label、坐标和几何变化不得触发按名称猜测重绑。
- ClassSignin 数据只通过 `classroom:migrate-classsignin validate|plan|apply|verify` 在部署时执行一次。manifest 必须显式映射 source school 到当前域的 `userbind.schools`；运行时不得连接 ClassSignin，不注册长期导入/导出 API、WebUI、后台同步或第二套学生/班级/课程/签到数据。
- 任何单条或列表读取都必须验证教室根、layout revision 与布局 item 的 exact canonical schema 及内容 fingerprint；自洽 hash 不得替代 discriminator、必填字段、数值边界、稳定身份和 grid/items 语义校验。Endpoint 绑定、永久保留的历史配对窗口、考试目标、座位计划与分配引用必须先解析到同域 active 教室及真实 current seatId，悬空、跨域或错座位事实一律 fail closed。
- apply 必须在 Hydro 停止、完成全量及目标集合备份后，由站点或考试基础设施管理员携带精确 plan fingerprint 与确认 token 执行。相同 batch 重跑幂等；本地 WAL 领先只能从记录的精确 Mongo predecessor 继续，已记录逐教室结果不得在恢复时覆写，确定性 success audit/batch 的 ACK 丢失必须读回精确事实后收敛；若读回也暂时失败，只能保留 applied/原状态重试，绝不得降级或写出非法 WAL。时钟回拨必须在写入前拒绝。非目标漂移、完整文档 CAS 竞争、被终端绑定或考试事实引用的教室删除/seatId 移除必须整批 fail closed，verify 必须从 Mongo canonical 与持久 batch/audit 重新核验。

## 真实性训练可信完成协议

- Course 与 ProblemSet 的真实性策略只认发布后不可变的 `practice.integrityRevisions`；短期 `PracticeContext` 必须绑定域、用户、题目、主容器/作用域及每个明确参与目标的容器、作用域和 revision。签发与提交都要重新读取 canonical revision 并校验当前题目/容器可见性和范围成员关系，客户端字段不得自证授权。
- Record 只能保存由服务端 Context gate 生成、并自带 canonical domain/uid/pid 绑定的 `practiceContext` 短引用；Context 的过期、revision、容器/题目可见性和 scope 成员关系必须在 `record.add` 紧前重新校验，并且只使用该次校验返回的可信引用。Record 创建和异步回写都必须把可信绑定与 Record 精确比对，禁止从请求字段拼接或把可信引用嫁接给其它用户/题目/域。携带 Context 的请求不得同时归属 Contest/VP；普通、Contest、VP、历史 AC、预评测和管理员预览不得创建真实性完成事实。
- 最终 AC 只在既有异步 `record/judge` 回写中按明确目标幂等写入 `practice.contextualCompletions`，不得为此改写普通提交、Contest/VP、预评测、Builtin Judge、VJudge、WebSocket Judge 或 Consumer 的生命周期。唯一身份包含 domain、uid、容器、作用域、pid 和 revision；并发 duplicate-key 只有精确命中该身份才可视作幂等。一个 Context 包含多个目标时必须全部尝试并 settle 后汇总失败，不得因首个目标失败留下未尝试目标；重复回调/重测不得重复计数，取消或后续非 AC 不删除既有事实，未知状态必须显式报错并记录 rid/context/目标/revision/stage。
- 启用已发布真实性策略的课程/题集进度只读 scoped `ContextualCompletion`，首页、列表、详情题目行、文件页和两套 UI 都不得回退全局 ProblemStatus/TrainingStatus；未配置策略的存量容器继续使用全局 AC。课程引用题集时同一可信 Context 可包含主课程与一个或多个明确题集目标；直接题集 Context 必须且只能包含自身目标，不得反向完成引用它的课程或携带其它容器。

## 真实性训练策略与可信上下文协议

- `practice.integrityRevisions` 是 Course/题集真实性策略的 canonical 集合；策略只归属容器，不写入 Problem。每个容器最多一个带 `draftVersion` CAS 的草稿，发布后 revision 永久不可变，后续修改只能创建下一 revision。
- 首版策略固定为禁外部代码注入、移除独立提交表单和防 AI 复制注入三个布尔项；Course 与题集的组合策略只取逻辑 OR，不支持逐题、逐章或逐阶段 override。
- `practice.contexts` 是服务端签发的短期 `PracticeContext`；必须精确绑定 domain、uid、主容器、chapter/stage、pid、模式和全部参与的已发布 revision，每个容器恰好一个 revision。主容器是题集时目标集合必须且只能包含自身；主容器是课程时只允许主课程与显式题集目标，不允许第二个课程目标。签发前必须通过容器可见性、题集 `training/get` 扩展和题目 canonical direct-view gate；URL 参数只能请求 Context，不能自证权限或真实性状态。
- Context 的 Mongo TTL 只负责清理；签发与每次读取都必须从 canonical revision 集合重取全部引用、验证不可变身份和三布尔策略并重算 OR。新签发还必须在写 Context 前重查每个参与容器的 latest published revision；已经签发的旧 Context 只校验其固定 revision，不因后续发布追溯失效。后续提交边界仍须显式校验过期、用户、容器、scope、pid、模式与适用 revision。无已发布策略的存量 Course/题集保持普通模式；受控入口缺失、伪造或过期 Context 时 fail closed，不得降级成普通提交。
- 策略管理只允许容器 owner、既有容器管理权限持有者或管理员；预览 Context 必须标记 `mode:'preview'`，不得产生学生完成事实。日志只记录 contextId、uid、容器、pid、revision、stage 和拒绝原因，不记录剪贴板、代码或隐藏提示正文。

## 赛事题目批量导入触发规则

### 何时自动触发

当用户提供或引用赛事题面 PDF/文档、评测数据 ZIP/压缩包、赛时通过量或通过率截图/表格，并要求筛选、录入题目、配置测试数据或挂入训练时，自动将请求识别为“赛事题目批量导入流水线”。同类后续请求即使来自新的会话，也应优先按本规则处理；这不是默认进入 grill 的信号。

### 固定执行方式

1. 先读取本月 `PLAN`、任务看板和 `docs/runbooks/problem-batch-import.md`，确认当前唯一事实源、PID 规则、来源模板、标签导图、权限和训练挂载规则。标准入口固定为 `hydrooj problem:batch-import <validate|preflight|apply|verify> <manifest>`。
2. 复用上述标准批量导入工具，禁止为每一场比赛临时拼接一次性生产脚本或通过前端逐题机械录入。如果 runbook/命令尚未实现或缺少当前输入格式，应先按 `PLAN` 的 P2.23 spec 实现或修复它；不得假装不存在的命令已经可用。
3. 在本地完成确定性的预处理：识别赛事、年份、场次和题号；按用户给出的筛选条件或完整题号清单选择题目；解析题面、公式、图片和 Hydro 兼容的样例格式；解包并配对输入输出文件；为每道题生成显式测试用例配置；准备来源、PID、系统标签、知识导图标签、出题人、最终可见性和待挂训练信息。只有用户提供或可核验的赛时数据才录入，缺失时不得伪造 `0/0`。需要暂不展示时必须在 manifest 中显式写 `visibility: hidden`，由 canonical 确认链保持隐藏，禁止导入公开后再补写 `hidden`。
4. 先执行 fail-fast 校验和 dry-run。至少检查题目映射、PID/计数器冲突、资源引用、每个测试文件是否存在、输入输出是否完整配对、配置是否可被当前评测链路解析、题面样例是否兼容 Hydro，并输出逐题预览和将要发生的写入。
5. 机械细节由 Agent 按现有规则决定；只有会改变题目选择、PID 命名空间、作者归属、标签语义、训练归属或生产数据结果的真实分叉才询问用户。不得因例行导入反复 grill 或进行无收益的多轮设计。
6. 任何生产写入、部署或服务切换前，都必须展示准确命令和写入范围并取得用户明确批准。批准后先按部署规范备份，再执行导入；不得把 dry-run 或本地成功等同于已经上线。
7. 导入后逐题核验题面与图片、作者与编辑权限、PID、来源与标签、赛时通过数据、测试文件、显式测试用例配置、评测可用性和训练挂载。部分成功必须明确报错并保留可恢复的执行清单，禁止静默跳过失败项。
8. 流程中断或开启新会话后，必须先读取本地执行清单并只读核对实际生产状态，再从最后一个已验证节点继续，不能仅凭旧会话描述猜测完成度。
9. 生产环境中的既有编程题及其比赛、考试引用属于受保护数据。除非用户明确指定，批量导入不得覆盖、重编号、迁移或修改这些题目。
10. 历史赛事回填只能复用 manifest 指定的精确训练章节，并对章节 ID、标题、绝对位置和待替换成员做 CAS；不得把旧赛事插到训练最前面，也不得清空未在 manifest 中逐项声明的章节成员。
