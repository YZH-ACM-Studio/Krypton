# PROCTOR_DEPLOYMENT.md — 反作弊监考增强 部署 runbook

> Companion to [`CLIENT_PROCTOR_MONITORING_DESIGN.md`](../CLIENT_PROCTOR_MONITORING_DESIGN.md). Follow this runbook **after** code is built and verified; refer to
> `CLAUDE.md` for the general OJ deployment patterns.

## 0. 前置检查

- [ ] 客户端代码 build 通过（Windows CI 绿色）
- [ ] `packages/hydrooj/src/{interface.ts,handler/contest.ts,handler/vigil-integration.ts,service/vigil-bridge.ts}` 修改已通过 OJ build
- [ ] `packages/krypton-vigilguard/{index.ts,src/migration.ts}` 修改已通过 build
- [ ] `packages/ui-next/src/pages/{contest-manage.tsx,vigil/*}` 构建通过
- [ ] Vigil server (`ecosystems/KryptonVigilSystem/Server`) 改动通过本机 `uvicorn` 启动检查
- [ ] 已构建 vendor ffmpeg（按 `Client/deploy/ffmpeg-build.md`）
- [ ] **生产 mongo 与 sqlite 已备份**（按 CLAUDE.md §3 坑 11 模板）

## 1. SRS 安装到 oj-vigil

```bash
# 下载 SRS 6.x linux x86_64 binary
ssh oj-vigil 'SP=jyh521315
  echo $SP | sudo -S -p "" mkdir -p /opt/srs/objs /opt/srs/conf
  # 假设已经把 srs 二进制传到 /tmp/srs
  echo $SP | sudo -S -p "" install -m 755 /tmp/srs /opt/srs/objs/srs
  echo $SP | sudo -S -p "" useradd -r -s /usr/sbin/nologin srs 2>/dev/null || true
  echo $SP | sudo -S -p "" mkdir -p /data/vigil/recordings /opt/srs/objs/nginx/html
  echo $SP | sudo -S -p "" ln -sfn /data/vigil/recordings /opt/srs/objs/nginx/html/recordings
  echo $SP | sudo -S -p "" chown -R srs:srs /data/vigil/recordings /opt/srs/objs/nginx/html /var/log
'

# 安装配置
rsync -a /Users/motricseven/Krypton/ops/srs/krypton.conf oj-vigil:/tmp/krypton.conf
rsync -a /Users/motricseven/Krypton/ops/systemd/srs.service oj-vigil:/tmp/srs.service
ssh oj-vigil 'SP=jyh521315
  echo $SP | sudo -S -p "" install -m 644 /tmp/krypton.conf /opt/srs/conf/krypton.conf
  echo $SP | sudo -S -p "" install -m 644 /tmp/srs.service /etc/systemd/system/srs.service
  echo $SP | sudo -S -p "" systemctl daemon-reload
  echo $SP | sudo -S -p "" systemctl enable --now srs
  echo $SP | sudo -S -p "" systemctl status srs --no-pager
'
```

验证：

```bash
ssh oj-vigil 'curl -s http://127.0.0.1:1985/api/v1/summaries | head -c 500'
# 应输出 JSON
```

## 2. Vigil server 同步更新（旧服务器代码 + 新字段 + 新路由）

参考 CLAUDE.md §4.5 Vigil server 代码同步：

```bash
rsync -a --delete --exclude='.venv' --exclude='__pycache__' --exclude='data' --exclude='.env' \
  /Users/motricseven/Krypton/ecosystems/KryptonVigilSystem/Server/ \
  oj-vigil:/tmp/vigil-stage/

ssh oj-vigil 'SP=jyh521315
  echo $SP | sudo -S -p "" rsync -a --delete --exclude=.venv --exclude=data --exclude=.env \
    /tmp/vigil-stage/ /opt/krypton-vigil/
  echo $SP | sudo -S -p "" systemctl restart krypton-vigil
'
ssh oj-vigil 'sudo tail -100 /var/log/krypton-vigil.log'
```

启动日志应该包含：
- `init_db()` 完成
- `start_heartbeat_watcher()` 启动
- 没有 SQLAlchemy ALTER 失败

## 3. Caddy reverse-proxy 加 vigil-hls 段

```bash
ssh oj 'export SP=zhangzhi93
  echo $SP | sudo -S -p "" cp /root/.hydro/Caddyfile /data/backup/Caddyfile.$(date +%s).bak
  # 手工编辑 /root/.hydro/Caddyfile，把 ops/caddy/Caddyfile.vigil-hls.snippet 内容
  # 追加到现有 oj-domain 块的最后
  echo $SP | sudo -S -p "" /root/.nix-profile/bin/caddy reload --config /root/.hydro/Caddyfile
'
```

## 4. OJ 代码增量更新

按 CLAUDE.md §4.4 同时改了 plugin + UI + 新 deps 的模板：

```bash
# 一定要清理生成的 .js / .d.ts（坑 18）
find packages/hydrooj/src -type f \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' \) -delete

# Mac → tempserver 全量同步
rsync -a --delete --exclude=node_modules --exclude=public/next /Users/motricseven/Krypton/ tempserver:/tmp/Krypton-build/

# tempserver build
ssh tempserver 'cd /tmp/Krypton-build && bun install && bun run build:ui:production >/dev/null 2>&1'

# 推到 oj
ssh tempserver 'cd /tmp/Krypton-build && tar c node_modules \
  framework/*/node_modules packages/*/node_modules \
  packages/ui-default/public packages/ui-next/public | pigz -3' \
  | ssh oj 'cat > /tmp/krypton-all.tgz'

rsync -a --delete --exclude=node_modules --exclude=public/next \
  /Users/motricseven/Krypton/ oj:/tmp/Krypton-stage/
ssh oj 'export SP=zhangzhi93
  echo $SP | sudo -S -p "" rsync -a --delete --exclude=node_modules \
    --exclude=public/next /tmp/Krypton-stage/ /opt/Krypton/
  cd /opt/Krypton && echo $SP | sudo -S -p "" tar xzf /tmp/krypton-all.tgz
  rm /tmp/krypton-all.tgz
  echo $SP | sudo -S -p "" /root/.nix-profile/bin/pm2 restart hydrooj
'
ssh oj 'sudo /root/.nix-profile/bin/pm2 logs hydrooj --lines 100 --nostream'
```

启动日志应该出现：
- `vigilguard migration v2_media_defaults` upgrade count
- `check-hls-access` route loaded

验证 manifest hash:

```bash
ssh oj "grep -oE 'assets/index-[A-Za-z0-9_-]+\\.js' /opt/Krypton/packages/ui-next/public/next/manifest.json | head -1"
# 应当与本地 mac 的 manifest hash 一致
```

## 5. Cleanup cron 安装

```bash
rsync -a /Users/motricseven/Krypton/ops/systemd/vigil-cleanup.{service,timer} oj-vigil:/tmp/
ssh oj-vigil 'SP=jyh521315
  echo $SP | sudo -S -p "" install -m 644 /tmp/vigil-cleanup.service /etc/systemd/system/
  echo $SP | sudo -S -p "" install -m 644 /tmp/vigil-cleanup.timer /etc/systemd/system/
  echo $SP | sudo -S -p "" systemctl daemon-reload
  echo $SP | sudo -S -p "" systemctl enable --now vigil-cleanup.timer
  echo $SP | sudo -S -p "" systemctl list-timers vigil-cleanup
'

# Dry run 验证
ssh oj-vigil 'SP=jyh521315
  echo $SP | sudo -S -p "" /opt/krypton-vigil/.venv/bin/python -m app.scripts.cleanup --dry-run
'
```

## 6. 防火墙配置

按 `ops/firewall/README.md` 在 oj-vigil 上配置 UFW，限制 1935/8080/1985 端口。

## 7. 客户端打包

```bash
# 在 Windows CI 上：
# - 把 vendor/ffmpeg/ffmpeg.exe (~30 MB) 放到指定位置
# - cmake --build + cpack 产生 installer
# - 上传到 lab 镜像分发服务器
```

机房 GPO 配置（一次性）：
- 摄像头隐私设置全局允许
- 客户端 exe 加入杀软白名单
- ffmpeg.exe 加入杀软白名单（防止 IDS 把 H.264 编码误报为可疑活动）

## 8. 端到端验证

学生端：
1. 启动客户端 → 登录 → 进入考试 webview
2. 等 10 秒 — 检查 `tasklist | findstr ffmpeg` 应该有 2 个 ffmpeg.exe (screen + camera)
3. 在 oj-vigil 上：`ls -l /data/vigil/recordings/` （如果开了 recordEnabled）
4. 回放 URL 应该返回 `200 video/mp4`：
   `curl -I http://10.1.234.2/vigil-hls/recordings/<filename>.mp4`

> SRS 的 HTTP 根目录是 `/opt/srs/objs/nginx/html`，DVR mp4 写在
> `/data/vigil/recordings`。必须保留
> `/opt/srs/objs/nginx/html/recordings -> /data/vigil/recordings` 符号链接，
> 否则 OJ 的 `/vigil-hls/recordings/*.mp4` 会被 Caddy 转发到 SRS 后返回 404。

老师端：
4. 打开 `/admin/vigil/exams/{cid}` — 学生卡片墙出现
5. 点卡片 → 右侧抽屉滑出
6. 点 "查看实时画面" — HLS 视频 < 5s 显示学生屏幕
7. 点 "实时截屏" — 5s 内卡片缩略图更新
8. 点 "锁屏" + 填 reason → 学生屏幕显示全屏遮罩
9. 点 "解锁" → 学生 unlock
10. 发 send_message critical → 学生屏幕全屏弹窗
11. 群发 "考试还有 10 分钟" → 所有学生 toast
12. 检查 `vigil.command_audit` 表中有完整审计记录

## 9. 回滚

按 CLAUDE.md §5 回滚流程：
- 客户端：旧版 installer 重新分发
- Vigil server: `systemctl stop krypton-vigil` + 恢复 `/opt/krypton-vigil.bak`
- SRS：`systemctl stop srs` （不影响考试 — fail-soft）
- hydrooj：恢复 `addon.json.bak` + `pm2 restart hydrooj`
- mongo migration: `db.system.updateOne({_id:'db.ver-vigilguard'}, {$set:{value:1}})` 把 dbVer 回滚到 v1（不会触发 v2 反向 — 字段保留，不会损坏）
