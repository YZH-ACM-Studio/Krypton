# SRS 6.0.184：停止时完成录像与回调

本目录维护 Krypton 的 SRS 停止修复。它修改 SRS 服务端源码，不修改 Vigil Server、Windows Client、比赛配置或数据模型。`krypton.conf` 保持不变。新二进制和 `../systemd/srs.service` 是同一部署单元；只安装 unit 不会修复正在运行的旧进程。

## 根因与范围

官方 `v6.0-r0` 对应 6.0.184，源码基线为 `9f8670b2a832aea04abe644af47261838838c49a`：

- SIGTERM 进入 `SrsServer::dispose()`，关闭监听后直接 dispose sources，没有结束活动 RTMP 发布。`SrsOriginHub::dispose()` 只处理 HLS/DASH，不调用 DVR 的 `on_unpublish()`。MP4 因此缺少 `moov`，留在 `.mp4.tmp`，没有 `on_dvr`。
- SIGQUIT 会等待现有连接自然退出。客户端持续推流时不会完成，不能用替换信号解决。
- DVR 回调是异步队列，worker 会先取出整批任务再发送 HTTP 请求。队列为空不代表请求已完成；固定 sleep 也不构成完成证明。

补丁关闭监听、停止 ingester 后 interrupt 所有 RTMP 连接（包括握手中连接），等待它们走完现有 `release_publish → on_unpublish → MP4 close/rename` 路径。HTTP 观看者不阻塞这个阶段。停止所有 producer 后，在主程序退出前等待 DVR worker 的 queued **和 in-flight** 任务都完成。该补丁针对本站 RTMP → DVR 路径；不声称覆盖未验收的 SRT/RTC 或第三方推流模块。

封装、rename、回调错误保留具体文件/任务日志，同时累计为本次进程生命周期的 DVR 错误；停止时返回非零退出码，即使错误发生在停止之前也不会被遗忘。失败不自动重试、不生成伪成功记录、不回填数据库。回调失败时完成的 MP4 保留，但录像索引可能缺失，必须单独排查。

systemd 明确使用 SIGTERM，停止超时 120 秒，`SendSIGKILL=no`。超时会把 unit 标为 `Result=timeout` 并保留尚未退出的进程，残留进程上的启动会被拒绝。Ubuntu 22.04 / systemd 249 实测此时 `systemctl stop` 仍可能返回 0，`MainPID` 也可能归零；因此必须同时检查 unit Result、原 PID 和该服务 cgroup 中的全部进程，不能仅凭命令退出码或 MainPID 判断停干净。不要绕过失败直接继续替换或手动 SIGKILL。突然断电、内核崩溃、外部 SIGKILL 仍不在可保证范围内。

## 固定源码与构建

官方资产：[srs-server-6.0-r0.tar.gz](https://github.com/ossrs/srs/releases/download/v6.0-r0/srs-server-6.0-r0.tar.gz)，20,444,086 字节；复用已有缓存，构建脚本不下载依赖。

- SHA-256：`bf30446bcc18fec370b4988f809a2f18f3efaab1ec80c0e2b67469347d04630e`
- 官方发布 MD5：`25682bd45b4b66e1f46033a2626be076`
- 唯一补丁：`patches/6.0.184-dvr-shutdown.patch`

`build_patched.py` 校验完整源码包及五个修改文件的原始 SHA，零 fuzz 应用补丁，输出构建日志和 `build-manifest.json`，记录补丁、修改后源码及二进制 SHA。输出目录必须不存在。需要 Python 3.12+、编译器、make、patch 及 SRS 编译依赖；上游 configure/make 可能自行处理依赖，应在有齐全依赖的隔离构建环境运行，不在生产服务目录直接编译。

```sh
python3 ops/srs/build_patched.py \
  --archive /absolute/cache/srs-server-6.0-r0.tar.gz \
  --work-dir /absolute/new-build-dir \
  --configure-arg=--rtc=off \
  --configure-arg=--srt=off \
  --configure-arg=--https=off \
  --configure-arg=--ssl=off \
  --configure-arg=--ffmpeg-fit=off \
  --configure-arg=--apm=off \
  --configure-arg=--jobs=4
```

这是本地 RTMP 验证的构建参数示例，**不是生产编译参数声明**。生产 Linux 制品必须使用相同 CPU 架构、兼容的运行库及经核对的线上编译功能；先保存线上 `srs -V` 和依赖清单。macOS 二进制不可上传运行于 Linux，也不能仅凭 `6.0.184` 版本字符串确认补丁存在，必须比较制品 SHA 与 manifest。

## 真实回归验收

使用已构建的真实 SRS、真实 ffmpeg、Vigil 的真实 SRS hook/router 和录像下载接口。测试只在随机 loopback 端口启动进程，并创建独立临时 SQLite、考试会话和录像；不启动 Vigil 主程序的 OJ 同步等 lifespan 任务，不读取生产凭据。需安装现有 Server 虚拟环境依赖及 ffmpeg/ffprobe，不自动安装。

```sh
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --mode natural
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --delay-first-dvr 3
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --mode inflight --delay-first-dvr 3
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --fail-first-dvr
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --screens 1 --cameras 0 --mode rename-failure
python3 ops/srs/tests/verify_shutdown.py --binary /absolute/build/objs/srs --screens 300 --cameras 99 --seconds 4
```

正常路径要求：SIGTERM 时发布者仍在发送；有未完成 RTMP 握手和 HTTP-FLV 观看者；SRS 退出前全部 on_unpublish/on_dvr 完成；无新遗留 `.tmp`；每路存在唯一 Recording 且关联用户/会话及文件大小正确；每个 MP4 经 ffprobe、全量解码、文件中点定位取帧；重启同一 SRS 后读取已保存录像并通过真实 HTTP 定位解码；每条 Recording 经真实下载令牌和 Range 206 检查。测试保留 `result.json`、SRS/Vigil/ffmpeg 日志、hooks 时间点和全部录像。

失败路径要求：503 回调保留 MP4、退出非零、错误日志可定位；实际 rename syscall 失败时不产生 Recording、保留文件证据并退出非零。上述两个用例的测试通过表示正确识别失败，**不表示故障时成功保存了索引**。

变异检查至少用真实编译后的二进制运行：原版必须在活动推流停止时失败；把 drain 改为只看 `tasks.empty()` 必须在 in-flight 用例失败；吞掉 failures 返回值必须在 503 用例失败。逐个应用、恢复并校验源文件字节，最后重新构建及运行绿色用例。

399 路短片验证停止时的并发封装与索引完整性，不等同于数小时录制、高码率磁盘压力或生产 CPU 容量认证。

## 部署方案（需要单独明确授权）

1. **核对与备份**：只读核对 SRS 6.0.184、编译功能、实际可执行文件/启动命令、unit/drop-in、环境、Vigil 健康及运行版本。特别检查 `force_grace_quit`/`SRS_FORCE_GRACE_QUIT` 未开启，且 RestartKillSignal 未覆盖 SIGTERM。备份旧二进制、unit/drop-in、krypton.conf 及各自 SHA；保存进程、活动推流、新旧未完成录像清单。备份为可回滚的独立目录，不覆盖既有备份。
2. **先完成 Linux 验收**：在隔离目录编译 Linux 制品，跑上述完整真实测试及 `systemd-analyze verify`；再用临时 systemd unit、临时目录和端口验证实际 stop/restart 顺序及超时失败行为。不得把本地 macOS 结果称作 Linux/systemd 已验证。保存构建与验收 manifest；任何失败停止发布。
3. **首次切换必须保护旧进程**：当前旧 SRS 不具备此修复。选择测试结束/无正式录像的窗口，先通过既有正常流程结束全部推流；核对 SRS API 中没有任何 publisher（完整分页），旧 PID 不再持有录像写入 fd，刚结束各路 MP4 和 Recording/回调均齐全。已有历史孤立 `.tmp` 只记录，不改名、不迁移、不回填。仍有活动推流或未完成回调时不能直接 `systemctl stop/restart srs`，也不能靠安装新 unit 使旧进程获得新代码。
4. **只切换 SRS**：上传 manifest 对应二进制到临时路径并复核 SHA/架构/权限，备份完成后停止已无推流的旧 SRS，确认进程退出；原子替换 `/opt/srs/objs/srs`，安装本目录配套 `srs.service`，`systemctl daemon-reload` 后启动 SRS。保留现有配置、用户权限和存储路径。Vigil 必须保持可用，不需要重启 Vigil、OJ、Caddy 或 Windows Service。
5. **部署后验收**：核对实际运行制品 SHA、版本、systemd 状态、监听端口、Vigil 健康；让已授权测试终端按既有流程重新推流，验证屏幕/摄像头恢复、MP4 生成、Recording 关联、播放与拖动，读取 CPU/内存及错误日志。活动推流停止验收只能在明确测试窗口进行，不能为了测试再次中断正式录像。正常运行、封装与回调成功事实必须分别确认。
6. **失败即停/回滚**：停止或回调异常、非零退出、PID 残留、SHA 不匹配或回放失败，立即停止后续部署，不做数据库补写。若需回滚，先用新制品正常 drain 并确认退出，再原子恢复旧二进制及 unit，daemon-reload 后启动；不恢复数据库、不覆盖新增录像。回滚后旧停止缺陷也恢复，后续仍须先正常结束推流再停服务。

参考：[SRS 发布](https://github.com/ossrs/srs/releases/tag/v6.0-r0)、[官方构建说明](https://www.ossrs.net/lts/en-us/docs/v6/doc/getting-started-build)、[systemd KillSignal / SendSIGKILL 原始文档](https://github.com/systemd/systemd/blob/main/man/systemd.kill.xml)。具体源码证据以校验过的 6.0.184 发布包为准。
