/**
 * Vigil event-type and severity translation tables.
 *
 * The client (Krypton VigilClient) writes event categories as opaque
 * snake_case strings — easy for greps and grafana, ugly for end-user
 * proctor UI. Translate them here on the way to the screen; fall back
 * to the original token if we ever ship a new event type the UI hasn't
 * been updated for. **Never throw** — proctor UI must keep rendering
 * even when faced with unknown tokens.
 */

const EVENT_TYPE_ZH: Record<string, string> = {
  // 8-class detection (PROCTOR_MONITORING_DESIGN §7.1)
  process_started_unauthorized: '未授权进程启动',
  usb_storage_changed: 'USB 存储设备插拔',
  monitor_changed: '显示器配置变化',
  session_locked: '系统会话锁定',
  session_unlocked: '系统会话解锁',
  camera_lost: '摄像头掉线',
  network_adapter_changed: '网卡配置变化',
  print_initiated: '打印任务启动',
  clipboard_external_paste: '外部剪贴板粘贴',

  // Legacy / SystemMonitor categories
  'window.foreground_changed': '前台窗口切换',
  'input.hotkey': '可疑热键',
  'clipboard.changed': '剪贴板内容变化',

  // Telemetry
  'telemetry.screenshot_failed': '截屏失败',
  'telemetry.screenshot_queued': '截屏待重传',
  'telemetry.device_snapshot': '设备遥测',
  'telemetry.media_snapshot': '媒体设备遥测',
  'telemetry.monitor_snapshot': '监控遥测',

  // Client lifecycle
  'client.connected': '客户端已连接',
  'client.disconnected': '客户端已断开',
  client_disconnected: '客户端已断开',

  // Lockdown / network lock
  lockdown_failed: '客户端锁屏失败',
  'network.lock_failed': '网络锁定失败',
  'network.lock_engaged': '网络已锁定',
  'network.lock_renew_failed': '网络锁续约失败',
  'network.unlock_failed': '网络解锁失败',
  'network.blocked_navigation': '已拦截导航',
  'network.blocked_resource': '已拦截资源加载',

  // RTMP / streaming
  stream_failed: '推流失败',
  ffmpeg_missing: 'ffmpeg 缺失',
};

const SEVERITY_ZH: Record<string, string> = {
  info: '提示',
  low: '低',
  medium: '中',
  warning: '警告',
  high: '高',
  error: '错误',
  critical: '严重',
};

/** Translate an event category token. Falls back to a humanised version of
 *  the original token if unknown (replace `_` and `.` with spaces). */
export function translateEventType(token: string | null | undefined): string {
  if (!token) return '未知事件';
  const hit = EVENT_TYPE_ZH[token];
  if (hit) return hit;
  // Humanise unknown tokens: `foo.bar_baz` → `foo bar baz`.
  return token.replace(/[._]+/g, ' ');
}

/** Translate a severity token. Unknown severities pass through verbatim. */
export function translateSeverity(token: string | null | undefined): string {
  if (!token) return '提示';
  return SEVERITY_ZH[token.toLowerCase()] || token;
}
