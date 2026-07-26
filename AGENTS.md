# Krypton Agent Rules

## 全局工程规则

1. **Fail Fast / Errors Never Pass Silently**：不要用兜底逻辑吞掉错误或隐藏问题。错误必须明确暴露，并保留足够上下文供定位。
2. **Fix the Cause, Not the Symptom / Don't Paper Over Bugs**：必须定位并修复根因，不得用针对性补丁掩盖问题。
3. **Make It Observable**：关键流程必须有充分日志和可观测性。信息不足时，应补充日志并如实说明，不得假装已经修复。
4. **Design for Debugging / Traceability**：关键节点和外部写入必须可追溯，能够确认执行到了哪里、写入了什么以及验证结果。
5. **Living Documentation / Single Source of Truth**：关键技术栈、产品方向或固定工作流变化时，同步更新本文件和对应的唯一事实源，避免文档与实际实现脱节。

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
