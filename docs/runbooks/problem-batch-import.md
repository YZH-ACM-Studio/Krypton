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
- 已注册的来源模板及其 `year/round/season/level`；
- 专用来源账号的 `author.uid` 和精确 `author.username`；官方来源账号不得是 root、UID 2、actor 或其他题库管理员；
- 已存在训练的精确 `id/title` 与本场 `chapterTitle`；
- 明确的筛选字段、运算符、阈值和证据来源；
- 每题的稳定 `sourceProblemCode`、标题、难度、导图节点 ID、赛时 `accepted/submitted`；
- Markdown、图片/附件、testdata 文件完整清单、可选 checker 和显式 `cases`。

manifest 不接受 PID。PID 只能由 `preflight` 根据当时的服务端 counter 生成。题面中的图片必须使用 Hydro `file://<target>`，声明的资源目标必须与引用一一对应；样例必须使用成对的 ``inputN`` / ``outputN`` fenced block。

批次文件的真实路径必须留在 manifest 所在目录内，符号链接不能越界。`testdata.files`、cases 与 checker 不得占用保留名 `config.yaml`；独立配置文件无论本地文件名是什么，上传时都固定成为该名称。

## 2. 本地校验

```bash
hydrooj problem:batch-import validate /absolute/path/to/batch.json
```

`validate` 不初始化 Hydro runtime、不访问数据库，只读取本地 manifest 和文件。成功时 stdout 只有一条 JSON，包含批次指纹、逐题文件/资源/测试点统计；失败时非零退出并在 stderr 输出结构化错误。

必须在继续前人工核对：题目筛选、标题/难度、导图节点、图片、赛时统计、checker、逐题 cases 数和总 cases 数。任何歧义必须写入该题的 `ambiguities` 并明确设为 `confirmed: true`；未确认项不能 apply。

## 3. 生产只读预检

先按 [CLAUDE.md](../../CLAUDE.md) 确认当前部署路径和生产主机，再在生产部署的新代码上执行：

```bash
cd /opt/Krypton
./packages/hydrooj/bin/hydrooj.js problem:batch-import preflight /absolute/path/to/batch.json
```

默认生成同目录 `batch.preflight.json`（0600）。预检只读核对：

- actor、专用来源账号 UID/用户名；
- 来源 counter 与逐题计划 PID；
- 导图节点及物化标签；
- 训练 ID/标题、来源锚点、目标章节 ID/顺序；
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

执行顺序是：全批 hidden managed drafts → 题面/资源/testdata/checker/config/origStat → 全批 readiness 检查 → 创建或复用精确的首章节 → 逐题走 canonical publication。没有跨整批的大事务，也没有后台恢复器；持久 import identity、本地 execution report 和幂等阶段用于显式续跑。不会自动创建训练，也不会自动删除失败草稿。

## 5. Verify、失败与续跑

```bash
cd /opt/Krypton
./packages/hydrooj/bin/hydrooj.js problem:batch-import verify /absolute/path/to/batch.json \
  --plan /absolute/path/to/batch.preflight.json \
  --report /absolute/path/to/batch.execution.json
```

`verify` 逐题读取并核对：作者唯一 active author permit、PID、来源、系统/导图标签、题面、资源和 testdata SHA-256、解析后的 config/cases、origStat 审计、hidden/metadataStatus，以及训练首章节顺序、成员次序和章节创建审计。origStat 与章节审计使用稳定 `requestId`；业务写已成功但审计写失败时，续跑只补齐缺失审计，不重复改统计或章节，审计内容冲突则停止。

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
