# CLIENT_PROCTOR_MONITORING_DESIGN.md

# Krypton 反作弊客户端 — 实时监考能力增强（直播 / 录屏 / 摄像头 / 事件 / 控制 / UI）

> Companion to [`CLIENT_REQUIRED_CONTEST_DESIGN.md`](CLIENT_REQUIRED_CONTEST_DESIGN.md) 与 [`CLIENT_FLUENT_REDESIGN.md`](CLIENT_FLUENT_REDESIGN.md)。
> 本文档记录在 client-required-contest 与 Fluent 重设计基础上，**为 OJ-Vigil-Client 三方系统补齐"老师能实时看见学生屏幕 / 摄像头 / 行为日志，并能远程下发监考命令"** 的设计与实施计划。

---

## 0. 摘要

### 0.1 目标

- **修两个必修 bug**：`ExamShell` 不接 `userMessageRequested` 信号 + 服务器配的 `screenshotIntervalMs` 被客户端忽略
- **新增能力**：客户端真正实现屏幕录制 / 摄像头采集 / RTMP 实时推流 / 8 类行为事件检测 / 三级消息 UI / 全屏锁屏遮罩 / 截屏抖动
- **新增能力（服务器侧）**：媒体中转（SRS）+ 操作审计 + HLS 鉴权反代 + 文件生命周期管理
- **重构 UI**：`/admin/vigil/exams/:examId` 升级为"学生卡片墙 + 右滑抽屉 + 行为日志详情弹窗"的监考核心视图

### 0.2 范围

| 仓库 | 改动 |
|---|---|
| **VigilClient**（独立 repo） | `RtmpPublisher` 模块 + 8 类事件检测 + 命令处理扩展 + UI 信号路由修复 + 内置 ffmpeg.exe |
| **VigilSystem/Server** | DB schema 扩展 + 11 个新路由 + SRS callback + WS 协议扩展 + TTL + cleanup cron |
| **Krypton/krypton-vigilguard** | contest 字段扩展 + pushExamToVigil 透传 |
| **Krypton/packages/ui-next** | `/admin/vigil/exams/:examId` 完全重构 + 直播/录屏/详情三个弹窗 |
| **Krypton/packages/ui-next** | contest-manage "客户端与反作弊" tab 字段扩充 |
| **oj** 部署 | Caddy 反代 + hydrooj forward_auth endpoint |
| **oj-vigil** 部署 | SRS 二进制 + systemd unit + 磁盘扩容 + IP 白名单 |

### 0.3 17 个 grill 决策一句话汇总

| # | 决策 |
|---|---|
| Q1 | 范围 = 全做（直播 + 录屏 + 摄像头 + 控制 + 修 bug + UI 重构） |
| Q2 | 直播策略 = 真实视频流（非缩略图伪直播） |
| Q3 | 直播协议 = RTMP 推 + HLS-LL 拉，via SRS 媒体服务器 |
| Q4 | 三开关粒度 = 比赛级；默认 live ON · record OFF · camera ON |
| Q5 | 编码 = 屏幕 1080p @ 5fps @ 1.5 Mbps；摄像头 480p @ 5fps @ 400 kbps；全部软编（H.264 libx264 ultrafast） |
| Q6 | 截屏 = 定时（带抖动）+ 事件触发 + 命令触发 三套并存；录屏开时不停定时 |
| Q7 | 命令 = 7 个（take_screenshot / lock_screen / unlock_screen / send_message / notify_warning / restart_stream / flush_logs）；锁屏=全屏遮罩；消息 3 级；信号 bug 全量审计修复 |
| Q8 | UI 重构 = 替换概览 tab → 卡片墙；5 级状态；右侧滑出抽屉；行为日志详情弹窗 |
| Q9 | 直播弹窗 = PIP（屏大摄小）+ 镜像快捷按钮；录屏回放 HLS.js；摄像头授权 fail-soft + GPO |
| Q10 | 事件 = 8 类（去任务管理器 + 键盘 hook）；进程白名单 server 全局+contest 双层；USB 仅存储；severity 4 级；客户端 60s 聚合 |
| Q11 | 权限 = 沿用 `admin.vigil.*`；新建 `vigil.command_audit` 表；高危 + critical 二次确认 + 可选 reason；命令回执 InfoBar toast |
| Q12 | 群发 = 仅 `send_message` / `notify_warning`；顶部固定按钮；stream key 格式 `{contestId}_{machineId}_{stream}`；SRS 仅 IP 白名单 |
| Q13 | TTL 各类型独立（文件 7-14d，DB 30-90d）；mongo TTL index + cron 清文件；5 个新 WS 消息；contest 维度订阅；30s/60s 应用层心跳 |
| Q14 | 推流栈 = QProcess + 内置 ffmpeg.exe（最新版）；屏幕用 ddagrab；摄像头用 dshow；启动时锁定配置；ffmpeg `-reconnect` + QProcess 重启；fail-soft 不打扰学生 |
| Q15 | 服务器 = 11 个新 REST endpoint；HLS 走 Caddy 反代到 oj-vigil（forward_auth 鉴权）；SRS 二进制 + systemd；live-record / live-nodvr 双 application |
| Q16 | 实施 = 5 个 Phase（MVP 直播 → 监考核心 → 事件 → 录屏 → 运维加固）；先 audit client；建本设计文档 |
| Q17 | 性能 = 每页 30 张卡片分页；状态优先级排序；筛选 + 搜索；4 个直播弹窗上限；视频强制 cleanup；混合 WS 订阅（status 全收 / screenshot 按页） |

### 0.4 关键风险与对策

| 风险 | 对策 |
|---|---|
| 300 学生 × 1080p 推流 = oj-vigil 千兆口接近饱和（570 Mbps / 940 Mbps） | systemd `CPUAffinity` 隔离 SRS 与 vigil API；机房交换机做 QoS；监控 Phase 4 加 |
| 软编 H.264 老旧学生机 CPU 占用过高 | libx264 `-preset ultrafast` 实测 i5 8 代约 15-25% 单核，可承受；客户端预装时机房按硬件分级（老机器降 720p） |
| 推流失败影响考试 | **强制 fail-soft 原则**：所有推流 / 编码 / 网络错误只 log + 上报 event，绝不阻塞 ExamWebview 流程 |
| 录屏 0.5 TB / 场 | 默认 OFF；oj-vigil 扩盘到 2 TB；7d TTL；关键场次手动归档 |
| WS 订阅消息风暴 | contest 维度订阅 + status 全收 + screenshot/event 按页订阅 + 客户端 60s 聚合 |
| 客户端键盘 hook 触发杀软告警 | 不做键盘 hook（Q10 决策）；防绕过靠 watchdog 重启 |

---

## 1. 现状基线

来源：2026-05-27 audit。所有文件路径相对 `ecosystems/KryptonVigilSystem/Client/`。

### 1.1 VigilClient 仓库目录结构

| 子目录 | 职责 |
|---|---|
| `app/` | 顶层窗口 + 入口。`main.cpp` / `exam_shell.{h,cpp}` / `exam_webview.{h,cpp}` / `login_window.{h,cpp}` / `main_window.{h,cpp}` (legacy) / `headless_agent.{h,cpp}` (--agent mode) / `runtime_options.{h,cpp}` |
| `core/` | `client_config.h` / `config_manager.{h,cpp}` / `app_logger.{h,cpp}` / `device_info_collector.{h,cpp}` |
| `network/` | `server_connection.{h,cpp}` (WS client) / `command_dispatcher.{h,cpp}` / `screenshot_uploader.{h,cpp}` + queue / `network_lock_*` (WFP firewall + URL interceptor) |
| `capture/` | `screenshot_service.{h,cpp}` (QScreen JPEG) / `media_probe.{h,cpp}` (设备**枚举**，无 capture) |
| `monitor/` | `system_monitor.{h,cpp}` / `periodic_collector.{h,cpp}` / `risk_rule_engine.{h,cpp}` / `lockdown.{h,cpp}` + `lockdown_win.cpp` (键盘 hook) / `platform/platform_monitor_{win,linux,macos,stub}.cpp` |
| `events/` | `event_reporter.{h,cpp}` — **已有 dedupe + rate limit + 离线缓冲（max 100）** |
| `watchdog/` | `watchdog_supervisor.{h,cpp}` (QProcess parent) / `restart_limiter` / 等 |
| `ui/fluent/` | Phase 1-3 Fluent infra（palette / style / backdrop / QSS） |
| `ui/widgets/` | Phase 1-3 widgets：`frameless_dialog` / `content_dialog` / `info_bar` / `progress_ring` |

### 1.2 Qt 版本 + 第三方依赖

- Qt: 最低 6.5 / CI 用 6.7.3，模块 `Multimedia / Network / WebSockets / Widgets / WebEngineWidgets / WebChannel / Svg / Positioning`
- Windows libs: `crypt32 / advapi32 / userenv / wintrust / wtsapi32 / fwpuclnt / rpcrt4 / dwmapi`
- **无 FFmpeg / x264 / librtmp** — 全新搭建编码 + 推流栈
- `wtsapi32` 已 link 但**无调用方** — 可直接用于 session lock 检测

### 1.3 现有 WS 协议

- **URL**: `{serverBaseUrl}/api/ws/clients/{clientId}` — 比 design doc 里之前写的 `/api/clients/ws` 准确
- **Auth**: header `X-KVS-Token: {token}`
- **心跳**: client 每 5000ms 发 `{ type: "heartbeat", sequence, capabilities, ... }`
- **离线缓冲**: `client_event` 通道在断连时 push 入 queue（max 100，超出丢最早）

**Client → Server 消息类型**: `heartbeat / device_info / media_devices / login_request / student_finish_request / client_event / command_result`

**Server → Client 命令类型**（已实现，17 个）:
```
ping, collect_device_info, health_check, get_config, set_config_patch,
collect_logs, list_media_devices, test_media_devices, test_screenshot,
test_monitor_permissions, capture_screenshot, show_message, disconnect,
reload_config, restart_agent, launch_exam_webview, close_exam_webview
```

⚠️ **意外发现**：`capture_screenshot` 和 `show_message` 已存在。本设计原定的 `take_screenshot` / `send_message` 应改为**复用**这两个现有命令并扩展 payload，不要新增重复命令（详见 §6 修订）。

### 1.4 现有截屏 / QCamera / 录屏现状

- **截屏**: `ScreenshotService::capturePrimary` 用 `QGuiApplication::primaryScreen()->grabWindow(0)`，编 JPEG (quality 70) → multipart upload 到 `/api/uploads/screenshots`。表单字段：`client_id / exam_id / command_id / width / height / file`。**无 `eventId / reasonTag / sessionId` 字段** — 需扩展。
- **PeriodicCollector**: 在 `monitor/periodic_collector.{h,cpp}`，由 `HeadlessAgent` 和 `MainWindow` 实例化，**ExamShell 不实例化**。`config.periodicScreenshotIntervalMs` 默认 30000ms，min 5000 / max 600000。
- **QCamera**: **完全无 capture 代码**。仅 `QCameraDevice` 元数据枚举（`media_probe.cpp`）。无 `QMediaCaptureSession` / 无 `QImageCapture` / 无 video preview。
- **录屏**: 零代码。
- **直播推流**: 零代码。

### 1.5 用户消息 bug 复现（Bug #1 确认）

- `userMessageRequested` 信号在 `command_dispatcher.h:35` + `server_connection.h:55` 定义
- 在 `command_dispatcher.cpp:249` (handle `show_message`) emit
- **唯一 connect 处**：`main_window.cpp:495` 调 `QMessageBox::information`
- ExamShell::run() 连接 5 个 ServerConnection 信号但**未连接 `userMessageRequested`**
- 学生 GUI 模式下 MainWindow 从未实例化 → **老师发的消息完全无处可去**
- `command_result` 仍返回 `ok=true`，**服务器误以为成功**

### 1.6 screenshotIntervalMs bug 复现（Bug #2 加重确认）

- `command_dispatcher.cpp:288` **确实解析**了 `screenshotIntervalMs`
- 通过 `launchExamWebviewRequested` 信号传出到 ExamShell
- ExamShell::onLaunchExamWebview 接收时**参数名被注释掉**（`exam_shell.cpp:229`）→ 永远不使用
- ⚠️ **更严重**：ExamShell 根本没有 `PeriodicCollector` 实例 — 学生模式下**定时截屏从未跑过**。整个定时取证链路在学生 GUI mode 完全失效。
- **修复需要两步**：(a) 在 ExamShell 里实例化或挂接 `PeriodicCollector`，(b) 用 launch payload 的 `screenshotIntervalMs` + 新增 `screenshotJitterMs` 配置它

### 1.7 现有事件检测（5 类，全部基于轮询）

| 触发位置 | 事件 type | severity | 实现 |
|---|---|---|---|
| `system_monitor.cpp:146` | RiskRuleEngine match | rule-defined | 进程风险匹配 |
| `system_monitor.cpp:159` | window 标题包含禁字 | rule-defined | 窗口标题轮询 |
| `system_monitor.cpp:180` | `window.foreground_changed` | info | 5s 轮询 `GetForegroundWindow` |
| `system_monitor.cpp:223` | `input.hotkey` | medium | 配置内的可疑组合键 |
| `system_monitor.cpp:244` | `clipboard.changed` | medium | 剪贴板 sha256 变化轮询 |
| `periodic_collector.cpp` | `telemetry.*` | info/medium | 截屏失败 / 队列 / 设备快照等 |

进程检测：`CreateToolhelp32Snapshot + Process32FirstW/NextW` 轮询（`platform_monitor_win.cpp:89-104`），间隔 `processScanIntervalMs`。

**完全无的检测**（待实现）：USB / 多显示器 / 系统锁屏 / 摄像头掉线 / 网卡变化 / 打印动作。

### 1.8 Lockdown 现状（比预期完整）

- `Lockdown::engage` 在 `lockdown_win.cpp:73` 用 `SetWindowsHookExW(WH_KEYBOARD_LL, ...)`
- **已 swallow**：Alt+Tab / Alt+Esc / Ctrl+Esc / Ctrl+Shift+Esc / 单 Win 键 / Win+D/L/R/E
- 仅 Ctrl+Alt+Del 文档明确放弃（kernel SAS）
- 全屏：`showFullScreen()`（无 `WindowStaysOnTopHint`，理论上可被 Win+Tab 越层；考虑加 `Qt::WindowStaysOnTopHint`）

### 1.9 可复用基础设施清单

| 模块 | 用途 |
|---|---|
| `EventReporter` ([events/event_reporter.cpp](events/event_reporter.cpp)) | dedupe + rate limit + 离线缓冲。新 8 类事件直接复用 |
| `Fluent::ContentDialog` / `InfoBar` / `ProgressRing` | 三级 send_message UI 直接复用 |
| `Fluent::FramelessDialog` + Mica | LockScreenOverlay 复用 |
| `WatchdogSupervisor` + `RestartLimiter` | 是 ffmpeg QProcess 管理的好模板 |
| `ClientConfig` + `ConfigManager` | 配置持久化 + WS `set_config_patch` 动态变更 |
| `ScreenshotUploader::upload` multipart 模式 | 后续若要上传录屏分片可参考 |
| `client_event` WS 通道（generic） | 新事件类型不需要加 WS message type，只需扩展 type 字段 |
| `Lockdown::engage()` 键盘 hook | 已 swallow 主要系统热键，复用 |
| WFP firewall infra | 已有，可扩展到进程级 outbound 阻塞 |
| `wtsapi32` 已 link 无调用 | 直接用于 `WTSRegisterSessionNotification` |

### 1.10 测试 / CI 现状

- **零单元测试** — 无 `tests/`，无 QtTest
- CI: 单一 workflow `.github/workflows/build-windows.yml`，仅 Release 构建 + artifact 上传。无 lint / test step

---

## 2. 架构总览

### 2.1 系统组件拓扑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              老师 浏览器                                       │
│   ┌────────────────────────────┐  ┌─────────────────────────────────┐      │
│   │  /admin/vigil/exams/:cid  │  │ Direct HLS.js (1-4 弹窗)         │      │
│   │  · 卡片墙 (分页)           │  │   屏 + 摄像头 PIP                 │      │
│   │  · 右滑抽屉                │  │   ↓ http://oj/vigil-hls/...m3u8 │      │
│   │  · WS subscribe contest    │  │                                   │      │
│   └────────────┬───────────────┘  └────────────────┬────────────────┘      │
└────────────────┼───────────────────────────────────┼──────────────────────┘
                 │ HTTPS                              │ HTTP
                 ▼                                    ▼
        ┌────────────────────┐                ┌──────────────────┐
        │ oj (10.1.234.2)    │                │  oj (Caddy)       │
        │   Caddy            │                │   /vigil-hls/*    │
        │   ↓ reverse_proxy  │                │   forward_auth →  │
        │   hydrooj :8888    │                │   hydrooj         │
        │   /api/admin/...   │                │                   │
        └─────────┬──────────┘                └─────────┬─────────┘
                  │ service-token                       │ proxied
                  ▼                                     ▼
                          ┌─────────────────────────────────────────┐
                          │  oj-vigil (10.1.235.155)                 │
                          │                                          │
                          │  vigil-server (FastAPI :8765)            │
                          │  ├─ REST proctor /commands /screenshots │
                          │  ├─ WS dashboard /api/admin/ws          │
                          │  ├─ Client WS /api/clients/ws           │
                          │  └─ SRS callbacks /api/internal/srs/*   │
                          │                                          │
                          │  SRS (:1935 RTMP / :8080 HLS)            │
                          │  ├─ vhost live-record    (dvr 开)        │
                          │  ├─ vhost live-nodvr     (dvr 关)        │
                          │  └─ http_hooks → vigil-server           │
                          │                                          │
                          │  /data/vigil/                            │
                          │  ├─ screenshots/{date}/{uuid}.jpg        │
                          │  ├─ recordings/{contestId}/{date}/...mp4 │
                          │  └─ krypton-vigil.db (SQLite)            │
                          │                                          │
                          │  systemd: krypton-vigil + srs            │
                          │           + vigil-cleanup.timer (daily)  │
                          └────────────────┬─────────────────────────┘
                                           │ RTMP push (per student)
                          ┌────────────────┴─────────────────────────┐
                          │  Student PC (机房，预装客户端)              │
                          │                                          │
                          │  krypton-vigil-client.exe                │
                          │  ├─ ExamWebview (Qt + QWebEngine)        │
                          │  ├─ RtmpPublisher                        │
                          │  │   ├─ ffmpeg.exe (screen, ddagrab)     │
                          │  │   │   → rtmp://oj-vigil/live-record/  │
                          │  │   │       {cid}_{mid}_screen          │
                          │  │   └─ ffmpeg.exe (camera, dshow)       │
                          │  │       → rtmp://.../{cid}_{mid}_camera │
                          │  ├─ EventCollector (8 类检测)             │
                          │  ├─ ScreenshotScheduler (抖动 + 事件)     │
                          │  ├─ CommandDispatcher (7 命令)           │
                          │  ├─ LockScreenOverlay                    │
                          │  └─ WS Client → vigil-server             │
                          │                                          │
                          │  ffmpeg.exe 内置在 install dir           │
                          └──────────────────────────────────────────┘
```

### 2.2 三方数据流

**直播流（学生 → 老师，连续）**：

```
Student ffmpeg → RTMP push rtmp://oj-vigil:1935/live-record/{cid}_{mid}_screen
              → SRS 收 → 内部 dvr 写 mp4 (若 live-record 端) → on_dvr callback
              → SRS HLS 切片到 /tmp/hls/
                                                            │
老师浏览器  ← Caddy (oj) ← forward_auth check ← HLS.js   ←─┘
            /vigil-hls/.../live-record/{cid}_{mid}_screen.m3u8
```

**命令流（老师 → 学生，事件驱动）**：

```
老师点"实时截屏"
  → 前端 POST /api/admin/vigil/proctor/commands { machineId, command: "take_screenshot" }
  → vigil-server 写 vigil.command_audit { commandId, actor, ... }
  → vigil-server lookup client WS connection by machineId
  → push WS msg { type: "command", commandId, command: "take_screenshot" }
  → Client CommandDispatcher 执行 → 截屏 → 上传 screenshot
  → Client reply WS { type: "command_result", commandId, result: "ok" }
  → vigil-server 转推给所有订阅了 contest 的 dashboard WS
  → 前端按 commandId 关联 → InfoBar toast "已发送"
```

**事件流（学生 → 老师，连续，按 contest 订阅）**：

```
Client 检测到 USB 插入
  → 1) ScreenshotScheduler 立即抓 1 张 → 上传 screenshot { eventId: pending }
  → 2) EventCollector 60s 聚合窗口检查 → 写新 event { type: "usb_inserted", screenshotId, severity: error }
  → 3) WS 上报 vigil-server
  → 4) vigil-server push student.contest 订阅者：{ type: "event_added", machineId, eventId, severity, summary, ts }
  → 5) 前端 dashboard 状态计算 → 卡片状态 → "在线" 升级为 "异常"（橙色）
  → 6) 前端按学号过滤抽屉行为日志 → 新增一条
```

---

## 3. 比赛级配置

### 3.1 contest doc 新增字段

定义在 [packages/hydrooj/src/interface.ts](packages/hydrooj/src/interface.ts) 的 `Tdoc` 接口：

```ts
interface Tdoc {
  // ... 现有字段 (vigilEnabled, lockdownMode, etc.) ...

  // 三个独立媒体开关（仅当 vigilEnabled = true 时生效）
  liveEnabled?: boolean;          // default true: 客户端推屏幕 RTMP 流
  recordEnabled?: boolean;        // default false: SRS 落地 mp4 (300 人 1080p 存储巨大)
  cameraEnabled?: boolean;        // default true: 客户端推摄像头 RTMP 流

  // 截屏抖动 (新增，与现有 screenshotIntervalMs 配合)
  screenshotJitterMs?: number;    // default 30000 (60s ± 30s)

  // 进程白名单 (比赛级 override，全局默认在 vigil server)
  vigilProcessWhitelist?: string[];  // 例 ["Code.exe", "python.exe", "msedge.exe"]
}
```

### 3.2 字段语义

| 字段 | 默认 | 含义 |
|---|---|---|
| `liveEnabled` | `true` | 客户端推 RTMP 屏幕流。`false` 时跳过整个 RTMP 屏幕推流，老师看不到实时画面 |
| `recordEnabled` | `false` | SRS dvr 落地 mp4。**仅在 `liveEnabled=true` 时有效**；客户端推 RTMP 时 stream key prefix 用 `live-record` 而非 `live-nodvr` |
| `cameraEnabled` | `true` | 客户端额外推一路 RTMP 摄像头流。`false` 时不调 `QCamera`，省 CPU |
| `screenshotJitterMs` | `30000` | 客户端定时截屏的随机抖动幅度。实际间隔 = `screenshotIntervalMs ± rand(0, screenshotJitterMs)` |
| `vigilProcessWhitelist` | `[]` (用 server 全局默认) | 比赛允许的进程名列表。客户端检测进程启动时对照此列表 + server 全局默认 |

### 3.3 contest-manage UI 改动

[packages/ui-next/src/pages/contest-manage.tsx](packages/ui-next/src/pages/contest-manage.tsx) 的"客户端与反作弊" tab 增加：

```tsx
<div className="grid grid-cols-3 gap-4">
  <Checkbox name="liveEnabled" defaultChecked={tdoc?.liveEnabled !== false}>
    实时直播（客户端推屏幕 RTMP 流）
  </Checkbox>
  <Checkbox name="cameraEnabled" defaultChecked={tdoc?.cameraEnabled !== false}>
    摄像头流（防替考）
  </Checkbox>
  <Checkbox name="recordEnabled" defaultChecked={!!tdoc?.recordEnabled}>
    服务器录屏（mp4 落地，存储压力大）
  </Checkbox>
</div>

<label>截屏抖动幅度（ms）</label>
<Input type="number" name="screenshotJitterMs" defaultValue={tdoc?.screenshotJitterMs ?? 30000} min={0} step={1000} />
<p className="text-xs text-muted">实际截屏间隔 = 基础间隔 ± 抖动幅度，防止学生预判时机</p>

<label>进程白名单（每行一个）</label>
<Textarea name="vigilProcessWhitelist" defaultValue={(tdoc?.vigilProcessWhitelist ?? []).join('\n')} rows={6} />
<p className="text-xs text-muted">与服务器全局白名单合并。除此之外的进程启动会触发 warning event</p>
```

### 3.4 字段透传到 Vigil server

[packages/krypton-vigilguard/src/handler.ts](packages/krypton-vigilguard/src/handler.ts) 的 `pushExamToVigil` 调用：

```ts
await fetch(`${vigilBaseUrl}/api/oj/exams/upsert`, {
  method: 'POST',
  headers: { 'X-Service-Token': outboundToken },
  body: JSON.stringify({
    contestId, ...,
    liveEnabled: tdoc.liveEnabled !== false,
    recordEnabled: !!tdoc.recordEnabled,
    cameraEnabled: tdoc.cameraEnabled !== false,
    screenshotIntervalMs: tdoc.screenshotIntervalMs ?? 60000,
    screenshotJitterMs: tdoc.screenshotJitterMs ?? 30000,
    processWhitelist: tdoc.vigilProcessWhitelist ?? [],
  }),
});
```

Vigil server 收到后写到 `vigil.exams` 表（已有），客户端 launch 时通过 WS `launch_exam_webview` payload 拿到这些字段。

---

## 4. 媒体栈

### 4.1 编码参数定盘

| 流 | 分辨率 | 帧率 | 码率 | 编码 | 关键帧间隔 (GOP) |
|---|---|---|---|---|---|
| 屏幕 | **1080p**（原生，不下采样） | 5 fps | 1500 kbps | H.264 libx264 baseline ultrafast | 5s (25 frames) |
| 摄像头 | 480p | 5 fps | 400 kbps | H.264 libx264 baseline ultrafast | 5s |

**理由**：1080p 是学生屏幕原生分辨率（保留代码字体清晰度）；5 fps 监考绰绰；ultrafast preset 软编 CPU 占用约 15-25% 单核（i5 8 代实测）；GOP 5s 与 HLS-LL 切片对齐。

### 4.2 RTMP stream key 约定

```
{prefix}/{contestId}_{machineId}_{streamType}

prefix     = live-record  (when contest.recordEnabled = true)
           = live-nodvr   (when contest.recordEnabled = false)
streamType = screen | camera
```

举例：
- `rtmp://oj-vigil:1935/live-record/abc123_MX9F2_screen` — 屏幕，开 dvr 录屏
- `rtmp://oj-vigil:1935/live-nodvr/abc123_MX9F2_camera` — 摄像头，不录屏

### 4.3 SRS 部署与配置

**部署位置**：oj-vigil 同机器，独立 systemd unit。

**安装路径**：
```
/opt/srs/                      # SRS 二进制 + 静态资源
├── objs/srs                   # 二进制
├── conf/krypton.conf          # 主配置
└── objs/nginx/html/           # HLS 输出目录（symlink 或 dvr_path 写到这）
```

**systemd unit** (`/etc/systemd/system/srs.service`)：

```ini
[Unit]
Description=SRS (Simple Realtime Server) for Krypton Vigil
After=network.target krypton-vigil.service
Requires=krypton-vigil.service

[Service]
Type=simple
ExecStart=/opt/srs/objs/srs -c /opt/srs/conf/krypton.conf
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
User=srs
Group=srs

# 资源隔离 (oj-vigil 同机器，不要抢 vigil-server CPU)
CPUQuota=400%        # 最多 4 核
MemoryMax=4G

[Install]
WantedBy=multi-user.target
```

**krypton.conf** 关键段（详细见附录 C）：

```nginx
listen 1935;
max_connections 1000;
srs_log_tank file;
srs_log_file /var/log/srs.log;
http_server { enabled on; listen 8080; dir ./objs/nginx/html; }
http_api { enabled on; listen 1985; }   # localhost only

vhost __defaultVhost__ {
  hls {
    enabled on;
    hls_path ./objs/nginx/html;
    hls_fragment 2;
    hls_window 30;
    hls_dispose 30;        # 流断开 30s 后清理 ts 文件
  }
  http_hooks {
    enabled on;
    on_publish    http://127.0.0.1:8765/api/internal/srs/on_publish;
    on_unpublish  http://127.0.0.1:8765/api/internal/srs/on_unpublish;
    on_play       http://127.0.0.1:8765/api/internal/srs/on_play;
  }
}

# 两个 application 区分 dvr 启停
vhost live-record {
  refer { enabled on; all 10.1.0.0/16; }   # IP 白名单
  hls { enabled on; ... }
  dvr {
    enabled on;
    dvr_plan session;
    dvr_path /data/vigil/recordings/[stream]_[20060102_150405].mp4;
    dvr_duration 1800;     # 半小时分片，避免单 mp4 过大
    dvr_wait_keyframe on;
  }
  http_hooks {
    on_dvr http://127.0.0.1:8765/api/internal/srs/on_dvr;
  }
}

vhost live-nodvr {
  refer { enabled on; all 10.1.0.0/16; }
  hls { enabled on; ... }
  # 没有 dvr block
}
```

### 4.4 Caddy 反代与 HLS 鉴权

**oj 上的 Caddyfile 追加**（`/root/.hydro/Caddyfile`）：

```caddy
oj-domain {
  # ... 现有 reverse_proxy hydrooj :8888 ...

  # HLS 反代到 oj-vigil 的 SRS
  route /vigil-hls/* {
    forward_auth hydrooj:8888 {
      uri /api/admin/vigil/check-hls-access?path={uri}
      copy_headers Cookie
      # hydrooj 返回 200 = 放行；403 = 拒绝
    }
    uri strip_prefix /vigil-hls
    reverse_proxy 10.1.235.155:8080
  }
}
```

**hydrooj 新增 endpoint** (`/api/admin/vigil/check-hls-access`)：

```ts
@route('/admin/vigil/check-hls-access', 'GET', PERM.PERM_VIEW_GLOBAL)
async function checkHlsAccess(this: Handler) {
  const path = this.request.query.path as string;
  // path 形如 /vigil-hls/live-record/abc123_MX9F2_screen.m3u8
  const match = path.match(/\/(live-record|live-nodvr)\/([0-9a-f]+)_([A-Z0-9]+)_(screen|camera)\.m3u8$/);
  if (!match) { this.response.status = 403; return; }
  const [, , contestId, machineId, streamType] = match;
  // 校验当前 user 对 contestId 有 admin 权限
  const allowed = await checkVigilAdmin(this.user._id, contestId);
  this.response.status = allowed ? 200 : 403;
}
```

老师浏览器加载 `http://oj/vigil-hls/live-record/abc123_MX9F2_screen.m3u8`：
1. Caddy forward_auth → hydrooj `/api/admin/vigil/check-hls-access?path=/vigil-hls/...`
2. hydrooj 用 Cookie 鉴权 admin 身份 → 返回 200
3. Caddy strip_prefix → reverse_proxy 到 `http://10.1.235.155:8080/live-record/...`
4. SRS 返回 m3u8 → 浏览器 HLS.js 播放

### 4.5 客户端推流栈

**模块**：`Client/network/rtmp_publisher.{h,cpp}`（新建）

**接口**：

```cpp
class RtmpPublisher : public QObject {
  Q_OBJECT
public:
  struct Config {
    QString rtmpUrlBase;      // rtmp://oj-vigil:1935
    QString appName;          // "live-record" or "live-nodvr"
    QString contestId;
    QString machineId;
    bool screenEnabled;
    bool cameraEnabled;
    QString cameraDeviceName; // dshow 设备名
  };

  void start(const Config& cfg);
  void stop();

signals:
  void streamStateChanged(const QString& streamType, const QString& state);  // started / stopped / failed
  void streamError(const QString& streamType, const QString& message);

private:
  QProcess* screenProcess_ {nullptr};
  QProcess* cameraProcess_ {nullptr};
  QTimer* restartTimer_ {nullptr};
  Config config_;

  void startScreenFfmpeg();
  void startCameraFfmpeg();
  void onProcessFinished(QProcess::ExitStatus status);
  QString buildScreenCommand() const;
  QString buildCameraCommand() const;
};
```

**ffmpeg.exe 命令模板（屏幕）**：

```
ffmpeg.exe \
  -f gdigrab -framerate 5 -i desktop \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 1500k -maxrate 1500k -bufsize 3000k \
  -g 25 -keyint_min 25 -profile:v baseline -pix_fmt yuv420p \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -f flv rtmp://oj-vigil:1935/{app}/{cid}_{mid}_screen
```

> 注：先用 `gdigrab` 跑通，若性能不够再换 ddagrab（需要 ffmpeg 6.0+，已确认机房 GPU 支持）

**ffmpeg.exe 命令模板（摄像头）**：

```
ffmpeg.exe \
  -f dshow -framerate 5 -video_size 640x480 -i video="{设备名}" \
  -c:v libx264 -preset ultrafast \
  -b:v 400k -maxrate 400k -bufsize 800k \
  -g 25 -profile:v baseline -pix_fmt yuv420p \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -f flv rtmp://oj-vigil:1935/{app}/{cid}_{mid}_camera
```

**生命周期**（fail-soft 原则）：
- 启动：`ExamWebview::showEvent` 进入全屏 lockdown 后 → `RtmpPublisher::start()`
- 停止：学生提交答卷 / session 失效 / 应用退出 → `QProcess::terminate()` + 5s wait + `QProcess::kill()` 兜底
- ffmpeg 进程退出（任何原因）：QProcess::finished 信号 → 5s 后重启
- 全程错误只上报 event `stream_failed` + 写本地日志，不弹任何对话框给学生

**内置 ffmpeg**：
- Client 安装目录下 `ffmpeg/ffmpeg.exe`（minimal build，仅 libx264 + gdigrab + dshow + flv muxer，~30 MB）
- CMakeLists 加 install target 把 ffmpeg.exe 拷到 bin/
- 编译时静态链接 libx264，减少 dll 依赖

---

## 5. 截屏策略

### 5.1 三种触发

| 触发 | 频率 | 携带 | 用途 |
|---|---|---|---|
| **定时** | 每 `screenshotIntervalMs ± screenshotJitterMs` ms | 仅 `ts` | 兜底证据链 |
| **事件** | 客户端检测到异常事件时立即触发 | `eventId` (关联到 vigil.events 文档) | 行为日志详情弹窗显示当时画面 |
| **命令** | 老师 OJ 点击"实时截屏"按钮 | `commandId` (回执用) | 老师即时查看 |

### 5.2 客户端实现

**模块**：`Client/capture/screenshot_scheduler.{h,cpp}`（重构现有定时截屏逻辑）

```cpp
class ScreenshotScheduler : public QObject {
  Q_OBJECT
public:
  void setIntervalMs(int interval, int jitter);   // 从 launch_exam_webview payload 读取
  void start();
  void stop();

public slots:
  void captureNow(const QString& reasonTag, const QString& eventId = {});  // 事件 / 命令触发

signals:
  void screenshotCaptured(const QString& screenshotId, const QImage& image, const QString& reasonTag, const QString& eventId);

private:
  QTimer* timer_ {nullptr};
  int intervalMs_ {60000};
  int jitterMs_ {30000};

  int nextDelay() const;   // intervalMs ± rand(0, jitterMs)
  void onTimer();
};
```

**关键 bug 修复（#2）**：

`command_dispatcher.cpp` 的 `handleLaunchExamWebview` 解析 `screenshotIntervalMs` + 新加 `screenshotJitterMs`，调 `ExamShell::setScreenshotInterval(interval, jitter)` → `ScreenshotScheduler::setIntervalMs`。**不要再使用 `ClientConfig::periodicScreenshotIntervalMs`** 作为定时源（保留为兜底默认值）。

### 5.3 上传协议（扩展现有 endpoint）

POST `{serverBaseUrl}/api/uploads/screenshots`（**endpoint 已存在**，仅扩展字段）：

```http
X-KVS-Token: {access_token}
Content-Type: multipart/form-data

现有字段（不变）:
  - client_id
  - exam_id
  - command_id      (现有，已存在；用于命令触发关联)
  - width
  - height
  - file            (binary JPEG, quality 70)

新增字段:
  - reason_tag      ("scheduled" | "event" | "command")
  - event_id        (when reason_tag=event；关联到 vigil.events 文档)
  - captured_at     ISO timestamp（服务器时间偏差对账用）
```

Vigil server 返回：

```json
{ "screenshotId": "abc123", "url": "/screenshots/2026-05-27/abc123.jpg", "thumbUrl": "/screenshots/2026-05-27/abc123_thumb.jpg" }
```

---

## 6. 控制命令

> **重要修订**：audit 发现 `capture_screenshot` 和 `show_message` 两个命令**已经存在**于 CommandDispatcher。本方案改为：复用现有命令并扩展 payload，而不是新增重复命令。

### 6.1 完整清单

| 命令 | 新增 / 扩展 | 客户端响应 | UI 形态 | 群发支持 | 二次确认 |
|---|---|---|---|---|---|
| `capture_screenshot` | **扩展现有**（加 reason_tag/event_id） | 立即截屏并上传 | — | ❌ | ❌ |
| `lock_screen` | 新增 | 显示全屏 LockScreenOverlay | — | ❌ | ✅ |
| `unlock_screen` | 新增 | 移除遮罩 | — | ❌ | ❌ |
| `show_message` | **扩展现有**（加 severity 分级 + 修 bug #1 信号路由） | 显示消息弹窗 | InfoBar / ContentDialog / 遮罩+Dialog | ✅ | severity=critical 时 ✅ |
| `notify_warning` | 新增（实质等价于 `show_message severity=info` 的 alias） | 显示 toast | InfoBar 角落滑入 | ✅ | ❌ |
| `restart_stream` | 新增 | 重启 RTMP 推流 | — | ❌ | ❌ |
| `flush_logs` | 新增 | 立即上报缓冲的事件日志 | — | ❌ | ❌ |

> 实际上 `notify_warning` 与 `show_message severity=info` 等价，可以直接合并为单一 `show_message` 命令 + severity 参数。本设计保留两者命名仅是因为老师端 UI 上是两个独立按钮（"群发消息" vs "群发提醒"），后端层面无需区分。

### 6.2 命令 payload schema

```ts
type Command = {
  type: "command";
  command_id: string;             // 由 server 生成，client 在 reply 时带回（注意 snake_case，匹配现有协议）
  command: "capture_screenshot" | "lock_screen" | "unlock_screen" | "show_message" | "notify_warning" | "restart_stream" | "flush_logs";
  payload?: {
    // show_message / notify_warning
    severity?: "info" | "warning" | "critical";
    title?: string;
    body?: string;
    sender?: string;             // "监考老师" 或具体用户名

    // capture_screenshot (扩展)
    reason_tag?: "command" | "event";
    event_id?: string;           // 当 reason_tag=event

    // restart_stream
    stream_type?: "screen" | "camera" | "all";

    // lock_screen
    message?: string;            // 遮罩上的文字，例如 "请等待监考老师指示"
  };
  expires_at?: string;            // ISO timestamp，超过即丢弃
};
```

### 6.3 命令回执

```ts
type CommandResult = {
  type: "command_result";
  commandId: string;
  result: "ok" | "client_offline" | "timeout" | "error";
  errorMessage?: string;
  data?: any;                    // 例如 take_screenshot 回 screenshotId
};
```

### 6.4 高危命令的二次确认 UI

老师在 OJ UI 上点 "🔒 锁屏" 按钮 → 弹 Dialog：

```
确定要锁定 #15 张三 的屏幕吗？
学生将看到全屏遮罩，无法继续答题，直到您点击"解锁"。

[可选] 原因（写入审计日志）：
[____________________________]

[取消]  [确认锁屏]
```

`send_message[severity=critical]` 同样：

```
确定要向 #15 张三 发送 critical 消息吗？
该消息会全屏遮挡学生界面，必须确认才能继续答题。

[原因] [____________________________]
[取消]  [确认发送]
```

`take_screenshot` / `notify_warning` / `unlock_screen` / `flush_logs` / `restart_stream` 直接执行无确认。

### 6.5 命令操作审计

新增 collection `vigil.command_audit`：

```ts
{
  _id: ObjectId,
  contestId: ObjectId,             // OJ contestId（hex string）
  actor: {
    uid: number,                   // OJ uid
    displayName: string,
    sessionId: string,             // dashboard token / login session
  },
  targetMachineId: string,
  targetUid: number,               // OJ uid of student
  command: string,                 // "take_screenshot" etc.
  payload: any,                    // 命令携带的 payload
  reason: string,                  // 老师可填，可为空
  ts: Date,                        // 发起时间
  result: "ok" | "timeout" | "client_offline" | "error",
  errorMessage?: string,
  resultedAt: Date,                // 回执到达时间
}
```

TTL index: 90 天 (`ts` field, `expireAfterSeconds: 7776000`)

---

## 7. 事件检测

### 7.1 8 类事件清单

| Type | 说明 | severity | Win32 API |
|---|---|---|---|
| `process_started_unauthorized` | 启动了不在白名单的进程 | error | WMI `__InstanceCreationEvent` 监听 `Win32_Process` |
| `usb_storage_changed` | USB 存储类设备插拔 | error | `RegisterDeviceNotification` + `WM_DEVICECHANGE` + `DBT_DEVTYP_VOLUME` |
| `monitor_changed` | 多显示器配置变化（新增/移除） | error | `QGuiApplication::screensChanged` |
| `clipboard_external_paste` | 外部应用 paste 到 ExamWebview（如果可检测） | warning | `QClipboard::dataChanged` + 推断来源（best-effort） |
| `session_locked` | 系统会话锁定（Win+L） | warning | `WTSRegisterSessionNotification` + `WTS_SESSION_LOCK` |
| `camera_lost` | 摄像头被拔出/驱动错误 | warning | `QCamera::errorOccurred` |
| `network_adapter_changed` | 新网卡上线 / VPN 接入 | warning | `INetworkListManager` API |
| `print_initiated` | 打印动作发起 | warning | Print spooler 监听（best-effort） |

> 不做：任务管理器启动检测、键盘异常组合键（hook 不稳）。

### 7.2 进程白名单合并规则

- **服务器全局默认**：`/data/vigil/global_process_whitelist.json`，admin 在 vigil 后台编辑
- **比赛级 override**：`contest.vigilProcessWhitelist` 数组
- **客户端最终白名单** = 服务器全局 ∪ 比赛级 ∪ 客户端硬编（系统进程 svchost.exe / explorer.exe / dwm.exe / smss.exe / wininit.exe / csrss.exe / winlogon.exe / lsass.exe / fontdrvhost.exe + krypton-vigil-client.exe + ffmpeg.exe + msedgewebview2.exe）
- 不在白名单的进程启动 → 触发 `process_started_unauthorized` event

### 7.3 USB 检测颗粒度

只监听 `DBT_DEVTYP_VOLUME`（卷设备），过滤掉键鼠（`DBT_DEVTYP_DEVICEINTERFACE` + `GUID_DEVINTERFACE_HID`）。

USB 键盘鼠标插拔不触发 event（机房可能有外接键鼠）。

### 7.4 severity 分级与卡片状态映射

| severity | UI 卡片"异常计数" | 触发"异常"状态 |
|---|---|---|
| `info` | 不计 | 否 |
| `warning` | 计 | 是 |
| `error` | 计 | 是 |
| `critical` | 计 | 是（紫色高亮） |

卡片状态计算（前端 `useStudentStatus` hook）：

```ts
function computeStatus(student): Status {
  if (student.lockedAt) return "locked";  // 老师手动 lock_screen
  if (student.lastEvent && student.lastEvent.severity >= "warning" &&
      Date.now() - student.lastEvent.ts < 5 * 60_000) return "anomaly";
  if (!student.lastHeartbeat) return "disconnected";
  if (Date.now() - student.lastHeartbeat > 60_000) return "offline";
  return "online";
}
```

### 7.5 事件聚合（客户端 60s 窗口）

`Client/events/event_aggregator.{h,cpp}`：

```cpp
class EventAggregator : public QObject {
  Q_OBJECT
public:
  void reportEvent(const QString& type, const QJsonObject& payload, Severity sev);

signals:
  void eventReady(const QJsonObject& evtDoc);  // server-ready 文档

private:
  struct PendingEvent {
    QString fingerprint;     // type + sorted payload hash
    QJsonObject doc;
    int count;
    QDateTime firstTs;
    QDateTime lastTs;
  };
  QHash<QString, PendingEvent> pending_;
  QTimer* flushTimer_;       // 60s flush

  void flush();              // 把 pending 中的写到 eventReady signal
};
```

相同 fingerprint 在 60s 窗口内聚合为一条，`count++`，`lastTs` 更新；窗口结束或受到 `flush_logs` 命令时全部上报。

---

## 8. UI 重构 `/admin/vigil/exams/:examId`

> 由用户原话补充：**不是** contest detail page，而是单独的 admin vigil 详情页 `AdminVigilExamDetailPage`，位于 [packages/ui-next/src/pages/vigil/index.tsx:530-639](packages/ui-next/src/pages/vigil/index.tsx)。

### 8.1 页面结构（重构后）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← 返回   比赛 "ACM-ICPC 第 N 次训练赛"  · 状态 · 时间                       │
│ ┌──────────┬──────────┬──────────┬──────────┐                             │
│ │ 已连接 30│ 异常 2   │ 离线 0   │ 待审批 0  │  ← Stat banner (压缩到顶部)   │
│ └──────────┴──────────┴──────────┴──────────┘                             │
├──────────────────────────────────────────────────────────────────────────┤
│ 筛选: [全部状态▾] [搜索学号/姓名_____]  排序: [状态优先▾]  📢 全员消息       │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                                 │
│ │卡片│ │卡片│ │卡片│ │卡片│ │卡片│ │卡片│   ← 学生卡片 (30 张 / 页)          │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                                 │
│ ...                                                                       │
│                                                                           │
│ ← Prev   1 / 10 (300 学生)   Next →                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

老 MiniTabs（会话 / 审批 / 事件）保留为次菜单（顶部链接），不再是主视图。

### 8.2 学生卡片

```
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │   ← 16:9 最近一张截图缩略图
│ │   [screenshot thumb 480×270]│ │
│ │                             │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ 👤  张三                         │   ← 姓名
│     20231001 · #A3F2             │   ← 学号 · machineId 短 hash
│                                  │
│ 🟢 在线 · 47min                  │   ← 状态色块 + 已考时长
│ ⚠ 2 异常                        │   ← 异常计数 (severity ≥ warning)
└─────────────────────────────────┘
```

**字段**：
- 缩略图：WS push `screenshot_added` 实时更新（按页订阅）
- 状态色：5 级（绿在线 / 灰未连接 / 红离线 / 橙异常 / 紫锁定）
- 异常计数：累积 (severity ≥ warning) 数量

**交互**：
- 点击 → 右侧滑出抽屉
- 双击 → 直接打开直播弹窗（快捷）
- 右键 → 上下文菜单（实时截屏 / 锁屏 / 发消息）

### 8.3 右滑抽屉（Sheet）

```
                                  ┌─────────────────────────────────────┐
                                  │ ✕   张三  20231001                    │
                                  ├─────────────────────────────────────┤
                                  │ 🟢 在线 47min · client #A3F2          │
                                  │ 屏: ON 摄: ON 录: OFF                  │
                                  ├─────────────────────────────────────┤
                                  │ [📷 实时截屏]  [📺 查看实时画面]       │
                                  │ [💬 发消息]    [🔒 锁屏]              │
                                  │ [📋 导出日志]  [🎞️ 录屏回放*]          │
                                  ├─────────────────────────────────────┤
                                  │ 行为日志                                │
                                  │ ────────                              │
                                  │ 11:23  ⚠ 切换焦点 (Chrome)            │
                                  │ 11:18  🟡 USB 插入                     │
                                  │ 11:05  ✅ 进入考试                       │
                                  │ ...                                    │
                                  └─────────────────────────────────────┘
                                  * 录屏回放仅在 recordEnabled 时可点
```

实现：shadcn `Sheet side="right"`，宽度 `w-[480px]`。

### 8.4 直播弹窗（PIP + 镜像按钮）

```
┌───────────────────────────────────────────────────────────────────┐
│ 直播 · 张三 20231001 #A3F2                              [✕]       │
├───────────────────────────────────────────────────────────────────┤
│ [📷 截屏] [🔒 锁屏] [💬 消息]                                       │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│                                                                   │
│       屏幕直播 1080p × 5fps                                         │
│       (HLS.js loading http://oj/vigil-hls/.../screen.m3u8)          │
│                                                          ┌──────┐ │
│                                                          │ 摄像 │ │
│                                                          │ PIP  │ │
│                                                          │ 480p │ │
│                                                          └──────┘ │
└───────────────────────────────────────────────────────────────────┘
```

**关键实现**：
- HLS.js + `<video>` × 2（屏幕主，摄像头 PIP `position:absolute` 右下）
- 关闭时强制 `video.pause()` + `video.src=''` + `hls.destroy()` 防内存泄漏
- 同屏最多 4 个并发直播弹窗（超出限制时提示）

### 8.5 录屏回放弹窗

```
┌───────────────────────────────────────────────────────────────────┐
│ 录屏回放 · 张三 20231001                                  [✕]       │
├───────────────────────────────────────────────────────────────────┤
│  [<-]  屏幕 / 摄像头  [<切换>]   分片选择: [10:00-10:30 ▾]           │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│      <video> mp4 src=/vigil-hls/recordings/abc/MX9F2_screen_xxx.mp4  │
│                                                                   │
│                                                                   │
│      [<<] [<10s] [▶] [10s>] [>>]    11:23 / 30:00                  │
└───────────────────────────────────────────────────────────────────┘
```

仅在 `contest.recordEnabled = true` 时入口可点。

### 8.6 行为日志详情弹窗

点击某条行为日志条目：

```
┌─────────────────────────────────────────────────────────────────┐
│ 行为详情 · USB 插入                                          [✕]   │
├─────────────────────────────────────────────────────────────────┤
│ 时间    2026-05-27 11:18:23                                       │
│ 类型    usb_storage_changed  (error)                              │
│ 次数    2 (聚合在 11:18:23 - 11:18:45)                              │
│ 设备    Kingston DataTraveler 3.0 (USB\VID_0951&PID_1666)         │
│                                                                   │
│ Payload                            事件触发截屏                     │
│ ┌─────────────────────────┐       ┌───────────────────────────┐  │
│ │ {                       │       │                           │  │
│ │   "device": "...",      │       │   [当时屏幕截图 缩略]      │  │
│ │   "vid": "0951",        │       │   点击放大 (lightbox)       │  │
│ │   "pid": "1666",        │       │                           │  │
│ │   ...                   │       │                           │  │
│ │ }                       │       │                           │  │
│ └─────────────────────────┘       └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

截图点击 → fullscreen lightbox 放大查看。

### 8.7 群发消息弹窗

顶部 "📢 全员消息" 按钮点击：

```
┌─────────────────────────────────────────────────────────────────┐
│ 群发消息                                                   [✕]    │
├─────────────────────────────────────────────────────────────────┤
│ 类型        ○ 提醒 (toast) ● 通知 (modal) ○ 强制 (全屏)             │
│ 收件人      ● 全员 30 人  ○ 仅在线 30 人  ○ 仅异常 2 人             │
│                                                                   │
│ 标题        [_______________________________]                    │
│ 内容        ┌────────────────────────────────────────────────┐    │
│             │                                                │    │
│             │                                                │    │
│             └────────────────────────────────────────────────┘    │
│                                                                   │
│ 操作原因    [可选, 用于审计日志]                                     │
│             [_______________________________]                    │
│                                                                   │
│                                          [取消]   [发送给 30 人]    │
└─────────────────────────────────────────────────────────────────┘
```

### 8.8 命令回执 toast

通过 InfoBar 组件实现：

```tsx
const { sendCommand } = useProctorCommands(contestId);

async function onScreenshotClick() {
  const toast = showLoadingToast("正在发送...");
  try {
    const result = await sendCommand(machineId, "take_screenshot");
    toast.success(`已截屏，等待上传`);
  } catch (e) {
    toast.error(e.message);  // "学生客户端离线" / "超时" / ...
  }
}
```

### 8.9 分页 + 排序 + 筛选

URL 状态：`/admin/vigil/exams/:cid?page=2&status=anomaly,offline&sort=status_priority&q=张三`

每页 30 张卡片。300 学生 → 10 页。

排序选项（默认状态优先）：
- 状态优先（紫锁定 → 橙异常 → 红离线 → 绿在线 → 灰未连接）
- 学号
- 姓名
- 已考时长
- 异常计数（多 → 少）

筛选条件：
- 状态多选 checkbox
- 搜索框（学号 / 姓名 fuzzy）

---

## 9. WebSocket 协议扩展

### 9.1 现有 dashboard WS（vigil server → OJ 前端）

通过 `/api/admin/vigil/ws?token={dashboard_token}` 连接，现有消息：
- `approval_request` / `approval_resolved`
- `snapshot` (Stats 更新)

### 9.1.1 现有 client WS（vigil server ↔ student client）

- **URL**: `{serverBaseUrl}/api/ws/clients/{clientId}` （audit 确认实际路径）
- **Auth**: HTTP header `X-KVS-Token: {token}`
- **现有消息**：client→server `heartbeat / device_info / media_devices / login_request / student_finish_request / client_event / command_result`；server→client `command / login_response / student_finish_response / hello / ack`
- **离线缓冲**：`client_event` 通道在断连时缓冲（max 100，超出丢最早），重连后 drain
- **新事件类型**：复用 `client_event`，扩展 `type` 字段（不需要新 WS message type）

### 9.2 新增消息类型

| Type | 触发 | Payload |
|---|---|---|
| `student_status_update` | 学生在线/离线/异常状态变化 | `{ contestId, machineId, status, lastHeartbeat, eventCount }` |
| `screenshot_added` | 新截图入库（按页订阅） | `{ contestId, machineId, screenshotId, eventId?, ts, thumbUrl }` |
| `event_added` | 新行为日志（按页订阅） | `{ contestId, machineId, eventId, severity, type, summary, ts }` |
| `command_result` | 命令执行回执 | `{ commandId, machineId, result, errorMessage?, data? }` |
| `stream_status_change` | 直播流上下线 | `{ contestId, machineId, streamType, status }` |

### 9.3 订阅模型

连接后客户端 send：

```json
{ "subscribe": { "contestId": "abc123", "page": 1, "pageSize": 30, "machineIds": ["MX9F2", "MX9F3", ...] } }
```

服务器订阅记录：

```python
# vigil-server / app/services/dashboard_pubsub.py
class DashboardPubsub:
    # contestId -> { ws_conn -> Subscription }
    subscribers: Dict[str, Dict[WebSocket, Subscription]]

    @dataclass
    class Subscription:
        contestId: str
        page: int                  # 当前页
        machineIds: Set[str]       # 仅此页的 machineId
        receivesStatusAll: bool    # status_update 全收
        receivesScreenshotPaged: bool  # screenshot/event 按 page filter
```

### 9.4 心跳

应用层 30s/60s 双阈值：

- Client → Vigil server：每 30s 发 `{ "type": "ping", "machineId": "MX9F2", "ts": "..." }`
- Vigil server 更新 `vigil.client_sessions.last_heartbeat`
- 后台 task 每 10s 扫描，超过 60s 无心跳的 session：
  - 标记 `status = "offline"`
  - WS push `student_status_update` 给该 contest 订阅者
  - 60s 后再次扫描，仍无心跳 → 触发 `client_disconnected` event

OJ 前端心跳（dashboard WS）：客户端每 30s ping，服务器 60s 无 ping 关连接。

---

## 10. 数据生命周期

### 10.1 TTL 配置

| Collection / 文件 | TTL | 实现 |
|---|---|---|
| `vigil.events` | 30 天 | MongoDB TTL index on `ts` |
| `vigil.screenshots` (DB rec) | 14 天 | MongoDB TTL index on `ts` |
| screenshots 文件 (`/data/vigil/screenshots/`) | 同 DB rec | cron 扫描 DB 找到过期 doc 后删文件 |
| `vigil.recordings` (DB rec) | 7 天 | MongoDB TTL index on `ts` |
| recordings 文件 (`/data/vigil/recordings/`) | 同 DB rec | cron 同上 |
| `vigil.command_audit` | 90 天 | MongoDB TTL index on `ts` |
| `vigil.client_sessions` | 比赛结束 + 30 天 | cron task，无 TTL（依赖 contest endAt） |
| `vigil.approval_requests` | 30 天 | MongoDB TTL index on `ts` |

### 10.2 cleanup cron 实现

systemd timer (`/etc/systemd/system/vigil-cleanup.timer`)：

```ini
[Unit]
Description=Krypton Vigil cleanup (daily)

[Timer]
OnCalendar=*-*-* 04:00:00     # 每天凌晨 4 点
Persistent=true

[Install]
WantedBy=timers.target
```

service (`/etc/systemd/system/vigil-cleanup.service`)：

```ini
[Unit]
Description=Krypton Vigil cleanup runner

[Service]
Type=oneshot
ExecStart=/opt/krypton-vigil/.venv/bin/python -m app.scripts.cleanup
User=krypton-vigil
```

`app/scripts/cleanup.py` 任务：
- 扫描 `vigil.screenshots` 中 `ts > 14 days ago` 的过期 doc，删 `/data/vigil/screenshots/...` 文件
- 扫描 `vigil.recordings` 同上，删 mp4 文件
- 扫描 `vigil.client_sessions` 中 contestEndAt > 30 days ago，删 doc

---

## 11. 权限与审计

### 11.1 权限模型

- **直接沿用** `PERM.PERM_VIEW_GLOBAL` / `admin.vigil.*`
- 任何能进 `/admin/vigil` 的管理员都能发命令
- Phase 1 不做更细分（如 contest.proctors）；生产 1-2 场后再按需细分

### 11.2 操作审计

所有命令操作写入 `vigil.command_audit`（schema 见 §6.5），包含：
- 谁（actor uid + displayName）
- 在何时（ts）
- 对谁（targetMachineId + targetUid）
- 做了什么（command + payload）
- 为什么（reason，可空）
- 结果（result + resultedAt）

### 11.3 审计 UI

`/admin/vigil/exams/:cid` 顶部链接到 `?view=audit` 子页：显示该 contest 的命令审计日志（列表 + 时间 + actor + command + target + result + reason）。

---

## 12. 客户端架构

### 12.1 新增模块

| 文件 | 职责 | 复用基础 |
|---|---|---|
| `network/rtmp_publisher.{h,cpp}` | 管理两个 ffmpeg.exe 子进程（屏幕 + 摄像头），监控 stderr，重启失败进程，上报 `stream_failed` event | `WatchdogSupervisor` 是 QProcess+RestartLimiter 模板 |
| `capture/camera_capture.{h,cpp}` | 不需要——摄像头直接由 ffmpeg dshow 抓帧，Qt 端不调 QMediaCaptureSession | ✗ |
| `events/process_monitor.{h,cpp}` | WMI `__InstanceCreationEvent` 监听 `Win32_Process`，对照白名单 → emit `process_started_unauthorized` | `EventReporter` |
| `events/device_monitor.{h,cpp}` | `RegisterDeviceNotification` + `WM_DEVICECHANGE` + `DBT_DEVTYP_VOLUME` 过滤存储类 → emit `usb_storage_changed` | `EventReporter` |
| `events/monitor_watcher.{h,cpp}` | `QGuiApplication::screensChanged` 信号 → emit `monitor_changed` | Qt 信号，无新依赖 |
| `events/session_watcher.{h,cpp}` | `WTSRegisterSessionNotification` + `WTS_SESSION_LOCK` → emit `session_locked` | `wtsapi32` 已 link |
| `events/network_watcher.{h,cpp}` | `INetworkListManager` COM API → emit `network_adapter_changed` | — |
| `events/camera_health.{h,cpp}` | `QMediaDevices::videoInputsChanged` + `QCamera::errorOccurred` → emit `camera_lost` | Qt Multimedia 已 link |
| `events/print_watcher.{h,cpp}` | Print spooler `FindFirstPrinterChangeNotification` → emit `print_initiated` | — |
| `events/clipboard_external.{h,cpp}` | `QClipboard::dataChanged` + 推断来源 → emit `clipboard_external_paste` (best-effort) | Qt |
| `ui/widgets/lock_screen_overlay.{h,cpp}` | 全屏 QWidget + `WindowStaysOnTopHint` + `FramelessWindowHint`，文字消息显示，捕获键鼠事件不放行 | `FramelessDialog` |

### 12.2 ExamShell 信号路由全量审计（修 bug #1）

`ExamShell::run()` 当前仅 connect 5 个 ServerConnection 信号：
- `loginResponseReceived` / `stateChanged` / `studentFinishResponseReceived` / `launchExamWebviewRequested` / `closeExamWebviewRequested`

需要**新增 connect**（从 `MainWindow::setupConnections` 搬迁，仅保留学生场景相关的）：

| 信号 | 来源 | 学生场景路由目标 |
|---|---|---|
| `userMessageRequested` | ServerConnection | 按 severity 分级路由：`info` → `InfoBar`；`warning` → `ContentDialog`；`critical` → 全屏遮罩 `LockScreenOverlay` + `ContentDialog` |
| `commandReceived` / `commandCompleted` | ServerConnection | 用于客户端日志（debug 时学生看不到，记 AppLogger） |
| `errorRaised` | ServerConnection | 渲染为 `InfoBar` warning（如服务器协议错误 / token 失效） |
| `stateChanged` (已连) | ServerConnection | 离线时 `InfoBar` 提示"已断网，正在重连"；恢复时 `InfoBar` success |

### 12.3 三级 show_message UI 路由

```cpp
void ExamShell::onUserMessageRequested(const QString& severity,
                                       const QString& title,
                                       const QString& body,
                                       const QString& sender) {
  if (state_ != State::Exam) {
    // 登录态 / 提交态：fallback InfoBar
    InfoBar::show(loginWindow_, InfoBar::Info, title, body);
    return;
  }
  if (severity == "info") {
    InfoBar::show(examWebview_, InfoBar::Info, title, body, /*autoDismiss*/ 5000);
  } else if (severity == "warning") {
    ContentDialog dlg(examWebview_, title, body, {"我知道了"});
    dlg.exec();
  } else if (severity == "critical") {
    lockOverlay_->show(body, /*modal*/ true);
    ContentDialog dlg(lockOverlay_, title, body, {"我知道了"});
    if (dlg.exec() == 0) lockOverlay_->hide();
  }
}
```

### 12.4 CommandDispatcher 扩展

`CommandDispatcher::dispatch` 现有 switch（17 个命令）新增 5 个分支：

```cpp
} else if (cmd == "lock_screen") {
  emit lockScreenRequested(payload.value("message").toString());
} else if (cmd == "unlock_screen") {
  emit unlockScreenRequested();
} else if (cmd == "notify_warning") {
  // 实质等价 show_message severity=info，单独命名是为兼容老师端 UI
  emit userMessageRequested(/*severity=*/"info", payload.value("title").toString(), payload.value("body").toString(), ...);
} else if (cmd == "restart_stream") {
  emit restartStreamRequested(payload.value("stream_type").toString());
} else if (cmd == "flush_logs") {
  emit flushLogsRequested();
}
```

并扩展 `capture_screenshot` 现有 handler，支持 payload 里的 `reason_tag` 和 `event_id` 透传到 `ScreenshotUploader` 的 form fields。

### 12.5 ExamShell 截屏修复（修 bug #2）

ExamShell 当前**不持有** `PeriodicCollector` 实例。修复方案：

```cpp
// app/exam_shell.h 新增成员
PeriodicCollector* periodicCollector_ {nullptr};
int screenshotIntervalMs_ {60000};
int screenshotJitterMs_ {30000};

// app/exam_shell.cpp onLaunchExamWebview 修改
void ExamShell::onLaunchExamWebview(const QString& url, const QString& sessionId,
                                    const QString& accessToken, int screenshotIntervalMs,
                                    int screenshotJitterMs,  // 新增参数
                                    ...) {
  // ... 现有代码 ...

  // 启动 PeriodicCollector
  ClientConfig cfg = configManager_->snapshot();
  cfg.periodicScreenshotIntervalMs = screenshotIntervalMs;
  // 新增 jitterMs 到 PeriodicCollector::start 或者直接通过 set
  if (!periodicCollector_) {
    periodicCollector_ = new PeriodicCollector(this);
    periodicCollector_->setEventReporter(eventReporter_);
    periodicCollector_->setScreenshotUploader(uploader_);
  }
  periodicCollector_->start(cfg, screenshotJitterMs);
}
```

并修改 `PeriodicCollector::start` 接受 `jitterMs` 参数，在 `onScreenshotTimer` 中：

```cpp
int nextDelay = screenshotIntervalMs_;
if (jitterMs_ > 0) {
  nextDelay += QRandomGenerator::global()->bounded(-jitterMs_, jitterMs_ + 1);
  nextDelay = std::max(5000, nextDelay);  // 最低 5s
}
screenshotTimer_->setInterval(nextDelay);
```

### 12.6 ffmpeg.exe 内置策略

- 安装目录布局：
  ```
  bin/krypton-vigil-client.exe
  bin/ffmpeg/ffmpeg.exe            # ~30 MB minimal build
  bin/ffmpeg/LICENSE.txt
  ```
- CMakeLists 加 install target，把 ffmpeg.exe 拷到 `${CMAKE_INSTALL_PREFIX}/bin/ffmpeg/`
- 第一次启动时检测 ffmpeg.exe 存在性，缺失则上报 `event=ffmpeg_missing severity=critical` 但不阻塞考试
- RtmpPublisher 调用时拼绝对路径 `QCoreApplication::applicationDirPath() + "/ffmpeg/ffmpeg.exe"`

### 12.7 与现有 Lockdown 的协作

`Lockdown::engage` 已经 swallow Alt+Tab / Win+L 等。新增的 `LockScreenOverlay` 是 UI 层全屏遮罩，不替代键盘 hook，而是叠加：
- Lockdown 引擎一直运行（防绕过）
- 老师 lock_screen 命令 → 显示 LockScreenOverlay（UI 反馈学生"你被锁了"）
- 老师 unlock_screen 命令 → 隐藏 LockScreenOverlay
- ExamWebview 应额外加 `Qt::WindowStaysOnTopHint`，防止 Win+Tab 越层（audit 发现现在没加）

---

## 13. 服务器路由清单

### 13.1 老师 → Vigil（dashboard-token 鉴权）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/admin/vigil/proctor/commands` | 发命令（含群发） |
| GET | `/api/admin/vigil/contests/:cid/students` | 学生卡片墙数据（分页） |
| GET | `/api/admin/vigil/contests/:cid/students/:mid/screenshots` | 学生截图列表 |
| GET | `/api/admin/vigil/contests/:cid/students/:mid/events` | 学生行为日志 |
| GET | `/api/admin/vigil/contests/:cid/recordings` | 录屏 mp4 索引 |
| GET | `/api/admin/vigil/contests/:cid/audit` | 操作审计 |
| GET | `/api/admin/vigil/screenshots/:sid/file` | 截图文件（鉴权后 redirect 到本地 path） |
| WS | `/api/admin/vigil/ws` | 实时推送（扩展现有） |

### 13.2 OJ 后端 → Vigil（service-token 鉴权，已有渠道延伸）

| Method | Path | 用途 |
|---|---|---|
| (复用已有 `/api/oj/*`) | | 新字段透传走现有 `exams/upsert` |

### 13.3 Client → Vigil（access-token 鉴权）

| Method | Path | 用途 |
|---|---|---|
| (复用已有) | | WS + screenshot 上报 + event 上报；扩展 schema |

### 13.4 SRS → Vigil（内部 callback，仅 localhost）

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/internal/srs/on_publish` | 推流开始（仅记录） |
| POST | `/api/internal/srs/on_unpublish` | 推流停止 |
| POST | `/api/internal/srs/on_play` | 老师拉流（仅记录） |
| POST | `/api/internal/srs/on_dvr` | 录屏分片落盘完成 → 写 vigil.recordings |

### 13.5 OJ → Caddy（forward_auth target）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/admin/vigil/check-hls-access?path=...` | Caddy forward_auth 鉴权 HLS 访问 |

---

## 14. 性能与压测

### 14.1 300 学生场景资源估算

| 资源 | 估算 | 备注 |
|---|---|---|
| 上行总带宽 | 300 × (1.5 + 0.4) Mbps = 570 Mbps | oj-vigil 千兆口约 60% |
| 老师下行（同看 4 弹窗 = 8 路 HLS） | 8 × 1.9 = 15.2 Mbps | 浏览器可承受 |
| SRS CPU | 600 路 RTMP 收 + HLS 转封装 | 4 核 100% 上限可达 |
| oj-vigil 内存 | 4-6 GB | 8 GB 起步 |
| 录屏 1 场存储（开启时） | 300 × 2h × 1.9 Mbps = 510 GB | 必须扩盘 |
| WS 消息率 | status 1/s + screenshot 5/s + event ~1/s = ~7/s | 可控 |
| 学生 CPU（软编 1080p） | i5 8 代约 15-25% 单核 | 不影响考试 |
| 学生内存（推流 2 路 + webview） | ~400 MB | OK |

### 14.2 压测脚本（Phase 4）

`scripts/load_test.py` 模拟 N 个学生客户端：
- 启动 N 个 `ffmpeg -re -i sample.mp4 -f flv rtmp://...`（用预录 mp4 假装屏幕推流）
- 启动 N 个 ws connection，按真实频率发心跳 / 截屏 / event
- 在另一台机器跑 K 个老师 dashboard ws connection + 拉 HLS

阈值：
- N=30：基线，必须完全顺畅
- N=100：常规，CPU/带宽 ≤ 70%
- N=300：峰值，CPU/带宽 ≤ 90%，无丢包，HLS 延迟 ≤ 5s

---

## 15. 实施 Phase 拆分

### Phase 0 — MVP "直播能看见" (~10 工日)

闭环：1 个学生 → ffmpeg 推流 → SRS → Caddy 反代 → 老师 HLS.js 看到屏幕和摄像头。

| Task | 工日 | 负责模块 |
|---|---|---|
| SRS 二进制 + systemd + 双 app 配置 | 2 | oj-vigil 运维 |
| Caddy 反代 + hydrooj check-hls-access endpoint | 1 | oj 运维 + hydrooj |
| 客户端内置 ffmpeg + RtmpPublisher（屏幕 + 摄像头） | 3 | Client |
| SRS callback 4 个 endpoint 骨架 | 1 | Vigil server |
| contest 字段 + UI 暴露（liveEnabled + cameraEnabled） | 1 | krypton-vigilguard + ui-next |
| 简化版直播弹窗（无快捷按钮，仅 PIP 视频） | 1 | ui-next |
| e2e 测试 + 文档化 | 1 | — |

**完成准则**：在 admin/vigil 页面打开 1 个学生抽屉，点"查看实时画面"，能看到屏幕和摄像头实时视频，延迟 < 5s。

### Phase 1 — 核心监考链路 (~12 工日)

闭环：30 学生卡片墙 + 抽屉 + 命令 + 三级消息 + 心跳 + 行为日志展示。

| Task | 工日 | 负责模块 |
|---|---|---|
| 学生卡片墙 + 5 级状态 + 右滑抽屉 | 3 | ui-next |
| 修 ExamShell 信号 bug（全量审计） | 1 | Client |
| 客户端命令处理扩展（7 命令） | 2 | Client |
| 截屏抖动 + 修 screenshotIntervalMs bug | 1 | Client |
| Vigil schema + proctor commands + WS 扩展 + 心跳 | 3 | Vigil server |
| 三级 send_message UI（InfoBar/Dialog/遮罩） | 1 | Client |
| 行为日志详情弹窗 + WS 订阅 + 群发 + 回执 toast | 1 | ui-next |

### Phase 2 — 事件检测 (~8 工日)

| Task | 工日 |
|---|---|
| 进程白名单 + WMI 检测（process_started_unauthorized） | 2 |
| USB 存储检测（WM_DEVICECHANGE） | 1 |
| 多显示器 / 系统锁屏 / 摄像头掉线 / 网卡 / 打印 | 2 |
| 事件触发截屏 + screenshotId 关联 | 1 |
| 全屏锁屏遮罩 | 1 |
| events/screenshots/audit listing endpoints + UI | 1 |

### Phase 3 — 录屏闭环 (~4 工日)

| Task | 工日 |
|---|---|
| SRS dvr 配置（live-record app） | 1 |
| contest UI 加 recordEnabled | 0.5 |
| recordings listing endpoint + on_dvr callback 写 DB | 1 |
| 录屏回放弹窗（HLS.js mp4 + 拖拽 + 分片） | 1.5 |

### Phase 4 — 运维加固 (~3 工日)

| Task | 工日 |
|---|---|
| MongoDB TTL index 配置 + cleanup cron + systemd timer | 1 |
| 磁盘扩容（按场景预留 2 TB） | 0.5 |
| 防火墙 IP 白名单（限制 SRS 推流来源） | 0.5 |
| 压测脚本 + 30/100/300 学生测试 + 调优 | 1 |

### 工期总计

- 单人串行：~37 工日 ≈ 7.5 周
- 双人并行（Client + Server 分工）：~5 周
- 三人并行（+ UI 单独）：~4 周

---

## 附录 A. 数据库 schema 详细

### A.1 vigil.exams (扩展现有)

```ts
{
  _id: ObjectId,
  contestId: string,          // OJ contestId hex
  domainId: string,
  name: string,
  startAt: Date,
  endAt: Date,
  // ... existing fields ...

  // NEW
  liveEnabled: boolean,
  recordEnabled: boolean,
  cameraEnabled: boolean,
  screenshotIntervalMs: number,
  screenshotJitterMs: number,
  processWhitelist: string[],
}
```

### A.2 vigil.client_sessions (扩展现有)

```ts
{
  _id: ObjectId,
  contestId: string,
  machineId: string,
  uid: number,                // OJ uid
  // ... existing fields ...

  // NEW
  last_heartbeat: Date,
  status: "online" | "offline" | "anomaly" | "locked",
  locked_at?: Date,           // 老师 lock_screen 时设置
  locked_by?: number,         // actor uid
  stream_state: {
    screen: "started" | "stopped" | "failed",
    camera: "started" | "stopped" | "failed",
  },
}
```

### A.3 vigil.events (扩展现有)

```ts
{
  _id: ObjectId,
  contestId: string,
  machineId: string,
  type: string,               // "process_started_unauthorized" etc.
  severity: "info" | "warning" | "error" | "critical",
  summary: string,            // 一句话描述
  payload: any,               // 类型相关字段
  count: number,              // 客户端聚合 count
  firstTs: Date,
  lastTs: Date,
  ts: Date,                   // = lastTs，用于 TTL index
  screenshotId?: ObjectId,    // 事件触发截屏的关联
}

// TTL index: ts (expireAfterSeconds: 2592000) — 30 days
```

### A.4 vigil.screenshots (扩展现有)

```ts
{
  _id: ObjectId,
  contestId: string,
  machineId: string,
  uid: number,
  filename: string,
  thumbFilename: string,
  url: string,
  thumbUrl: string,
  size: number,
  width: number,
  height: number,
  reasonTag: "scheduled" | "event" | "command",  // NEW
  eventId?: ObjectId,         // NEW (当 reasonTag=event)
  commandId?: string,         // NEW (当 reasonTag=command)
  ts: Date,
}

// TTL index: ts (expireAfterSeconds: 1209600) — 14 days
```

### A.5 vigil.recordings (新增)

```ts
{
  _id: ObjectId,
  contestId: string,
  machineId: string,
  uid: number,
  streamType: "screen" | "camera",
  filename: string,           // SRS dvr 生成
  filePath: string,           // /data/vigil/recordings/...
  url: string,                // HLS URL (mp4 via Caddy)
  size: number,
  durationMs: number,
  startTs: Date,
  endTs: Date,
  ts: Date,                   // = startTs，用于 TTL index
}

// TTL index: ts (expireAfterSeconds: 604800) — 7 days
```

### A.6 vigil.command_audit (新增)

见 §6.5。

---

## 附录 B. 关键 ffmpeg 命令模板

见 §4.5。

---

## 附录 C. 完整 SRS 配置

```nginx
listen 1935;
max_connections 1000;
daemon off;
srs_log_tank file;
srs_log_file /var/log/srs.log;
srs_log_level info;

http_server {
  enabled on;
  listen 8080;
  dir ./objs/nginx/html;
  crossdomain on;
}

http_api {
  enabled on;
  listen 127.0.0.1:1985;
}

stats {
  network 0;
}

# 默认 vhost - 兜底，不应被使用（客户端必须指定 app）
vhost __defaultVhost__ {}

# Application: live-record (开 dvr)
vhost live-record {
  refer {
    enabled on;
    all 10.1.0.0/16;
  }
  hls {
    enabled on;
    hls_path ./objs/nginx/html;
    hls_fragment 2;
    hls_window 30;
    hls_dispose 30;
  }
  dvr {
    enabled on;
    dvr_plan session;
    dvr_path /data/vigil/recordings/[stream]_[20060102_150405].mp4;
    dvr_duration 1800;
    dvr_wait_keyframe on;
  }
  http_hooks {
    enabled on;
    on_publish http://127.0.0.1:8765/api/internal/srs/on_publish;
    on_unpublish http://127.0.0.1:8765/api/internal/srs/on_unpublish;
    on_play http://127.0.0.1:8765/api/internal/srs/on_play;
    on_dvr http://127.0.0.1:8765/api/internal/srs/on_dvr;
  }
}

# Application: live-nodvr (不开 dvr)
vhost live-nodvr {
  refer {
    enabled on;
    all 10.1.0.0/16;
  }
  hls {
    enabled on;
    hls_path ./objs/nginx/html;
    hls_fragment 2;
    hls_window 30;
    hls_dispose 30;
  }
  http_hooks {
    enabled on;
    on_publish http://127.0.0.1:8765/api/internal/srs/on_publish;
    on_unpublish http://127.0.0.1:8765/api/internal/srs/on_unpublish;
    on_play http://127.0.0.1:8765/api/internal/srs/on_play;
  }
}
```

---

## 文档更新历史

| 日期 | 内容 |
|---|---|
| 2026-05-27 | 初版，基于 17 个 grill 决策。客户端架构章节占位，待 audit 回填。 |
| 2026-05-27 | Audit 完成，回填 §1 现状基线、§5.3 上传协议、§6 命令清单（capture_screenshot/show_message 复用而非新增）、§9.1.1 client WS 现状、§12 客户端架构。**重要修订**：bug #2 比预期严重（ExamShell 不实例化 PeriodicCollector，学生模式定时截屏从未跑过）。 |
| 2026-05-27 | Phase 0-4 实施完成。文件清单见 §16。未 commit、未 push、未部署。 |

---

## 16. 实施完成清单（2026-05-27）

### Phase 0 — MVP "直播能看见"

新建：
- `ops/srs/krypton.conf` — SRS 配置（live-record / live-nodvr 双 application）
- `ops/systemd/srs.service` — systemd unit
- `ops/caddy/Caddyfile.vigil-hls.snippet` — Caddy 反代配置
- `ecosystems/KryptonVigilSystem/Server/app/api/srs_callbacks.py` — 4 个 SRS callback endpoints
- `ecosystems/KryptonVigilSystem/Client/streaming/rtmp_publisher.{h,cpp}` — ffmpeg 推流栈
- `ecosystems/KryptonVigilSystem/Client/deploy/ffmpeg-build.md` — ffmpeg 内置说明

修改：
- `packages/hydrooj/src/interface.ts` — Tdoc 加 5 个新字段
- `packages/hydrooj/src/handler/contest.ts` — postUpdate 接收 + edit() 透传
- `packages/hydrooj/src/handler/vigil-integration.ts` — check-hls-access endpoint
- `packages/hydrooj/src/service/vigil-bridge.ts` — OjContestPayload 扩展
- `packages/krypton-vigilguard/index.ts` — pushExamToVigil 透传
- `packages/ui-next/src/pages/contest-manage.tsx` — vigil tab UI 加 5 字段
- `ecosystems/KryptonVigilSystem/Server/app/main.py` — register srs_callbacks_router
- `ecosystems/KryptonVigilSystem/Server/app/models.py` — OjContest + Recording + CommandAudit + Screenshot 字段
- `ecosystems/KryptonVigilSystem/Server/app/services/database.py` — ALTER TABLE for 新字段
- `ecosystems/KryptonVigilSystem/Server/app/api/oj_integration.py` — ExamPushPayload 扩展
- `ecosystems/KryptonVigilSystem/Server/app/services/commands.py` — launch_exam_webview payload 透传
- `ecosystems/KryptonVigilSystem/Client/CMakeLists.txt` — 集成 streaming/ + lock_screen_overlay + ffmpeg install rule
- `ecosystems/KryptonVigilSystem/Client/network/command_dispatcher.{h,cpp}` — ExamLaunchOptions + 5 个新命令
- `ecosystems/KryptonVigilSystem/Client/capture/media_probe.{h,cpp}` — availableCameraNames API
- `ecosystems/KryptonVigilSystem/Client/network/screenshot_uploader.{h,cpp}` — 接受 metadata QJsonObject

### Phase 1 — 核心监考链路

新建（vigil server）：
- `ecosystems/KryptonVigilSystem/Server/app/api/proctor_dashboard.py` — `/api/admin/vigil/proctor/*` 路由 + WS subscribe
- `ecosystems/KryptonVigilSystem/Server/app/services/heartbeat_watcher.py` — 30s/60s 心跳后台任务

修改（vigil server）：
- `app/services/dashboard_broker.py` — 5 个新 publishers + ContestSubscription 模型
- `app/api/routes.py` — client WS 扩展（heartbeat 刷新 / event_added 广播 / command_result 解析）+ screenshot upload 新字段
- `app/storage/screenshot_storage.py` — store_bytes 接受 reason_tag/event_id/exam_session_id/oj_contest_id

新建（ui-next）：
- `packages/ui-next/src/pages/vigil/confirm-action-dialog.tsx`
- `packages/ui-next/src/pages/vigil/event-detail-dialog.tsx`
- `packages/ui-next/src/pages/vigil/live-player-dialog.tsx`
- `packages/ui-next/src/pages/vigil/recording-playback-dialog.tsx`
- `packages/ui-next/src/pages/vigil/send-message-dialog.tsx`
- `packages/ui-next/src/hooks/use-proctor-commands.ts`

修改（ui-next）：
- `packages/ui-next/src/lib/vigil-api.ts` — sendProctorCommandV2 + listContestStudents + etc.
- `packages/ui-next/src/hooks/use-vigil-socket.ts` — contest 维度订阅 + 5 个新 message types
- `packages/ui-next/src/pages/vigil/index.tsx` — AdminVigilExamDetailPage 重构（卡片墙 + 右滑抽屉）

新建（客户端）：
- `ecosystems/KryptonVigilSystem/Client/ui/widgets/lock_screen_overlay.{h,cpp}` — 全屏锁屏遮罩

修改（客户端）：
- `ecosystems/KryptonVigilSystem/Client/app/exam_shell.{h,cpp}` — 修复 bug #1 信号路由 + 三级 show_message + 持有 PeriodicCollector + RtmpPublisher
- `ecosystems/KryptonVigilSystem/Client/monitor/periodic_collector.{h,cpp}` — setJitterMs / setExamSession / captureNow

### Phase 2 — 8 类事件检测

新建（客户端）：
- `events/process_monitor.{h,cpp}` — ToolHelp32 polling + 进程白名单
- `events/device_monitor.{h,cpp}` — WM_DEVICECHANGE USB storage
- `events/monitor_watcher.{h,cpp}` — QGuiApplication::screensChanged
- `events/session_watcher.{h,cpp}` — WTS_SESSION_LOCK
- `events/camera_health.{h,cpp}` — QCamera errorOccurred + videoInputsChanged
- `events/network_watcher.{h,cpp}` — QNetworkInformation poll
- `events/print_watcher.{h,cpp}` + `print_watcher_worker_win.{h,cpp}` — FindFirstPrinterChangeNotification
- `events/clipboard_external.{h,cpp}` — QClipboard external-origin detection
- `events/event_aggregator.{h,cpp}` — 8 watcher 聚合 + screenshot hook + EventReporter 转发

修改：
- `CMakeLists.txt` — 集成 events 子目录 + winspool link
- `app/exam_shell.{h,cpp}` — 持有 EventAggregator，启动/停止生命周期

### Phase 3 — 录屏闭环

与 Phase 0/1 重叠（SRS dvr 配置 + on_dvr callback + Recording model + 录屏回放弹窗），无独立新建。

### Phase 4 — 运维加固

新建：
- `ecosystems/KryptonVigilSystem/Server/app/scripts/cleanup.py` — 文件 + DB row TTL 清理
- `ecosystems/KryptonVigilSystem/Server/scripts/load_test.py` — N 学生压测脚本
- `ops/systemd/vigil-cleanup.{service,timer}` — 每日 04:00 oneshot
- `ops/firewall/README.md` — UFW 配置 + 磁盘扩容文档
- `ops/PROCTOR_DEPLOYMENT.md` — 部署 runbook
- `packages/krypton-vigilguard/src/migration.ts` 加 v2 migration — 新字段默认值 backfill

### 未做（设计阶段已明确推迟）

- 任务管理器启动检测、键盘异常组合键（Q10 用户排除）
- "视频墙"模式 9 宫格（Q17 留 Phase 4 polish，本次未做）
- 真实 ffmpeg 二进制（gitignored 在 `vendor/ffmpeg/`，需运维侧填充）
- 实际 SRS 二进制 + 部署（未执行）
