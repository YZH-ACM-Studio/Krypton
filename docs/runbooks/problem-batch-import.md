# 赛事题目批量导入 Runbook

唯一入口：

```bash
hydrooj problem:batch-import <validate|preflight|apply|verify> <manifest>
```

这条同步流水线适用于“题面 PDF/文档 + 评测数据压缩包 + 赛时统计截图/表格”。Agent 先在本地把非结构化材料整理成确定性批次；生产命令不做 OCR、翻译、标签推断、模糊合并或训练创建。

## 1. 批次目录

目录至少包含：

```text
batch.json
statements/<code>.md
assets/<code>/...
testdata/<code>/*.in|*.out|checker...
config/<code>.yaml
```

`batch.json` 必须声明：

- `schemaVersion: 1`、稳定且唯一的 `batchId`、`domain`、管理员 `actor`；
- 可选的最终可见性 `visibility: public|hidden`；省略时兼容 v1 并最终公开；
- 已注册的来源模板及其 `year/round/season/level`；
- 专用来源账号的 canonical `author.uid` 和人工核对用的 `author.username` 快照；官方来源作者 UID 不得是 UID 2、actor 或实时题库管理员，用户名字符串本身不具有授权含义；
- 已存在训练的精确 `id/title` 与本场 `chapterTitle`；历史回填还须声明既有 `chapterId` 和要精确替换的 `replacePids`；
- 明确的通过量筛选，或用户给出的完整 `sourceProblemCode in [...]` 清单及证据来源；
- 每题的稳定 `sourceProblemCode`、标题、难度、导图节点 ID；只有材料真实提供赛时数据时才写 `accepted/submitted`，不得用 `0/0` 代替未知；
- Markdown、图片/附件、testdata 文件完整清单、可选 checker 和显式 `cases`。

manifest 不接受 PID。PID 只能由 `preflight` 根据当时的服务端 counter 生成。题面中的图片必须使用 Hydro `file://<target>`，声明的资源目标必须与引用一一对应；样例必须使用成对的 ``inputN`` / ``outputN`` fenced block。

批次文件的真实路径必须留在 manifest 所在目录内，符号链接不能越界。`testdata.files`、cases 与 checker 不得占用保留名 `config.yaml`；独立配置文件无论本地文件名是什么，上传时都固定成为该名称。

## 2. 本地校验

```bash
node -r ./node_modules/@hydrooj/register \
  ./packages/hydrooj/bin/hydrooj.js problem:batch-import validate /absolute/path/to/batch.json
```

`validate` 不初始化 Hydro runtime、不访问数据库，只读取本地 manifest 和文件。成功时 stdout 只有一条 JSON，包含批次指纹、逐题文件/资源/测试点统计；失败时非零退出并在 stderr 输出结构化错误。

必须在继续前人工核对：题目筛选、标题/难度、导图节点、图片、可用的赛时统计、checker、逐题 cases 数和总 cases 数。任何歧义必须写入该题的 `ambiguities` 并明确设为 `confirmed: true`；未确认项不能 apply。

生成结构化题面及执行本地 `validate` 必须使用上述 Node + `@hydrooj/register` 入口，不得用 Bun 直接运行含 `String.raw` 的题面生成器。流水线会拒绝 canonical 题面中残留的 CJK `\\uXXXX` 字面量；这类内容表示生成器把 Unicode 源码转义误当成了正文，禁止带病导入。

使用 `checker_type: testlib` 时，checker 必须从真实进程入口接收文件路径：`int main(int argc, char* argv[])` 调用 `registerTestlibCmd(argc, argv)`。禁止丢弃真实参数后硬编码 `input/user_output/output` 等外部平台文件名；Hydro 的 testlib 运行契约是通过 argv 传入输入、选手输出和标准答案的绝对路径，文件名不是公共协议。`validate` 会在生产预检前拒绝缺少标准进程入口或未转发 `argc/argv` 的 testlib checker。

SPJ 还必须在真实 go-judge sandbox 做无 Record 的冷编译和正反例烟测：官方输出作为选手输出应被接受，删改 token 或明显非法输出应被拒绝。只通过本机编译、只验证 `config.yaml`，或者只命中既有 checker 编译缓存，都不能证明 SPJ 可用；烟测不得创建提交或触发历史重测。

## 3. 生产只读预检

先按 [CLAUDE.md](../../CLAUDE.md) 确认当前部署路径和生产主机，再在生产部署的新代码上执行：

```bash
cd /opt/Krypton
./packages/hydrooj/bin/hydrooj.js problem:batch-import preflight /absolute/path/to/batch.json
```

默认生成同目录 `batch.preflight.json`（0600）。预检只读核对：

- actor、专用来源账号 UID，以及它们当时的用户名显示快照；后续 apply/verify 只以 UID 识别同一账号；
- 来源 counter 与逐题计划 PID；
- 导图节点及物化标签；
- 训练 ID/标题、来源锚点、目标章节 ID/绝对顺序；历史回填同时核对待替换成员；
- `batchId + sourceProblemCode` 的既有导入身份与内容指纹；
- 精确标题或计划 PID 命中的 legacy 疑似重复。

`preflight` 只加载 Hydro 数据库配置，并通过专用适配器执行 Mongo `find/findOne`；它不初始化 addon runtime，不创建/修复索引，也不运行迁移或任何生产写方法。plan 文件是写在 manifest 同目录的本地审计产物，不属于生产数据写入。

同一 identity + 同一指纹可以续跑；同一 identity + 不同指纹立即冲突。legacy 疑似重复只报告并停止，必须由用户决定，流水线不会覆盖、迁移或补身份字段。

保存 stdout JSON，并人工核对 plan 中的 `fingerprint`、`confirmationToken`、actor、PID、章节及全部逐题状态。任何生产事实变化后必须重新 preflight，旧 plan 不可复用。

## 4. Apply 前确认与备份

`apply` 会写生产，属于 [CLAUDE.md §4.1](../../CLAUDE.md) 的源码部署加生产数据变更。必须先：

1. 展示源码部署、数据库/配置备份、counter/训练只读检查、apply 和 verify 的完整命令；
2. 等用户明确批准；
3. 完成备份并验证备份存在；
4. 确认使用的 manifest 与 preflight plan 未改变。

批准后使用 plan 中的原值执行：

```bash
cd /opt/Krypton
./packages/hydrooj/bin/hydrooj.js problem:batch-import apply /absolute/path/to/batch.json \
  --plan /absolute/path/to/batch.preflight.json \
  --report /absolute/path/to/batch.execution.json \
  --fingerprint '<plan.fingerprint>' \
  --confirm 'APPLY:<batchId>' \
  --actor '<manifest.actor>'
```

缺少或不匹配 fingerprint、token、actor，或 counter/账号/导图/训练/已有题状态发生漂移，命令都会在写入前非零退出。

执行顺序是：全批 hidden managed drafts → 题面/资源/testdata/checker/config/可选 origStat → 全批 readiness 检查 → 创建最新首章节，或以 CAS 清除 manifest 明确声明的历史占位成员并保持章节绝对位置 → 逐题走 canonical metadata/训练/可见性确认。`visibility: hidden` 会保持题目隐藏，但不会跳过确认、训练挂载或 verify；禁止先公开再另行补写隐藏。没有跨整批的大事务，也没有后台恢复器；持久 import identity、本地 execution report 和幂等阶段用于显式续跑。不会自动创建训练，也不会自动删除失败草稿。

## 5. Verify、失败与续跑

```bash
cd /opt/Krypton
./packages/hydrooj/bin/hydrooj.js problem:batch-import verify /absolute/path/to/batch.json \
  --plan /absolute/path/to/batch.preflight.json \
  --report /absolute/path/to/batch.execution.json
```

`verify` 逐题读取并核对：作者唯一 active author permit、PID、来源、系统/导图标签、题面、资源和 testdata SHA-256、解析后的 config/cases、origStat 审计、hidden/metadataStatus，以及训练章节绝对位置、成员次序和章节审计。origStat 与章节审计使用稳定 `requestId`；origStat 或最新首章节创建在业务写已成功但审计响应丢失时可续跑补齐。历史章节已经清空却没有同一批次、章节、操作者和 `replacePids` 的成功审计时必须 fail closed，禁止凭“存在草稿且章节为空”猜测为已执行；该极小窗口需保留现场并人工处置。

进程中断或任一步失败时：

1. 不手工改库、不删除草稿、不改 counter；
2. 保留原 manifest、plan 和 execution report；
3. 新会话先运行 `verify` 读取实际状态；
4. 根据结构化错误修复本地输入或生产根因；如果本地内容或生产预检事实改变，重新 `preflight` 并再次取得用户批准；
5. 若事实未变且只是已批准运行中断，使用同一 plan/fingerprint/token/actor 再次 `apply`，完成后再次 `verify`。

若 execution report 出现 `publication-incomplete`，说明 canonical publication 已提交核心题目状态，但报告列出的 `incompleteStages` 尚未完成。此时同一 report 的 `apply` 会在任何新写入前拒绝继续；`verify` 仍执行只读实态核对，但最终保持非零退出，不能把该事件洗成成功。保留 report 中的 `requestId`，先定位并修复对应根因，再由用户明确决定新的预检/执行边界；禁止删除或手改 report 来绕过检查。

stdout JSON、stderr、退出码和 `batch.execution.json` 是审计边界。不得把“本地 validate 成功”“部分草稿 ready”或“进程退出 0 但未 verify”报告为上线完成。

## 6. 2026 牛客第 1 场回归 fixture

本地保留的规范化 fixture：

```text
tmp/nowcoder-2026-multi-1/batch.json
```

它必须持续通过 `validate`，并精确报告 A/C/E/F/G/H/J 共 7 题、173 个 cases、G 的 1 张图片、J 的 11 张图片，以及 F/G/H 的 checker。该目录是本地运维素材，不进入 Git。生产现有同标题题属于旧一次性导入结果；在未作用户决策和显式迁移前，新流水线应将其报告为 legacy 疑似重复，不能自动接管。
