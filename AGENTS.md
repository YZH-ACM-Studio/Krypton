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
- P1.17 不修改 Vigil Server 或 Client，不需要迁移或回填历史比赛与队伍。部署只加载 OJ/UI 源码及等值 partial/普通索引，不得顺带创建批次、绑定比赛或连接 Windows 主机。
- 赛前就绪检查只允许管理员按需执行，复用定版的 canonical 阵容校验并返回聚合诊断；结果不是授权令牌，不能缓存、自动修复、自动关批或自动定版，实际定版必须重新校验。

## Vigil 普通浏览器封锁协议

- `client_required` 比赛入口 gate 与普通浏览器全站封锁是两条独立边界；前者始终要求当前比赛的有效 Client session，后者只能封锁 canonical 受众。
- 有效 Client session 只是其绑定比赛工作台的能力凭证，不是主 OJ 的全站通行证。该会话只允许绑定域和 `tid` 的 `/exam-mode/:tid`、`/paper/:tid` 及携带同一 `tid` 且由下游再次校验的提交、题面附件和评测轮询端点；访问首页、全站记录、其它域、其它比赛或其它 `tid` 必须保留会话并重定向回绑定工作台。路由拦截必须在 `handler/before-prepare` 阶段完成，既不执行被拒绝路由的数据准备或业务逻辑，也不得在 Hydro 建立 handler 前直接返回导致重定向被改写成 500。该约束先于管理员旁路，管理员只有在普通浏览器 session 中才可旁路；考试壳内普通 HTML 表单的 4xx 错误不得退回主 OJ 壳。
- 显式学校、用户组或 legacy `assign` 受众在封锁窗口内提前封锁；邀请码继续要求 `ContestStatus.attend`。真正不限参赛的个人赛只封锁已经通过 Client 入场且存在 `attend` 的用户，不得再把域内全部已绑定学生视作受众。
- 团队赛只封锁未处于批次待定版状态且属于 active `ContestTeam` 的成员；不得用不限范围、预绑定批次或运行时批次回查扩大受众。
- Client 自动 attend 成功后必须立即精确失效 `(domainId, uid)` 封锁缓存并记录审计；团队定版、建队和成员变化必须在仍持有同一比赛轻量边界时同步失效对应域缓存，再执行邀请清理或 Vigil 网络调用。任何失效都要推进进程内 generation，禁止并发旧计算重新写回；退出 Client 不清除 attend，也不在窗口结束前恢复普通浏览器。不得为此新增数据库状态、后台任务或 Client/Vigil Server 协议。

## Vigil 逐终端身份与命令协议

- OJ 的 `endpoint.enrollmentBatches` 只保存入网批次、容量、过期、摘要和 claim/finalize 业务事实；完整入网码只在创建响应出现一次。Vigil Server 保存逐终端公钥、状态与换机链，Windows 私钥由 CNG 以 machine key 持久化且禁止导出；`machineId`/硬件摘要只作诊断，不是认证因子。
- Endpoint WebSocket、截图上传和后续终端写入口只接受活动逐机凭据的短期签名证明；共享 `client_token`、空配置开放、裸 `ws://` 和只靠硬件指纹的兼容路径均禁止。客户端必须使用 `wss://` 并固定部署证书的 SPKI SHA-256；证书或固定值不匹配时 fail closed。
- Server 下发的能力命令必须是版本化 ES256 envelope，精确绑定 endpoint、activity、command、revision、签发/过期时间和显式能力名称。客户端在执行前持久化每个 activity 的最高 revision；重放、过期、错 scope、未知 schema/命令或签名失败均不得执行。协议没有 shell、脚本、任意可执行文件或任意文件写入能力。
- 入网批次和终端吊销当前只允许 `PRIV_EDIT_SYSTEM`；换机必须创建容量为 1、显式绑定旧 endpoint 的 replacement 批次，Vigil 原子地停用旧凭据。日志可记录 endpoint/batch/claim/revision/stage/reason，但不得记录私钥、公钥签名、token、完整入网码或剪贴板/文件正文。
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
- Endpoint Service 信任的控制面地址、SPKI、公钥、网络状态、Service 防重放游标与由 Service 代管的 GUI 独立游标必须位于独立的 `%ProgramData%\KryptonVigilMachineTrust`；普通 GUI 的 `config.kvs` 继续留在共享配置目录，但不得成为 Service 的信任输入。machine trust 根及其 `ServiceState` 必须在创建调用本身携带 SYSTEM/Administrators owner 与受保护的 SYSTEM/Admin-only DACL，普通用户不得拥有父目录 `DELETE_CHILD`；预存的不可信根必须 fail closed，禁止静默接管或在共享目录下只加固子目录。每次读取前重新验证，父路径任一 reparse point/junction、符号链接或非普通文件都必须 fail closed。提升恢复可以清理 WFP，但父路径不可信时不得沿该路径删除文件，必须明确报告状态路径未修复。状态文件缺失但 WFP 中仍有 Krypton 托管过滤器时必须拒绝启动并要求提升后的恢复，禁止猜测状态或静默解锁。卸载只允许 inactive/无状态，必须先取得 SCM 删除句柄，再事务删除托管过滤器、动态关键字和持久子层，最后删除服务；任一步失败都不得留下无 owner 的半卸载状态，原服务此前运行时必须尝试恢复。恢复工具只可查看安全摘要、导出不含签名正文的诊断或清理 Krypton 管理的规则，不提供万能密码、恢复码、通用配置编辑或远程命令。提权 WFP 集成测试必须默认不注册、显式开启，并以栈展开清理隔离的持久规则。
- Endpoint 身份轮换必须先停止既有 Service，并在联系 Server 前确认持久网络状态仅为 missing/inactive 且不存在托管过滤器；active/apply-pending/release-pending 必须拒绝轮换并恢复原 Service。新 endpointId 激活后，已验证的 inactive 状态必须幂等重绑到新身份，再初始化新 replay cursor 并重启；失败保留受保护 pending claim 供同一码重试。`RotateEndpointKey` 与 `SkipEnrollment` 必须 fail fast 互斥，既有服务轮换不得再次调用 `CreateService`。

## Endpoint 执行事实与 ACK 协议

- Vigil 以 `EndpointExecutionSession` 持久记录每次认证连接，以 `EndpointExecutionCommand` 持久记录签名 envelope、endpoint/activity/command revision、capability、预期策略 revision、连接 session、过期时间和最终结果。命令必须先与 replay cursor 在同一数据库事务中创建为 queued，才允许尝试 WebSocket 发送；随后只进入 sent、applied、failed、expired 或 offline，禁止用内存 pending 充当 canonical。Server 启动时必须把遗留 queued 明确标成未发送的 offline，允许同一不可变策略用新的 command revision 重试；sent 不得据此猜测结果。
- Endpoint 的 `command_result` 必须回显签名命令的 `activityId` 与 `revision`，并与持久 commandId、endpoint、capability、command 和预期网络身份精确核对。相同终态 ACK 幂等；冲突、未知、未发送、过期或降级结果 fail closed。已经持久接受但 WFP 首次执行失败的 apply/release pending 仍保持 sent，不得误记 failed；Endpoint 通过现有心跳和重连 hello 持续上报实际网络状态，成功重试后由原命令精确收敛为 applied，超时仍进入 expired。Server 重启把遗留连接标为断开，但不把 sent 猜成成功；apply 只有完整活动授权与唯一未决命令精确一致时才可补记 applied；stop 还必须由受保护的持久状态回报最后成功 stop 的 commandId、command revision、activityId 和 policy revision，普通 inactive 或硬截止不得冒充 stop ACK。重连对账与终态写入必须原子或 CAS，过期及并发 ACK 只能形成无副作用的 no-op，失败注册不得留下在线会话。
- 单站只使用现有数据库和 endpoint 级 asyncio 边界；不为 P1.11 引入消息队列、分布式调度或 Dashboard 共享 token 权限模型。P1.11 不提供独立网络锁管理入口、不创建 OJ 业务活动，也不复制 OJ canonical；这些仍属于 P1.12–P1.17。

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
