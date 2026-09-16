# 校赛压测脚手架

本机 ffmpeg 推**预编码** FLV（`-re -c copy`），不是现场 300 路编码。默认主机就是机房生产 IP（OJ `10.1.234.2`，SRS `10.1.235.155:1935`）。

必须用隐藏测试赛 24 位 hex id，并把正式校赛 id 写进 `denied-contests.txt`，否则 live 会拒绝。

依赖本机 `ffmpeg`。无额外 pip 包。

## 第一次只允许

不要复制 ramp 当第一次。第一次也不要用 `all` 上 300 人。

```bash
cd scripts/contest-loadtest
python3 loadtest.py prepare-samples
python3 loadtest.py dry-run --contest-id HEX --allow-contest-id HEX --students 30
python3 loadtest.py rtmp --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --students 30 --duration 180
```

`prepare-samples` 编 **1080p**，目标码率屏幕 2.5 Mbps + 摄像头 2.0 Mbps。`dry-run` 会打印估算 Mbps 和一条 ffmpeg 命令。

默认 `--app live-record` 会在 oj-vigil 落盘；第一次可用 `--app live-nodvr`。`live-record` 打完后到监考后台按**测试赛** id「删除整场录像」。

## liveness

`dry-run` / `rtmp` 都会打印估算 Mbps。网卡速度能读到、且估算超过链路 70% 时警告；读不到就不警告。

live 推流活着比例过低会失败（默认低于 90%）。

## ramp

默认 `30,100,150,200,300`，每档 180 秒。300 人约 1.35 Gbps，千兆网卡撑不住。

```bash
python3 loadtest.py ramp --contest-id HEX --allow-contest-id HEX --confirm LOADTEST
```

## http

浏览器登录路径，进不了 `client_required`。漏 `--confirm LOADTEST` 会失败。必须 `--pid` 真题号（新建 hidden 小题，不要用校赛题）。

```bash
python3 loadtest.py http --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --users-file users.csv --pid PID
```

## burst

开赛尖峰：登录仍错开，随后并发 attend / 看题 / 提交。单机做不到一人一 IP，会打到 Hydro 全局限流 100 次/5 秒，403 是在测限流，不是脚手架坏了。

```bash
python3 loadtest.py burst --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --users-file users.csv --pid PID
```

默认并发 40。CSV 人数超过上限时需提高 `--concurrency`。漏 `--confirm LOADTEST` 会失败。必须 `--pid` 真题号（新建 hidden 小题，不要用校赛题）。

## viewers

老师拉 HTTP-FLV（`/vigil-flv/...`）。默认 4 个老师各 8 路。必须先有 `rtmp` 在推，否则拉的是空流。

```bash
python3 loadtest.py viewers --contest-id HEX --allow-contest-id HEX --confirm LOADTEST
```

## all

一键同时推流 + 老师拉流；burst / 截图 / 心跳按参数可选。第一次仍不要用 `all` 上 300 人。

```bash
python3 loadtest.py all --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --students 30 --duration 180
```

开 burst 再加 `--users-file users.csv --pid PID`。开截图或心跳再加 `--vigil-upload-base http://ISOLATED:8765`（隔离 Vigil，禁止生产）。

## screenshots

默认禁止打生产 oj-vigil。只对隔离 Vigil + 本地 `identities/`。不灌假 endpoint，不走入网/换钥。

空 `--vigil-upload-base` 或指向生产 `10.1.235.155` 的 live 会拒绝。

```bash
python3 loadtest.py screenshots --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --vigil-upload-base http://ISOLATED:8765
```

## heartbeat

默认禁止打生产 oj-vigil。只对隔离 Vigil + 本地 `identities/`。不灌假 endpoint，不走入网/换钥。

空 `--vigil-upload-base` 或指向生产 `10.1.235.155` 的 live 会拒绝。

```bash
python3 loadtest.py heartbeat --contest-id HEX --allow-contest-id HEX --confirm LOADTEST --vigil-upload-base http://ISOLATED:8765
```

## metrics

SRS HTTP API `:1985` 只在 **oj-vigil 本机**能读。在 loadgen 上跑读不到是正常的。不要 SSH。

```bash
python3 loadtest.py metrics --contest-id HEX --allow-contest-id HEX
```

## stop

```bash
python3 loadtest.py stop --contest-id HEX --allow-contest-id HEX
python3 loadtest.py stop --contest-id HEX --allow-contest-id HEX --confirm LOADTEST
```

不带 `--confirm` 只列出本场残留 ffmpeg（cmdline 含 `rtmp://`、contest id、`loadtest_`）。真杀需要 `--confirm LOADTEST`。

## 本机测试

```bash
cd scripts/contest-loadtest
python3 -m unittest discover -s . -p 'test_*.py'
```
